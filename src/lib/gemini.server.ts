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
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_STREAM_NETWORK_RETRIES = 1;
const DEFAULT_GEMINI_STREAM_TIMEOUT_MS = 120_000;
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

function streamRetryDelayMs(retryAfter: string | null, retryNumber: number, maxDelayMs: number) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(retryAt) && retryAt >= 0) {
      const baseDelay = Math.min(retryAt, maxDelayMs);
      const positiveJitter = Math.random() * Math.min(1_000, maxDelayMs - baseDelay);
      return Math.min(Math.round(baseDelay + positiveJitter), maxDelayMs);
    }
  }
  const exponential = Math.min(500 * 2 ** (retryNumber - 1), maxDelayMs);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function geminiStreamTimeoutMs() {
  const configured = Number(process.env["GEMINI_STREAM_TIMEOUT_MS"]);
  if (Number.isInteger(configured) && configured >= 1_000 && configured <= 900_000) {
    return configured;
  }
  return DEFAULT_GEMINI_STREAM_TIMEOUT_MS;
}

function classifyFetchFailure(error: unknown, signal?: AbortSignal) {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : typeof error === "object" &&
          error !== null &&
          "cause" in error &&
          typeof error.cause === "object" &&
          error.cause !== null &&
          "code" in error.cause
        ? String(error.cause.code)
        : undefined;
  const errorName =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : undefined;
  if (signal?.aborted) {
    const reason = signal.reason;
    const reasonName =
      typeof reason === "object" && reason !== null && "name" in reason
        ? String(reason.name)
        : undefined;
    if (reasonName === "TimeoutError") return "timeout";
    if (reasonName === "AbortError") return "aborted";
  }
  if (errorName === "TimeoutError") return "timeout";
  if (errorName === "AbortError") return "aborted";
  if (
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(
      errorCode ?? "",
    )
  ) {
    return errorCode === "ETIMEDOUT" ? "timeout" : "network_error";
  }
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
          failureCategory: response.ok
            ? "none"
            : response.status === 503
              ? "gemini_overloaded"
              : "gemini_http_error",
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
      failureCategory:
        classifyFetchFailure(error) === "timeout" ? "response_timeout" : "response_body_error",
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
  let activeTimeout: ReturnType<typeof setTimeout> | undefined;
  let activeSignal: AbortSignal | undefined;
  let lastTransientFailure:
    { model: string; attempt: number; status: number | null; category: string } | undefined;
  const clearActiveTimeout = () => {
    if (activeTimeout !== undefined) clearTimeout(activeTimeout);
    activeTimeout = undefined;
  };
  for (const model of MODEL_FALLBACKS) {
    selectedModel = model;
    let networkRetries = 0;
    let tryFallbackModel = false;
    for (let attempt = 1; attempt <= MAX_503_RETRIES + 1; attempt += 1) {
      selectedAttempt = attempt;
      const attemptStartedAt = Date.now();
      const controller = new AbortController();
      const timeoutMs = geminiStreamTimeoutMs();
      const attemptTimeout = setTimeout(
        () => controller.abort(new DOMException("Gemini stream request timed out", "TimeoutError")),
        timeoutMs,
      );
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          { ...request, signal: controller.signal },
        );
      } catch (error) {
        clearTimeout(attemptTimeout);
        response = undefined;
        const failureCategory = classifyFetchFailure(error, controller.signal);
        logGeminiMetric({
          requestId,
          operation: "streamGenerateContent",
          model,
          status: null,
          requestMs: Date.now() - attemptStartedAt,
          attempt,
          requestBodyBytes,
          failureCategory,
        });
        if (
          failureCategory !== "network_error" &&
          failureCategory !== "timeout" &&
          failureCategory !== "aborted"
        ) {
          throw new Error("Gemini rejected the streaming request before it started.", {
            cause: error,
          });
        }
        lastTransientFailure = { model, attempt, status: null, category: failureCategory };
        if (networkRetries < MAX_STREAM_NETWORK_RETRIES) {
          networkRetries += 1;
          const delayMs = streamRetryDelayMs(null, networkRetries, MAX_RETRY_AFTER_MS);
          logGeminiMetric({
            requestId,
            operation: "streamGenerateContent",
            model,
            status: null,
            attempt,
            retryDelayMs: delayMs,
            failureCategory: `${failureCategory}_retry`,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        tryFallbackModel = true;
        break;
      }
      logGeminiMetric({
        requestId,
        operation: "streamGenerateContent",
        model,
        status: response.status,
        requestMs: Date.now() - attemptStartedAt,
        attempt,
        requestBodyBytes,
        failureCategory: response.ok
          ? "none"
          : response.status === 503
            ? "gemini_overloaded"
            : response.status === 429
              ? "gemini_rate_limited"
              : "gemini_http_error",
      });
      const retryableStatus = response.status === 503 || response.status === 429;
      if (retryableStatus) {
        clearTimeout(attemptTimeout);
        const category = response.status === 429 ? "gemini_rate_limited" : "gemini_overloaded";
        lastTransientFailure = { model, attempt, status: response.status, category };
        if (attempt <= MAX_503_RETRIES) {
          const delayMs = streamRetryDelayMs(
            response.headers.get("retry-after"),
            attempt,
            response.status === 429 ? MAX_RATE_LIMIT_BACKOFF_MS : MAX_RETRY_AFTER_MS,
          );
          logGeminiMetric({
            requestId,
            operation: "streamGenerateContent",
            model,
            status: response.status,
            attempt,
            retryDelayMs: delayMs,
            failureCategory: `${category}_retry`,
          });
          const retryResponse = response;
          response = undefined;
          try {
            await (retryResponse.body?.cancel() ?? Promise.resolve());
          } catch {
            // The bounded retry should proceed even if the error body cannot be cancelled.
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        response = undefined;
        tryFallbackModel = true;
        break;
      }

      activeTimeout = attemptTimeout;
      activeSignal = controller.signal;
      selectedAttempt = attempt;
      break;
    }
    if (activeSignal) break;
    if (tryFallbackModel) continue;
  }
  if (!response) {
    const failure = lastTransientFailure;
    const failureCategory = failure?.category ?? "no_response";
    logGeminiMetric({
      requestId,
      operation: "streamGenerateContent",
      model: failure?.model ?? selectedModel,
      status: failure?.status ?? null,
      attempt: failure?.attempt ?? selectedAttempt,
      totalMs: Date.now() - startedAt,
      failureCategory: `${failureCategory}_all_models_exhausted`,
    });
    if (failure?.status === 429) {
      throw new Error(
        "Gemini rate limit reached after bounded retries. Please wait before trying again.",
      );
    }
    if (failure?.status === 503) {
      throw new Error("Gemini is temporarily overloaded after bounded retries. Please try again.");
    }
    if (failure?.category === "timeout") {
      throw new Error(
        "Gemini did not respond before the configured timeout on the available models. Please try again.",
      );
    }
    if (failure?.category === "network_error" || failure?.category === "aborted") {
      throw new Error("The connection to Gemini failed after bounded retries. Please try again.");
    }
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
    } finally {
      clearActiveTimeout();
    }
    const failureCategory =
      response.status === 400
        ? "gemini_invalid_request"
        : response.status === 401 || response.status === 403
          ? "gemini_auth_error"
          : response.status === 404
            ? "gemini_model_error"
            : "gemini_http_error";
    logGeminiMetric({
      requestId,
      operation: "streamGenerateContent",
      model: selectedModel,
      status: response.status,
      attempt: selectedAttempt,
      requestBodyBytes,
      totalMs: Date.now() - startedAt,
      failureCategory,
    });
    if (failureCategory === "gemini_auth_error") {
      throw new Error("Gemini authentication failed. Check the server API key and permissions.");
    }
    if (failureCategory === "gemini_invalid_request") {
      throw new Error(`Gemini rejected the request (400): ${message}`);
    }
    throw new Error(`Gemini request failed (${response.status}): ${message}`);
  }
  if (!response.body) {
    clearActiveTimeout();
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
      const streamFailureCategory = classifyFetchFailure(error, activeSignal);
      logGeminiMetric({
        requestId,
        operation: "streamGenerateContent",
        model: selectedModel,
        status: response.status,
        attempt: selectedAttempt,
        requestBodyBytes,
        totalMs: Date.now() - startedAt,
        failureCategory:
          failurePhase === "stream_callback"
            ? "stream_callback_error"
            : streamFailureCategory === "network_error"
              ? "stream_network_error"
              : streamFailureCategory === "timeout"
                ? "stream_timeout"
                : streamFailureCategory === "aborted"
                  ? "stream_aborted"
                  : "stream_read_error",
      });
      if (failurePhase !== "stream_callback" && streamFailureCategory === "timeout") {
        throw new Error("Gemini timed out while streaming the response. Please try again.", {
          cause: error,
        });
      }
      if (
        failurePhase !== "stream_callback" &&
        (streamFailureCategory === "network_error" || streamFailureCategory === "aborted")
      ) {
        throw new Error(
          "The Gemini connection was interrupted while streaming. Please try again.",
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    reader.releaseLock();
    clearActiveTimeout();
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
