import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGeminiText, generateGeminiTextStream } from "./gemini.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generateGeminiText", () => {
  it("uses the server key and returns generated text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "  Draft text  " }] } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system instruction", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).resolves.toBe("Draft text");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect(new Headers(request.headers).get("x-goog-api-key")).toBe("server-secret");
    expect(JSON.parse(String(request.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "system instruction" }] },
      contents: [{ role: "user", parts: [{ text: "draft this" }] }],
    });
  });

  it("reports a missing API key without making a request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).rejects.toThrow("Missing GEMINI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when a Gemini request times out", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
    );

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).rejects.toThrow("Gemini request timed out after 120 seconds.");
  });

  it("surfaces API errors without returning a success-shaped fallback", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 400 }),
        ),
    );

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).rejects.toThrow("Gemini request failed (400): Invalid API key");
  });

  it("retries a temporary 503 and returns the successful response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Temporarily overloaded" } }), {
          status: 503,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Draft after retry" }] } }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).resolves.toBe("Draft after retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the secondary model after bounded primary-model 503 retries", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const overloaded = () =>
      new Response(JSON.stringify({ error: { message: "Model is experiencing high demand" } }), {
        status: 503,
        headers: { "Retry-After": "0" },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Fallback response" }] } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).resolves.toBe("Fallback response");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[0]).toContain("/models/gemini-3.6-flash:generateContent");
  });

  it("preserves the final API error when all models return 503", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Model is experiencing high demand" } }), {
        status: 503,
        headers: { "Retry-After": "0" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).rejects.toThrow("Gemini request failed (503): Model is experiencing high demand");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("streams text chunks without changing the model or output budget", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const chunks = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "First " }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "second" }] } }] })}\n\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateGeminiTextStream("system", [{ role: "user", parts: [{ text: "question" }] }], onText),
    ).resolves.toBe("First second");

    expect(onText).toHaveBeenNthCalledWith(1, "First ");
    expect(onText).toHaveBeenNthCalledWith(2, "First second");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(":streamGenerateContent?alt=sse");
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      generationConfig: { maxOutputTokens: 8192 },
    });
  });

  it("emits newline-delimited SSE data without waiting for a blank-line separator", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const chunks = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Visible " }] } }] })}\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "response" }] } }] })}\n`,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    const onText = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateGeminiTextStream("system", [{ role: "user", parts: [{ text: "question" }] }], onText),
    ).resolves.toBe("Visible response");

    expect(onText).toHaveBeenNthCalledWith(1, "Visible ");
    expect(onText).toHaveBeenNthCalledWith(2, "Visible response");
  });
});
