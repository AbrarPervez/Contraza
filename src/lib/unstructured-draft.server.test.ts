import { describe, expect, it, vi } from "vitest";
import { streamUnstructuredDraftResponse } from "./unstructured-draft.server";

type GenerateTextStream = Parameters<typeof streamUnstructuredDraftResponse>[0];

const systemInstruction = "draft system";
const contents = [{ role: "user" as const, parts: [{ text: "draft request" }] }];

function createAssistantMessageWriter() {
  return {
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("streamUnstructuredDraftResponse", () => {
  it("uses the final parser result when a stream ends with an incomplete contract", async () => {
    const writer = createAssistantMessageWriter();
    const response = "Draft ready.\n<<<CONTRAZA_CONTRACT_START>>>\n# Agreement";
    const generateTextStream: GenerateTextStream = async (_system, _contents, onText) => {
      await onText(response);
      return response;
    };
    const onComplete = vi.fn().mockResolvedValue(undefined);

    await expect(
      streamUnstructuredDraftResponse(
        generateTextStream,
        systemInstruction,
        contents,
        writer,
        onComplete,
      ),
    ).resolves.toEqual({ reply: response, contractText: null });

    expect(writer.update).toHaveBeenCalledWith({
      content: "Draft ready.",
      contractText: "# Agreement",
    });
    expect(onComplete).toHaveBeenCalledWith({ reply: response, contractText: null });
    expect(writer.delete).not.toHaveBeenCalled();
  });

  it("deletes the partial assistant message and rethrows when generation fails", async () => {
    const writer = createAssistantMessageWriter();
    const streamError = new Error("Gemini stream failed");
    const generateTextStream: GenerateTextStream = async (_system, _contents, onText) => {
      await onText("A partial answer");
      throw streamError;
    };

    await expect(
      streamUnstructuredDraftResponse(
        generateTextStream,
        systemInstruction,
        contents,
        writer,
        vi.fn().mockResolvedValue(undefined),
      ),
    ).rejects.toBe(streamError);

    expect(writer.update).toHaveBeenCalledOnce();
    expect(writer.delete).toHaveBeenCalledOnce();
  });

  it("deletes the partial message if final Firestore persistence fails", async () => {
    const writer = createAssistantMessageWriter();
    const persistenceError = new Error("Firestore batch failed");
    const generateTextStream: GenerateTextStream = async (_system, _contents, onText) => {
      await onText("Complete answer");
      return "Complete answer";
    };

    await expect(
      streamUnstructuredDraftResponse(
        generateTextStream,
        systemInstruction,
        contents,
        writer,
        vi.fn().mockRejectedValue(persistenceError),
      ),
    ).rejects.toBe(persistenceError);

    expect(writer.delete).toHaveBeenCalledOnce();
  });
});
