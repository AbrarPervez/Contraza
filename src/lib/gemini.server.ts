import { z } from "zod";

type GeminiContent = {
  role: "user" | "model";
  parts: { text: string }[];
};

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() })),
    }).optional(),
    finishReason: z.string().optional(),
  })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const MODEL_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash"] as const;
const MAX_503_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 5_000;

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
  };
  let response: Response | undefined;
  for (const model of MODEL_FALLBACKS) {
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      response = await fetch(url, request);
      if (response.status !== 503) break;
      if (attempt < MAX_503_RETRIES) {
        const retryAfter = response.headers.get("retry-after");
        await new Promise((resolve) => setTimeout(
          resolve,
          retryDelayMs(retryAfter, attempt + 1),
        ));
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
    throw new Error(`Gemini request failed (${response.status}): ${message ?? response.statusText}`);
  }
  if (!result.success) throw new Error("Gemini returned an unexpected response format.");

  const candidate = result.data.candidates?.[0];
  const text = candidate?.content?.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const reason = candidate?.finishReason;
    throw new Error(reason
      ? `Gemini returned no text (finish reason: ${reason}).`
      : "Gemini returned no text.");
  }
  return text;
}
