import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGeminiText, generateGeminiTextStream } from "./gemini.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function streamResponse(...texts: string[]) {
  const chunks = texts.map(
    (text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`,
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

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
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "low" },
      },
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
    ).rejects.toThrow("Gemini timed out on all configured models.");
  });

  it("tries the fallback model when the primary model times out", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Fallback draft" }] } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGeminiText("system", [{ role: "user", parts: [{ text: "draft this" }] }]),
    ).resolves.toBe("Fallback draft");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/models/gemini-3.6-flash:generateContent");
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
    const fetchMock = vi.fn().mockResolvedValue(streamResponse("First ", "second"));
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateGeminiTextStream("system", [{ role: "user", parts: [{ text: "question" }] }], onText),
    ).resolves.toBe("First second");

    expect(onText).toHaveBeenNthCalledWith(1, "First ");
    expect(onText).toHaveBeenNthCalledWith(2, "First second");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(":streamGenerateContent?alt=sse");
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.body))).toMatchObject({
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "low" },
      },
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

  it("retries a transient pre-header network failure and falls back to the next model", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(streamResponse("Fallback answer"));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateGeminiTextStream(
      "system",
      [{ role: "user", parts: [{ text: "question" }] }],
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(generation).resolves.toBe("Fallback answer");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/models/gemini-3.8-flash:");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/models/gemini-3.6-flash:");
  });

  it("aborts each streaming attempt at the configured timeout and uses the fallback model", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    vi.stubEnv("GEMINI_STREAM_TIMEOUT_MS", "1000");
    const waitForAbort = (_url: string, request: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(request.signal?.reason), {
          once: true,
        });
      });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(waitForAbort)
      .mockImplementationOnce(waitForAbort)
      .mockResolvedValueOnce(streamResponse("Fallback after timeout"));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateGeminiTextStream(
      "system",
      [{ role: "user", parts: [{ text: "question" }] }],
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(generation).resolves.toBe("Fallback after timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, request] of fetchMock.mock.calls) {
      expect((request as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("backs off and retries HTTP 429 without retrying a permanent authentication error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(streamResponse("Recovered"));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateGeminiTextStream(
      "system",
      [{ role: "user", parts: [{ text: "question" }] }],
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(generation).resolves.toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
      );
    await expect(
      generateGeminiTextStream(
        "system",
        [{ role: "user", parts: [{ text: "question" }] }],
        vi.fn().mockResolvedValue(undefined),
      ),
    ).rejects.toThrow("Gemini authentication failed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves HTTP 503 retries and fallback for streaming requests", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const overloaded = () =>
      new Response(JSON.stringify({ error: { message: "Temporarily overloaded" } }), {
        status: 503,
        headers: { "Retry-After": "0" },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(streamResponse("Fallback stream"));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateGeminiTextStream(
      "system",
      [{ role: "user", parts: [{ text: "question" }] }],
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(generation).resolves.toBe("Fallback stream");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[0]).toContain("/models/gemini-3.6-flash:");
  });

  it("does not retry a stream after partial output has arrived", async () => {
    vi.stubEnv("GEMINI_API_KEY", "server-secret");
    const chunk = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Partial" }] } }] })}\n\n`;
    let pullCount = 0;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (pullCount++ === 0) {
              controller.enqueue(new TextEncoder().encode(chunk));
              return;
            }
            controller.error(new TypeError("connection reset"));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateGeminiTextStream("system", [{ role: "user", parts: [{ text: "question" }] }], onText),
    ).rejects.toThrow("Gemini connection was interrupted while streaming");
    expect(onText).toHaveBeenCalledWith("Partial");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
