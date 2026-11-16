import { createServerFn } from "@tanstack/react-start";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";
import { generateGeminiTextStream } from "./gemini.server";
import { isNda, missingContractFields, restoreContractParams } from "./contracts";
import { streamUnstructuredDraftResponse } from "./unstructured-draft.server";
import { languageInstruction, type ContrazaLanguage } from "./languages";

const languageSchema = z.enum([
  "en",
  "hi",
  "te",
  "ta",
  "kn",
  "ml",
  "bn",
  "mr",
  "gu",
  "pa",
  "ur",
]);

const documentId = z
  .string()
  .min(1)
  .max(1500)
  .regex(/^[^/]+$/);

function shouldFlushGenerationProgress(
  text: string,
  lastPersistedLength: number,
  lastPersistedAt: number,
) {
  const elapsed = Date.now() - lastPersistedAt;
  return elapsed >= 500 || (elapsed >= 200 && text.slice(lastPersistedLength).includes("\n"));
}

const DRAFT_SYSTEM = `You are a senior commercial real-estate lawyer drafting lease agreements between private businesses.
Draft a complete, formal, professionally structured Commercial Lease Agreement in Markdown using ONLY the parameters provided.
Structure: title (# heading), recitals/parties, numbered articles (## 1. Definitions, ## 2. Premises, ## 3. Term ...), each with numbered sub-clauses.
Include every selected clause as its own article. Incorporate special terms. Where a value is missing, insert a bracketed placeholder like [●].
End with an "IN WITNESS WHEREOF" execution block stating the place and date of signing, followed by signature blocks: for each party a signature line, the authorised signatory's name and designation, and the party's seal; then signature lines for both named witnesses. Do not add commentary before or after the agreement.`;

export const generateLease = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { draftId: string; language?: ContrazaLanguage; diagnosticId?: string }) =>
    z
      .object({
        draftId: documentId,
        language: languageSchema.default("en"),
        diagnosticId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const requestId = data.diagnosticId ?? crypto.randomUUID();
    const startedAt = Date.now();
    let stage = "firestore_read";
    let originalContent = "";
    let streamTouchedDraft = false;
    const draftRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("leaseDrafts")
      .doc(data.draftId);
    try {
      const readStartedAt = Date.now();
      const draft = await draftRef.get();
      console.info("[Contraza Draft]", {
        requestId,
        stage: "firestore_read",
        requestMs: Date.now() - readStartedAt,
        found: draft.exists,
      });
      if (!draft.exists) throw new Error("Draft not found");
      const draftData = draft.data();
      originalContent = typeof draftData?.["content"] === "string" ? draftData["content"] : "";
      const params = restoreContractParams(draftData?.["params"]);
      stage = "validation";
      const missing = missingContractFields(params);
      if (missing.length) throw new Error(`Please fill required fields: ${missing.join(", ")}`);

      stage = "gemini";
      let lastPersistedLength = 0;
      let lastPersistedAt = 0;
      const content = await generateGeminiTextStream(
        `${isNda(params) ? NDA_SYSTEM : DRAFT_SYSTEM}\n\n${languageInstruction(data.language)}`,
        [
          {
            role: "user",
            parts: [
              {
                text: `${isNda(params) ? "NDA" : "Lease"} parameters (JSON):\n${JSON.stringify(params, null, 2)}`,
              },
            ],
          },
        ],
        async (partial) => {
          if (new TextEncoder().encode(partial).byteLength > 700_000) {
            throw new Error(
              "The generated contract is too large to save. Please try generating a shorter draft.",
            );
          }
          if (!shouldFlushGenerationProgress(partial, lastPersistedLength, lastPersistedAt)) return;
          stage = "firestore_progress_write";
          streamTouchedDraft = true;
          await draftRef.update({ content: partial });
          lastPersistedLength = partial.length;
          lastPersistedAt = Date.now();
          stage = "gemini";
        },
        { requestId },
      );
      if (!content) throw new Error("The AI returned an empty draft. Please try again.");
      if (new TextEncoder().encode(content).byteLength > 700_000) {
        throw new Error(
          "The generated contract is too large to save. Please try generating a shorter draft.",
        );
      }

      stage = "firestore_write";
      const writeStartedAt = Date.now();
      await draftRef.update({ content, updatedAt: new Date().toISOString() });
      streamTouchedDraft = false;
      console.info("[Contraza Draft]", {
        requestId,
        stage: "firestore_write",
        requestMs: Date.now() - writeStartedAt,
        totalMs: Date.now() - startedAt,
        failureCategory: "none",
      });
      return { content };
    } catch (error) {
      if (streamTouchedDraft) {
        try {
          await draftRef.update({ content: originalContent });
        } catch {
          console.error("[Contraza Draft]", {
            requestId,
            stage: "restore_after_failure",
            failureCategory: "firebase_restore_error",
          });
        }
      }
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          (error.cause instanceof Error && error.cause.name === "TimeoutError"));
      console.warn("[Contraza Draft]", {
        requestId,
        stage,
        totalMs: Date.now() - startedAt,
        failureCategory:
          stage === "gemini"
            ? isTimeout
              ? "gemini_timeout"
              : "gemini_error"
            : stage.startsWith("firestore_")
              ? "firebase_error"
              : "validation_error",
      });
      throw error;
    }
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
Use clear Markdown and be direct. For a specific question, answer it first and focus on relevant clauses. For broad review requests, cover all material issues with supporting clause references and risk ratings. Avoid repeating information, unnecessary background, and boilerplate disclaimers. Never omit material risks or invent contract terms. Remind the user briefly, only when relevant, that this is not a substitute for advice from a qualified lawyer.`;

export const sendReviewMessage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { threadId: string; message: string; language?: ContrazaLanguage }) =>
    z
      .object({
        threadId: documentId,
        message: z.string().trim().min(1).max(8000),
        language: languageSchema.default("en"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const threadRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("reviewThreads")
      .doc(data.threadId);
    const threadSnapshot = await threadRef.get();
    if (!threadSnapshot.exists) throw new Error("Review not found");
    const thread = threadSnapshot.data()!;
    const messages = threadRef.collection("messages");
    const userMessageRef = messages.doc();
    const userMessage = {
      role: "user",
      content: data.message,
      createdAt: new Date().toISOString(),
    };
    const [historySnapshot] = await Promise.all([
      messages.orderBy("createdAt").get(),
      userMessageRef.set(userMessage),
    ]);

    const contractText = typeof thread["contractText"] === "string" ? thread["contractText"] : "";
    const contract = contractText.trim()
      ? `CONTRACT UNDER REVIEW:\n"""\n${contractText.slice(0, 120000)}\n"""`
      : "No contract text has been provided yet.";

    const contents = historySnapshot.docs
      .filter((message) => message.id !== userMessageRef.id)
      .map((message) => {
        const savedMessage = message.data();
        const role = savedMessage["role"];
        const content = savedMessage["content"];
        if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
          throw new Error("Review history contains an invalid message.");
        }
        return {
          role: role === "assistant" ? ("model" as const) : ("user" as const),
          parts: [{ text: content }],
        };
      });
    contents.push({
      role: "user",
      parts: [{ text: data.message }],
    });
    const assistantMessageRef = messages.doc();
    const createdAt = new Date().toISOString();
    await assistantMessageRef.create({
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt,
    });
    let lastFlush = 0;
    let reply: string;
    try {
      reply = await generateGeminiTextStream(
        `${REVIEW_SYSTEM}\n\n${languageInstruction(data.language)}\n\n${contract}`,
        contents,
        async (partial) => {
          if (Date.now() - lastFlush < 500) return;
          lastFlush = Date.now();
          await assistantMessageRef.update({ content: partial });
        },
      );
    } catch (error) {
      await assistantMessageRef.delete();
      throw error;
    }

    const now = new Date().toISOString();
    const batch = context.adminDb.batch();
    batch.update(assistantMessageRef, { content: reply, status: "complete" });
    const update: { updatedAt: string; title?: string } = { updatedAt: now };
    if (thread["title"] === "New review") update.title = data.message.slice(0, 60);
    batch.update(threadRef, update);
    await batch.commit();

    return { reply, messageId: assistantMessageRef.id };
  });

const EDIT_SYSTEM = `You are a senior commercial lawyer revising a commercial lease or non-disclosure agreement (NDA). Identify and preserve the document type, including mutual or one-way disclosure obligations for NDAs.
Apply the user's requested change to the contract text precisely and consistently: update every clause, cross-reference, definition, and schedule affected by the change so the document stays internally coherent.
Preserve the original structure, formatting (Markdown), numbering, and all unaffected wording. Do not add commentary — return ONLY the full revised contract text.`;

export const renameReviewThread = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { threadId: string; title: string }) =>
    z.object({ threadId: documentId, title: z.string().trim().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const threadRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("reviewThreads")
      .doc(data.threadId);
    if (!(await threadRef.get()).exists) throw new Error("Review not found.");
    await threadRef.update({ title: data.title, updatedAt: new Date().toISOString() });
    return { id: data.threadId, title: data.title };
  });

export const applyLeaseEdit = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { threadId: string; instruction: string; language?: ContrazaLanguage }) =>
    z
      .object({
        threadId: documentId,
        instruction: z.string().trim().min(3).max(4000),
        language: languageSchema.default("en"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const threadRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("reviewThreads")
      .doc(data.threadId);
    const threadSnapshot = await threadRef.get();
    if (!threadSnapshot.exists) throw new Error("Review not found");
    const thread = threadSnapshot.data()!;
    const contractText = typeof thread["contractText"] === "string" ? thread["contractText"] : "";
    if (!contractText.trim()) throw new Error("Attach a contract first, then ask for edits.");

    let lastPersistedLength = 0;
    let lastPersistedAt = 0;
    let streamTouchedContract = false;
    try {
      const revised = await generateGeminiTextStream(
        `${EDIT_SYSTEM}\n\n${languageInstruction(data.language)}`,
        [
          {
            role: "user",
            parts: [
              {
                text: `CONTRACT TEXT:\n"""\n${contractText.slice(0, 120000)}\n"""\n\nREQUESTED CHANGE:\n${data.instruction}`,
              },
            ],
          },
        ],
        async (partial) => {
          if (new TextEncoder().encode(partial).byteLength > 700_000) {
            throw new Error("The revised contract is too large to save. Keep it under 700 KB.");
          }
          if (!shouldFlushGenerationProgress(partial, lastPersistedLength, lastPersistedAt)) return;
          streamTouchedContract = true;
          await threadRef.update({ contractText: partial });
          lastPersistedLength = partial.length;
          lastPersistedAt = Date.now();
        },
      );
      if (!revised) throw new Error("The AI returned an empty revision. Please try again.");
      if (new TextEncoder().encode(revised).byteLength > 700_000) {
        throw new Error("The revised contract is too large to save. Keep it under 700 KB.");
      }

      const now = new Date().toISOString();
      const batch = context.adminDb.batch();
      batch.update(threadRef, { contractText: revised, updatedAt: now });
      const messages = threadRef.collection("messages");
      batch.create(messages.doc(), {
        role: "user",
        content: `Edit requested: ${data.instruction}`,
        createdAt: now,
      });
      batch.create(messages.doc(), {
        role: "assistant",
        content:
          "I've applied that change and updated the attached contract. Open the contract panel to review the revised text.",
        createdAt: new Date(Date.now() + 1).toISOString(),
      });
      await batch.commit();
      streamTouchedContract = false;

      return { revised };
    } catch (error) {
      if (streamTouchedContract) {
        try {
          await threadRef.update({ contractText });
        } catch {
          console.error("[Contraza Review Edit]", {
            stage: "restore_after_failure",
            failureCategory: "firebase_restore_error",
          });
        }
      }
      throw error;
    }
  });

const UNSTRUCTURED_DRAFT_SYSTEM = `You are Contraza AI Assistant, a conversational contract assistant for businesses.
Help users discuss different contract types, explain legal language in plain English, compare agreements, explain clauses and their purpose, and discuss obligations and risks. Do not claim to be a lawyer or guarantee legal enforceability.
Maintain the requirements already stated in the conversation. Do not repeat questions whose answers are already present. Collect information naturally by asking one or two focused questions at a time; prioritize contract type, jurisdiction, parties, purpose, key obligations, payment, duration, termination, and risk preferences as relevant. For ordinary questions, answer directly and concisely while preserving material details. Never invent personal details, amounts, dates, or governing law. Do not silently assume jurisdiction-specific legal rules.
Before preparing a new contract, collect enough details, summarize the proposed terms and any unresolved or ambiguous points, and ask the user to confirm the summary. Do not generate the contract until the user explicitly confirms. If material details remain unclear, ask a focused follow-up rather than guessing; use clearly marked [INSERT ...] placeholders only for nonessential missing specifics.
After confirmation, generate a complete, professionally structured Markdown contract with a title, parties, background, definitions where useful, coherent numbered terms, rights and obligations, relevant payment, duration and termination, appropriate confidentiality, indemnity and liability, dispute resolution and governing law, and signature and witness blocks where appropriate. Ensure provisions and cross-references are consistent. Recommend review by a qualified local lawyer for jurisdiction-specific or high-stakes matters.
When returning a generated or revised contract, put any brief introduction first, then wrap the entire contract exactly between <<<CONTRAZA_CONTRACT_START>>> and <<<CONTRAZA_CONTRACT_END>>> on separate lines. Do not put anything inside those markers except the contract.
For a requested revision to an existing contract, preserve all unrelated wording and terms, change only what the user asked for plus necessary consequential cross-references, and return the full revised contract inside the markers. Do not repeat the requirement-confirmation step for a clear edit to an already generated contract. For a request to regenerate after confirmation, use the confirmed requirements and current draft as the baseline.
If the user asks a general question or discussion rather than requesting a draft, answer conversationally and do not produce a full contract.`;

export const createUnstructuredDraftChat = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const now = new Date().toISOString();
    const chat = await context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .add({ title: "New conversation", createdAt: now, updatedAt: now });
    return { id: chat.id };
  });

export const listUnstructuredDraftChats = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const snapshot = await context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .orderBy("updatedAt", "desc")
      .get();
    return snapshot.docs.map((chat) => {
      const data = chat.data();
      if (typeof data["title"] !== "string" || typeof data["updatedAt"] !== "string") {
        throw new Error("Drafting history contains an invalid conversation.");
      }
      return { id: chat.id, title: data["title"], updatedAt: data["updatedAt"] };
    });
  });

export const renameUnstructuredDraftChat = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { chatId: string; title: string }) =>
    z.object({ chatId: documentId, title: z.string().trim().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const chatRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .doc(data.chatId);
    if (!(await chatRef.get()).exists) throw new Error("Drafting conversation not found.");
    await chatRef.update({ title: data.title, updatedAt: new Date().toISOString() });
    return { id: data.chatId, title: data.title };
  });

export const deleteUnstructuredDraftChat = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { chatId: string }) => z.object({ chatId: documentId }).parse(d))
  .handler(async ({ data, context }) => {
    const chatRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .doc(data.chatId);
    if (!(await chatRef.get()).exists) {
      throw new Error("Drafting conversation not found.");
    }
    await context.adminDb.recursiveDelete(chatRef);
    return { id: data.chatId };
  });

export const getUnstructuredDraftChat = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { chatId: string }) => z.object({ chatId: documentId }).parse(d))
  .handler(async ({ data, context }) => {
    const chatRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .doc(data.chatId);
    const [chat, messages] = await Promise.all([
      chatRef.get(),
      chatRef.collection("messages").orderBy("createdAt").get(),
    ]);
    if (!chat.exists) throw new Error("Drafting conversation not found.");
    return {
      messages: messages.docs.flatMap((message) => {
        const saved = message.data();
        if (
          (saved["role"] !== "user" && saved["role"] !== "assistant") ||
          typeof saved["content"] !== "string"
        ) {
          throw new Error("Drafting conversation contains an invalid message.");
        }
        if (
          saved["role"] === "assistant" &&
          saved["status"] === "streaming" &&
          !saved["content"].trim() &&
          typeof saved["contractText"] !== "string"
        ) {
          return [];
        }
        return {
          id: message.id,
          role: saved["role"],
          content: saved["content"],
          ...(saved["status"] === "streaming" || saved["status"] === "complete"
            ? { status: saved["status"] }
            : {}),
          ...(typeof saved["contractText"] === "string"
            ? { contractText: saved["contractText"] }
            : {}),
        };
      }),
    };
  });

export const sendUnstructuredDraftMessage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator(
    (d: { chatId: string; message: string; userMessageId: string; language?: ContrazaLanguage }) =>
      z
        .object({
          chatId: documentId,
          message: z.string().trim().min(1).max(8000),
          userMessageId: z.string().uuid(),
          language: languageSchema.default("en"),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const chatRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .doc(data.chatId);
    const chatSnapshot = await chatRef.get();
    if (!chatSnapshot.exists) throw new Error("Drafting conversation not found");

    const messages = chatRef.collection("messages");
    const userMessageRef = messages.doc(data.userMessageId);
    const userMessage = {
      role: "user",
      content: data.message,
      createdAt: new Date().toISOString(),
    };
    const [historySnapshot] = await Promise.all([
      messages.orderBy("createdAt").get(),
      userMessageRef.create(userMessage),
    ]);

    const savedMessages = historySnapshot.docs.filter((message) => {
      if (message.id === userMessageRef.id) return false;
      const saved = message.data();
      return !(saved["role"] === "assistant" && saved["status"] === "streaming");
    });
    const latestContract = [...savedMessages]
      .reverse()
      .find((message) => {
        const saved = message.data();
        return saved["role"] === "assistant" && typeof saved["contractText"] === "string";
      })
      ?.data()["contractText"];
    const contents = savedMessages.map((message) => {
      const savedMessage = message.data();
      const role = savedMessage["role"];
      const content = savedMessage["content"];
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        throw new Error("Drafting conversation contains an invalid message.");
      }
      return {
        role: role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: content }],
      };
    });
    if (typeof latestContract === "string" && latestContract) {
      contents.push({
        role: "model",
        parts: [{ text: `[Current generated contract]\n${latestContract}` }],
      });
    }
    contents.push({ role: "user", parts: [{ text: data.message }] });

    const assistantMessageRef = messages.doc();
    await assistantMessageRef.create({
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    });

    const { reply, contractText } = await streamUnstructuredDraftResponse(
      generateGeminiTextStream,
      `${UNSTRUCTURED_DRAFT_SYSTEM}\n\n${languageInstruction(data.language)}`,
      contents,
      assistantMessageRef,
      async (parsed) => {
        const now = new Date().toISOString();
        const batch = context.adminDb.batch();
        batch.update(assistantMessageRef, {
          content: parsed.reply,
          contractText: parsed.contractText ?? FieldValue.delete(),
          status: "complete",
        });
        const update: { updatedAt: string; title?: string } = { updatedAt: now };
        if (chatSnapshot.data()?.["title"] === "New conversation") {
          update.title = data.message.slice(0, 60);
        }
        batch.update(chatRef, update);
        await batch.commit();
      },
    );

    return { reply, contractText, messageId: assistantMessageRef.id };
  });

export const saveUnstructuredDraftContract = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((d: { chatId: string; messageId: string; contractText: string }) =>
    z
      .object({
        chatId: documentId,
        messageId: documentId,
        contractText: z.string().trim().min(1).max(700_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const chatRef = context.adminDb
      .collection("users")
      .doc(context.userId)
      .collection("draftChats")
      .doc(data.chatId);
    const messageRef = chatRef.collection("messages").doc(data.messageId);
    const message = await messageRef.get();
    if (!message.exists || message.data()?.["role"] !== "assistant") {
      throw new Error("Generated contract not found.");
    }
    if (new TextEncoder().encode(data.contractText).byteLength > 700_000) {
      throw new Error("The edited contract is too large to save. Keep it under 700 KB.");
    }

    const batch = context.adminDb.batch();
    batch.update(messageRef, { contractText: data.contractText });
    batch.update(chatRef, { updatedAt: new Date().toISOString() });
    await batch.commit();
    return { contractText: data.contractText };
  });


export const transcribeSpeech = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator(
    (d: { audioBase64: string; mimeType: string; language: ContrazaLanguage }) =>
      z
        .object({
          audioBase64: z
            .string()
            .min(100)
            .max(7_000_000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          mimeType: z.enum([
            "audio/webm",
            "audio/mp4",
            "audio/mpeg",
            "audio/wav",
            "audio/ogg",
            "audio/aac",
            "audio/flac",
          ]),
          language: languageSchema,
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["GEMINI_API_KEY"]?.trim();
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

    const selectedLanguage = (
      {
        en: "English",
        hi: "Hindi",
        te: "Telugu",
        ta: "Tamil",
        kn: "Kannada",
        ml: "Malayalam",
        bn: "Bengali",
        mr: "Marathi",
        gu: "Gujarati",
        pa: "Punjabi",
        ur: "Urdu",
      } as const
    )[data.language];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Transcribe the attached speech into text. The expected language is ${selectedLanguage}, but preserve the actual spoken language if the speaker switches languages. Do not translate, summarize, interpret, or answer the speaker. Preserve names, numbers, dates, currency amounts, and legal terminology. Return only the transcript, with natural punctuation.`,
                  },
                  {
                    inline_data: {
                      mime_type: data.mimeType,
                      data: data.audioBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096,
            },
          }),
        },
      );

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "object" &&
          payload.error !== null &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : response.statusText;
        throw new Error(`Speech transcription failed (${response.status}): ${message}`);
      }

      const parsed = z
        .object({
          candidates: z
            .array(
              z.object({
                content: z
                  .object({
                    parts: z.array(z.object({ text: z.string().optional() })),
                  })
                  .optional(),
              }),
            )
            .optional(),
        })
        .safeParse(payload);
      if (!parsed.success) {
        throw new Error("Gemini returned an unexpected transcription response.");
      }

      const transcript = parsed.data.candidates?.[0]?.content?.parts
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!transcript) {
        throw new Error("No speech was recognized. Please try recording again.");
      }
      return { transcript };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Speech transcription timed out. Please try a shorter recording.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
