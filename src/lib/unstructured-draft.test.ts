import { describe, expect, it } from "vitest";
import { parseUnstructuredDraftResponse } from "./unstructured-draft";

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
});
