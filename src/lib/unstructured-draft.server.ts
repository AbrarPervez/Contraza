import {
  parseUnstructuredDraftResponse,
  parseUnstructuredDraftResponsePartial,
} from "./unstructured-draft";

type GeminiContent = {
  role: "user" | "model";
  parts: { text: string }[];
};

type AssistantMessageWriter = {
  update(data: { content: string; contractText?: string }): Promise<unknown>;
  delete(): Promise<unknown>;
};

type GenerateTextStream = (
  systemInstruction: string,
  contents: GeminiContent[],
  onText: (text: string) => Promise<void>,
) => Promise<string>;

type ParsedDraftResponse = ReturnType<typeof parseUnstructuredDraftResponse>;

const FIRESTORE_STREAM_FLUSH_INTERVAL_MS = 500;

export async function streamUnstructuredDraftResponse(
  generateTextStream: GenerateTextStream,
  systemInstruction: string,
  contents: GeminiContent[],
  assistantMessage: AssistantMessageWriter,
  onComplete: (parsed: ParsedDraftResponse) => Promise<void>,
) {
  let lastFlush = Number.NEGATIVE_INFINITY;
  try {
    const response = await generateTextStream(systemInstruction, contents, async (partial) => {
      const now = Date.now();
      if (now - lastFlush < FIRESTORE_STREAM_FLUSH_INTERVAL_MS) return;
      lastFlush = now;

      const parsed = parseUnstructuredDraftResponsePartial(partial);
      await assistantMessage.update({
        content: parsed.reply,
        ...(parsed.contractText ? { contractText: parsed.contractText } : {}),
      });
    });

    const parsed = parseUnstructuredDraftResponse(response);
    if (!parsed.reply && !parsed.contractText) {
      throw new Error("The AI returned an empty response. Please try again.");
    }
    await onComplete(parsed);
    return parsed;
  } catch (error) {
    await assistantMessage.delete();
    throw error;
  }
}
