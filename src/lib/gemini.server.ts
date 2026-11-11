import { z } from "zod";

type GeminiContent = {
  role: "user" | "model";
  parts: { text: string }[];
};

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const MODEL_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash"] as const;
const MAX_503_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 5_000;
const GEMINI_REQUEST_TIMEOUT_MS = 120_000;

function logGeminiMetric(metric: Record<string, string | number | null>) {
  // Never include prompts, contract text, API keys, or user identifiers in logs.
  console.info("[Contraza Gemini]", metric);
}

function retryDelayMs(retryAfter: string | null, retryNumber: number) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(retryAt) && retryAt >= 0) {
      return Math.min(retryAt, MAX_RETRY_AFTER_MS);
    }
  }
  return Math.min(1_000 * 2 ** (retryNumber - 1), MAX_RETRY_AFTER_MS);
}

export async function generateGeminiText(
  systemInstruction: string,
  contents: GeminiContent[],
): Promise<string> {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

  const request: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
  };
  const startedAt = Date.now();
  let selectedModel = "";
  let response: Response | undefined;
  for (const model of MODEL_FALLBACKS) {
    selectedModel = model;
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const attemptStartedAt = Date.now();
      try {
        response = await fetch(url, request);
        logGeminiMetric({
          operation: "generateContent",
          model,
          status: response.status,
          requestMs: Date.now() - attemptStartedAt,
          attempt: attempt + 1,
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "TimeoutError"
        ) {
          throw new Error("Gemini request timed out after 120 seconds. Please try again.", {
            cause: error,
          });
        }
        throw error;
      }
      logGeminiMetric({
        operation: "streamGenerateContent",
        model,
        status: response.status,
        requestMs: Date.now() - attemptStartedAt,
        attempt: attempt + 1,
      });
      if (response.status !== 503) break;
      if (attempt < MAX_503_RETRIES) {
        const retryAfter = response.headers.get("retry-after");
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(retryAfter, attempt + 1)));
      }
    }
    if (response?.status !== 503) break;
  }
  if (!response) throw new Error("Gemini request did not return a response.");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Gemini returned an unreadable response.", { cause: error });
  }

  const result = responseSchema.safeParse(payload);
  if (!response.ok) {
    const message = result.success ? result.data.error?.message : undefined;
    throw new Error(
      `Gemini request failed (${response.status}): ${message ?? response.statusText}`,
    );
  }
  if (!result.success) throw new Error("Gemini returned an unexpected response format.");

  const candidate = result.data.candidates?.[0];
  const text = candidate?.content?.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const reason = candidate?.finishReason;
    throw new Error(
      reason ? `Gemini returned no text (finish reason: ${reason}).` : "Gemini returned no text.",
    );
  }
  logGeminiMetric({
    operation: "generateContent",
    model: selectedModel,
    status: response.status,
    totalMs: Date.now() - startedAt,
    outputChars: text.length,
  });
  return text;
}

export async function generateGeminiTextStream(
  systemInstruction: string,
  contents: GeminiContent[],
  onText: (text: string) => Promise<void>,
): Promise<string> {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

  const request: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
  };
  const startedAt = Date.now();
  let selectedModel = "";
  let firstTextAt: number | null = null;
  let response: Response | undefined;
  for (const model of MODEL_FALLBACKS) {
    selectedModel = model;
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      const attemptStartedAt = Date.now();
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        request,
      );
      if (response.status !== 503) break;
      if (attempt < MAX_503_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            retryDelayMs(response?.headers.get("retry-after") ?? null, attempt + 1),
          ),
        );
      }
    }
    if (response?.status !== 503) break;
  }
  if (!response) throw new Error("Gemini request did not return a response.");
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload: unknown = await response.json();
      const result = responseSchema.safeParse(payload);
      if (result.success) message = result.data.error?.message ?? message;
    } catch (error) {
      if (error instanceof Error && error.name !== "SyntaxError") {
        throw new Error("Gemini returned an unreadable error response.", { cause: error });
      }
    }
    throw new Error(`Gemini request failed (${response.status}): ${message}`);
  }
  if (!response.body) throw new Error("Gemini returned an empty streaming response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData = "";
  let text = "";

  async function processData(data: string) {
    if (data === "[DONE]") return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      throw new Error("Gemini returned an unreadable streaming response.", { cause: error });
    }
    const result = responseSchema.safeParse(payload);
    if (!result.success)
      throw new Error("Gemini returned an unexpected streaming response format.");
    const delta = result.data.candidates?.[0]?.content?.parts
      .map((part) => part.text ?? "")
      .join("");
    if (delta) {
      if (firstTextAt === null) {
        firstTextAt = Date.now();
        logGeminiMetric({
          operation: "streamGenerateContent",
          model: selectedModel,
          timeToFirstTextMs: firstTextAt - startedAt,
        });
      }
      text += delta;
      await onText(text);
    }
  }

  async function processLine(line: string) {
    if (!line) {
      if (eventData) {
        const data = eventData;
        eventData = "";
        await processData(data);
      }
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trimStart();
    eventData = eventData ? `${eventData}\n${data}` : data;
    try {
      JSON.parse(eventData);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    const completeData = eventData;
    eventData = "";
    await processData(completeData);
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) await processLine(line);
      if (done) break;
    }
    if (buffer) await processLine(buffer);
    if (eventData) await processData(eventData);
  } finally {
    reader.releaseLock();
  }

  const completeText = text.trim();
  if (!completeText) throw new Error("Gemini returned no text.");
  logGeminiMetric({
    operation: "streamGenerateContent",
    model: selectedModel,
    status: response.status,
    totalMs: Date.now() - startedAt,
    timeToFirstTextMs: firstTextAt === null ? null : firstTextAt - startedAt,
    outputChars: completeText.length,
  });
  return completeText;
}
