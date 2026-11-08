import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";
import { generateGeminiText } from "./gemini.server";
import { isNda, missingContractFields, restoreContractParams } from "./contracts";

const documentId = z.string().min(1).max(1500).regex(/^[^/]+$/);

const DRAFT_SYSTEM = `You are a senior commercial real-estate lawyer drafting lease agreements between private businesses.
Draft a complete, formal, professionally structured Commercial Lease Agreement in Markdown using ONLY the parameters provided.
Structure: title (# heading), recitals/parties, numbered articles (## 1. Definitions, ## 2. Premises, ## 3. Term ...), each with numbered sub-clauses.
Include every selected clause as its own article. Incorporate special terms. Where a value is missing, insert a bracketed placeholder like [●].
End with an "IN WITNESS WHEREOF" execution block stating the place and date of signing, followed by signature blocks: for each party a signature line, the authorised signatory's name and designation, and the party's seal; then signature lines for both named witnesses. Do not add commentary before or after the agreement.`;

export const generateLease = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { draftId: string }) => z.object({ draftId: documentId }).parse(d))
  .handler(async ({ data, context }) => {
    const draftRef = context.adminDb
      .collection("users").doc(context.userId).collection("leaseDrafts").doc(data.draftId);
    const draft = await draftRef.get();
    if (!draft.exists) throw new Error("Draft not found");
    const params = restoreContractParams(draft.data()?.["params"]);
    const missing = missingContractFields(params);
    if (missing.length) throw new Error(`Please fill required fields: ${missing.join(", ")}`);

    const content = await generateGeminiText(
      isNda(params) ? NDA_SYSTEM : DRAFT_SYSTEM,
      [{
        role: "user",
        parts: [{ text: `${isNda(params) ? "NDA" : "Lease"} parameters (JSON):\n${JSON.stringify(params, null, 2)}` }],
      }],
    );
    if (!content) throw new Error("The AI returned an empty draft. Please try again.");
    if (new TextEncoder().encode(content).byteLength > 700_000) {
      throw new Error("The generated contract is too large to save. Please try generating a shorter draft.");
    }

    await draftRef.update({ content, updatedAt: new Date().toISOString() });
    return { content };
  });

const NDA_SYSTEM = `You are a senior commercial lawyer drafting non-disclosure agreements between private businesses.
Draft a complete Non-Disclosure Agreement in Markdown using ONLY the parameters provided. Use a title, parties, recitals, numbered articles and sub-clauses.
For a Mutual NDA, both parties can be disclosing and receiving parties; for a One-way NDA, the first party is the disclosing party and the second is the receiving party.
Cover the stated purpose, definition of confidential information, exclusions, permitted recipients, restricted use and disclosure, reasonable safeguards, legally compelled disclosure, agreement duration and separate confidentiality survival period, return or destruction, no licence or transfer of intellectual property, remedies, governing law and disputes. Do not invent commercial values or add non-compete, non-solicitation or penalty terms unless expressly requested.
Incorporate the user's special terms. Use bracketed placeholders like [●] for missing specifics; do not guess dates or durations. Keep agreement duration distinct from confidentiality survival.
End with an IN WITNESS WHEREOF execution block with signing place and date, signature lines for both parties, authorised signatory names and designations, and witness signatures. Return ONLY the NDA without commentary.`;

const REVIEW_SYSTEM = `You are an expert commercial contract reviewer advising private businesses on commercial leases and non-disclosure agreements (NDAs).
Identify the attached agreement type from its text. For NDAs, assess mutual versus one-way obligations, protected information, exclusions, permitted use and recipients, compelled disclosure, confidentiality survival, return or destruction, intellectual property and remedies. Do not apply lease-specific assumptions to an NDA.
When a contract is provided, analyse it carefully. Answer the user's questions precisely, cite the clause numbers or quote the text you rely on,
flag risks (rated High / Medium / Low), missing protections, unusual or one-sided terms, and suggest improved wording when helpful.
If no contract text has been provided, answer general questions about commercial leases or NDAs and invite the user to paste their agreement.
Use clear Markdown. Remind the user briefly, only when relevant, that this is not a substitute for advice from a qualified lawyer.`;

export const sendReviewMessage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { threadId: string; message: string }) =>
    z.object({ threadId: documentId, message: z.string().trim().min(1).max(8000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const threadRef = context.adminDb
      .collection("users").doc(context.userId).collection("reviewThreads").doc(data.threadId);
    const threadSnapshot = await threadRef.get();
    if (!threadSnapshot.exists) throw new Error("Review not found");
    const thread = threadSnapshot.data()!;
    const messages = threadRef.collection("messages");
    await messages.add({
      role: "user",
      content: data.message,
      createdAt: new Date().toISOString(),
    });
    const historySnapshot = await messages.orderBy("createdAt").get();

    const contractText = typeof thread["contractText"] === "string" ? thread["contractText"] : "";
    const contract = contractText.trim()
      ? `CONTRACT UNDER REVIEW:\n"""\n${contractText.slice(0, 120000)}\n"""`
      : "No contract text has been provided yet.";

    const contents = historySnapshot.docs.map((message) => {
      const savedMessage = message.data();
      const role = savedMessage["role"];
      const content = savedMessage["content"];
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        throw new Error("Review history contains an invalid message.");
      }
      return {
        role: role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: content }],
      };
    });
    const reply = await generateGeminiText(`${REVIEW_SYSTEM}\n\n${contract}`, contents);

    const now = new Date().toISOString();
    await messages.add({ role: "assistant", content: reply, createdAt: now });
    const update: { updatedAt: string; title?: string } = { updatedAt: now };
    if (thread["title"] === "New review") update.title = data.message.slice(0, 60);
    await threadRef.update(update);

    return { reply };
  });

const EDIT_SYSTEM = `You are a senior commercial lawyer revising a commercial lease or non-disclosure agreement (NDA). Identify and preserve the document type, including mutual or one-way disclosure obligations for NDAs.
Apply the user's requested change to the contract text precisely and consistently: update every clause, cross-reference, definition, and schedule affected by the change so the document stays internally coherent.
Preserve the original structure, formatting (Markdown), numbering, and all unaffected wording. Do not add commentary — return ONLY the full revised contract text.`;

export const applyLeaseEdit = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { threadId: string; instruction: string }) =>
    z.object({ threadId: documentId, instruction: z.string().trim().min(3).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const threadRef = context.adminDb
      .collection("users").doc(context.userId).collection("reviewThreads").doc(data.threadId);
    const threadSnapshot = await threadRef.get();
    if (!threadSnapshot.exists) throw new Error("Review not found");
    const thread = threadSnapshot.data()!;
    const contractText = typeof thread["contractText"] === "string" ? thread["contractText"] : "";
    if (!contractText.trim()) throw new Error("Attach a contract first, then ask for edits.");

    const revised = await generateGeminiText(EDIT_SYSTEM, [{
      role: "user",
      parts: [{
        text: `CONTRACT TEXT:\n"""\n${contractText.slice(0, 120000)}\n"""\n\nREQUESTED CHANGE:\n${data.instruction}`,
      }],
    }]);
    if (!revised) throw new Error("The AI returned an empty revision. Please try again.");

    const now = new Date().toISOString();
    await threadRef.update({ contractText: revised, updatedAt: now });
    const batch = context.adminDb.batch();
    const messages = threadRef.collection("messages");
    batch.create(messages.doc(), {
      role: "user",
      content: `Edit requested: ${data.instruction}`,
      createdAt: now,
    });
    batch.create(messages.doc(), {
      role: "assistant",
      content: "I've applied that change and updated the attached contract. Open the contract panel to review the revised text.",
      createdAt: new Date(Date.now() + 1).toISOString(),
    });
    await batch.commit();

    return { revised };
  });
