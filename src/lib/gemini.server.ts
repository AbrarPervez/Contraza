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

type GeminiDiagnostics = { requestId?: string };

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

function classifyFetchFailure(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  if (error instanceof TypeError) return "network_error";
  return "fetch_error";
}

export async function generateGeminiText(
  systemInstruction: string,
  contents: GeminiContent[],
  diagnostics: GeminiDiagnostics = {},
): Promise<string> {
  const requestId = diagnostics.requestId ?? crypto.randomUUID();
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "low" },
    },
  });
  const requestBodyBytes = new TextEncoder().encode(requestBody).byteLength;
  const request: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: requestBody,
  };
  const startedAt = Date.now();
  let selectedModel = "";
  let selectedAttempt = 0;
  let response: Response | undefined;
  let lastTimeoutError: unknown;
  for (const model of MODEL_FALLBACKS) {
    selectedModel = model;
    let timedOut = false;
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      selectedAttempt = attempt + 1;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const attemptStartedAt = Date.now();
      try {
        response = await fetch(url, {
          ...request,
          signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
        });
        logGeminiMetric({
          requestId,
          operation: "generateContent",
          model,
          status: response.status,
          requestMs: Date.now() - attemptStartedAt,
          attempt: attempt + 1,
          requestBodyBytes,
          failureCategory: response.ok ? "none" : response.status === 503 ? "gemini_overloaded" : "gemini_http_error",
        });
      } catch (error) {
        logGeminiMetric({
          requestId,
          operation: "generateContent",
          model,
          status: null,
          requestMs: Date.now() - attemptStartedAt,
          attempt: attempt + 1,
          requestBodyBytes,
          failureCategory: classifyFetchFailure(error),
        });
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "TimeoutError"
        ) {
          lastTimeoutError = error;
          timedOut = true;
          response = undefined;
          break;
        }
        throw error;
      }
      if (response.status !== 503) break;
      if (attempt < MAX_503_RETRIES) {
        const retryAfter = response.headers.get("retry-after");
        const delayMs = retryDelayMs(retryAfter, attempt + 1);
        logGeminiMetric({
          requestId,
          operation: "generateContent",
          model,
          status: response.status,
          attempt: attempt + 1,
          retryDelayMs: delayMs,
          failureCategory: "gemini_overloaded_retry",
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    if (timedOut) continue;
    if (response?.status !== 503) break;
  }
  if (!response) {
    logGeminiMetric({
      requestId,
      operation: "generateContent",
      model: selectedModel,
      status: null,
      attempt: selectedAttempt,
      failureCategory: lastTimeoutError ? "timeout_all_models" : "no_response",
      totalMs: Date.now() - startedAt,
    });
    if (lastTimeoutError) {
      throw new Error("Gemini timed out on all configured models. Please try again.", {
        cause: lastTimeoutError,
      });
    }
    throw new Error("Gemini request did not return a response.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    logGeminiMetric({
      requestId,
      operation: "generateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory: classifyFetchFailure(error) === "timeout" ? "response_timeout" : "response_body_error",
    });
    throw new Error("Gemini returned an unreadable response.", { cause: error });
  }

  const result = responseSchema.safeParse(payload);
  if (!response.ok) {
    const message = result.success ? result.data.error?.message : undefined;
    logGeminiMetric({
      requestId,
      operation: "generateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory: response.status === 503 ? "gemini_http_503_exhausted" : "gemini_http_error",
    });
    throw new Error(
      `Gemini request failed (${response.status}): ${message ?? response.statusText}`,
    );
  }
  if (!result.success) {
    logGeminiMetric({
      requestId,
      operation: "generateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory: "unexpected_response_format",
    });
    throw new Error("Gemini returned an unexpected response format.");
  }

  const candidate = result.data.candidates?.[0];
  const text = candidate?.content?.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const reason = candidate?.finishReason;
    logGeminiMetric({
      requestId,
      operation: "generateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory: "empty_model_response",
    });
    throw new Error(
      reason ? `Gemini returned no text (finish reason: ${reason}).` : "Gemini returned no text.",
    );
  }
  logGeminiMetric({
    requestId,
    operation: "generateContent",
    model: selectedModel,
    status: response.status,
    attempt: selectedAttempt,
    requestBodyBytes,
    totalMs: Date.now() - startedAt,
    outputChars: text.length,
  });
  return text;
}

export async function generateGeminiTextStream(
  systemInstruction: string,
  contents: GeminiContent[],
  onText: (text: string) => Promise<void>,
  diagnostics: GeminiDiagnostics = {},
): Promise<string> {
  const requestId = diagnostics.requestId ?? crypto.randomUUID();
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "low" },
    },
  });
  const requestBodyBytes = new TextEncoder().encode(requestBody).byteLength;
  const request: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: requestBody,
  };
  const startedAt = Date.now();
  let selectedModel = "";
  let firstTextAt: number | null = null;
  let response: Response | undefined;
  let selectedAttempt = 0;
  for (const model of MODEL_FALLBACKS) {
    selectedModel = model;
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      selectedAttempt = attempt + 1;
      const attemptStartedAt = Date.now();
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          request,
        );
      } catch (error) {
        logGeminiMetric({
          requestId,
          operation: "streamGenerateContent",
          model,
          status: null,
          requestMs: Date.now() - attemptStartedAt,
          attempt: attempt + 1,
          requestBodyBytes,
          failureCategory: classifyFetchFailure(error),
        });
        throw error;
      }
      logGeminiMetric({
        requestId,
        operation: "streamGenerateContent",
        model,
        status: response.status,
        requestMs: Date.now() - attemptStartedAt,
        attempt: attempt + 1,
        requestBodyBytes,
        failureCategory: response.ok ? "none" : response.status === 503 ? "gemini_overloaded" : "gemini_http_error",
      });
      if (response.status !== 503) break;
      if (attempt < MAX_503_RETRIES) {
        const delayMs = retryDelayMs(response?.headers.get("retry-after") ?? null, attempt + 1);
        logGeminiMetric({
          requestId,
          operation: "streamGenerateContent",
          model,
          status: response.status,
          attempt: attempt + 1,
          retryDelayMs: delayMs,
          failureCategory: "gemini_overloaded_retry",
        });
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs),
        );
      }
    }
    if (response?.status !== 503) break;
  }
  if (!response) {
    logGeminiMetric({
      requestId,
      operation: "streamGenerateContent",
      model: selectedModel,
      status: null,
      attempt: selectedAttempt,
      failureCategory: "no_response",
      totalMs: Date.now() - startedAt,
    });
    throw new Error("Gemini request did not return a response.");
  }
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
    logGeminiMetric({
      requestId,
      operation: "streamGenerateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory: response.status === 503 ? "gemini_http_503_exhausted" : "gemini_http_error",
    });
    throw new Error(`Gemini request failed (${response.status}): ${message}`);
  }
  if (!response.body) {
    logGeminiMetric({
      requestId,
      operation: "streamGenerateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      totalMs: Date.now() - startedAt,
      failureCategory: "empty_stream_body",
    });
    throw new Error("Gemini returned an empty streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData = "";
  let text = "";
  let failurePhase = "stream_read";

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
          event: "first_text",
          requestId,
          operation: "streamGenerateContent",
          model: selectedModel,
          timeToFirstTextMs: firstTextAt - startedAt,
          timeToFirstTextScope: "from_initial_request_including_fallback_and_retries",
        });
      }
      text += delta;
      try {
        await onText(text);
      } catch (error) {
        failurePhase = "stream_callback";
        throw error;
      }
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
    } catch (error) {
      logGeminiMetric({
        requestId,
        operation: "streamGenerateContent",
        model: selectedModel,
        status: response.status,
        attempt: selectedAttempt,
        requestBodyBytes,
        totalMs: Date.now() - startedAt,
        failureCategory: failurePhase === "stream_callback" ? "stream_callback_error" : "stream_read_error",
      });
      throw error;
    }
  } finally {
    reader.releaseLock();
  }

  const completeText = text.trim();
  if (!completeText) throw new Error("Gemini returned no text.");
  logGeminiMetric({
    requestId,
    event: "complete",
    operation: "streamGenerateContent",
    model: selectedModel,
    status: response.status,
    attempt: selectedAttempt,
    requestBodyBytes,
    totalMs: Date.now() - startedAt,
    outputChars: completeText.length,
  });
  return completeText;
}
