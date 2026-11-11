import { describe, expect, it } from "vitest";
import {
  parseUnstructuredDraftResponse,
  parseUnstructuredDraftResponsePartial,
} from "./unstructured-draft";

describe("parseUnstructuredDraftResponse", () => {
  it("extracts a generated contract from the assistant's response", () => {
    expect(
      parseUnstructuredDraftResponse(
        `Here is the draft based on your confirmed details.\n\n<<<CONTRAZA_CONTRACT_START>>>\n# Rental Agreement\n\nTerms.\n<<<CONTRAZA_CONTRACT_END>>>`,
      ),
    ).toEqual({
      reply: "Here is the draft based on your confirmed details.",
      contractText: "# Rental Agreement\n\nTerms.",
    });
  });

  it("keeps ordinary assistant replies intact", () => {
    expect(parseUnstructuredDraftResponse("What jurisdiction should this agreement use?")).toEqual({
      reply: "What jurisdiction should this agreement use?",
      contractText: null,
    });
  });

  it("does not treat an empty marked section as a generated contract", () => {
    expect(
      parseUnstructuredDraftResponse(
        "<<<CONTRAZA_CONTRACT_START>>>\n\n<<<CONTRAZA_CONTRACT_END>>>",
      ),
    ).toEqual({
      reply: "<<<CONTRAZA_CONTRACT_START>>>\n\n<<<CONTRAZA_CONTRACT_END>>>",
      contractText: null,
    });
  });

  it("hides partial start delimiters split across stream updates", () => {
    const start = "<<<CONTRAZA_CONTRACT_START>>>";
    for (let length = 1; length < start.length; length += 1) {
      expect(parseUnstructuredDraftResponsePartial(`Here is the draft. ${start.slice(0, length)}`))
        .toEqual({ reply: "Here is the draft.", contractText: null });
    }
  });

  it("hides partial end delimiters while streaming a contract", () => {
    const end = "<<<CONTRAZA_CONTRACT_END>>>";
    for (let length = 1; length < end.length; length += 1) {
      expect(
        parseUnstructuredDraftResponsePartial(
          `Draft ready.\n<<<CONTRAZA_CONTRACT_START>>>\n# Agreement\n${end.slice(0, length)}`,
        ),
      ).toEqual({ reply: "Draft ready.", contractText: "# Agreement" });
    }
  });

  it("shows incomplete stream content without exposing delimiter fragments", () => {
    expect(
      parseUnstructuredDraftResponsePartial(
        "Draft ready.\n<<<CONTRAZA_CONTRACT_START>>>\n# Agreement terms",
      ),
    ).toEqual({ reply: "Draft ready.", contractText: "# Agreement terms" });
    expect(parseUnstructuredDraftResponsePartial("What jurisdiction should this")).toEqual({
      reply: "What jurisdiction should this",
      contractText: null,
    });
  });
});
