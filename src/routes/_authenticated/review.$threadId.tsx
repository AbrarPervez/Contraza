import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getDoc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { reviewMessagesCollection, userDocument } from "@/integrations/firebase/data";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendReviewMessage, applyLeaseEdit } from "@/lib/lease.functions";
import { looksLikeContract } from "@/lib/contracts";

export const Route = createFileRoute("/_authenticated/review/$threadId")({
  head: () => ({
    meta: [
      { title: "Contract review conversation — Contraza" },
      {
        name: "description",
        content:
          "Review clauses, ask questions and revise your commercial lease or NDA in Contraza.",
      },
      { property: "og:title", content: "Contract review conversation — Contraza" },
      {
        property: "og:description",
        content:
          "Review clauses, ask questions and revise your commercial lease or NDA in Contraza.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Thread,
});

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "complete";
};

const SUGGESTIONS = [
  "Summarise the key commercial terms",
  "What are the biggest risks for each party?",
  "Is the termination clause balanced?",
  "Which standard protections are missing?",
];
const MAX_CONTRACT_BYTES = 700_000;

function Thread() {
  const { threadId } = Route.useParams();
  return <ThreadView key={threadId} threadId={threadId} />;
}

function ThreadView({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [contract, setContract] = useState("");
  const [savedContract, setSavedContract] = useState("");
  const [showDoc, setShowDoc] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onSnapshot(
        query(reviewMessagesCollection(threadId), orderBy("createdAt")),
        (snapshot) => {
          setMsgs(
            snapshot.docs.map((message) => {
              const data = message.data();
              return {
                id: message.id,
                role: data["role"] as Msg["role"],
                content: data["content"] as string,
                ...(data["status"] === "streaming" || data["status"] === "complete"
                  ? { status: data["status"] }
                  : {}),
              };
            }),
          );
        },
        (error) => toast.error(error.message || "Could not receive live review updates."),
      ),
    [threadId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const thread = await getDoc(userDocument("reviewThreads", threadId));
        if (cancelled) return;
        if (!thread.exists()) throw new Error("Review not found.");
        const contractText = thread.data()["contractText"] ?? "";
        setContract(contractText);
        setSavedContract(contractText);
        setShowDoc(!contractText);
        inputRef.current?.focus();
      } catch (error) {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not load this review.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pending]);

  async function uploadFile(file: File) {
    if (file.size > 2_000_000) {
      toast.error("File too large — please use a file under 2 MB");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error("That file appears to be empty");
        return;
      }
      if (new TextEncoder().encode(text).byteLength > MAX_CONTRACT_BYTES) {
        toast.error("Contract text is too large for Firestore. Please use a file under 700 KB.");
        return;
      }
      if (!looksLikeContract(text)) {
        toast.error("This doesn't look like a contract", {
          description:
            "The uploaded file doesn't contain typical contract language. Please upload a commercial lease or NDA, or paste its text.",
          duration: 6000,
        });
        return;
      }
      setContract(text);
      setShowDoc(true);
      toast.success(`Loaded ${file.name} — press "Attach contract" to save it`);
    } catch {
      toast.error(
        "Couldn't read that file. Please use a plain-text (.txt) or Markdown (.md) file, or paste the text.",
      );
    }
  }

  async function saveContract(): Promise<boolean> {
    if (new TextEncoder().encode(contract).byteLength > MAX_CONTRACT_BYTES) {
      toast.error("Contract text is too large for Firestore. Please keep it under 700 KB.");
      return false;
    }
    try {
      await updateDoc(userDocument("reviewThreads", threadId), {
        contractText: contract,
        updatedAt: new Date().toISOString(),
      });
      setSavedContract(contract);
      setShowDoc(false);
      toast.success("Contract attached to this review");
      inputRef.current?.focus();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the contract.");
      return false;
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    if (contract !== savedContract && !(await saveContract())) return;
    setInput("");
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", content: message }]);
    setPending(true);
    try {
      const r = await sendReviewMessage({ data: { threadId, message } });
      setMsgs((current) =>
        current.some((item) => item.id === r.messageId)
          ? current.map((item) =>
              item.id === r.messageId ? { ...item, content: r.reply, status: "complete" } : item,
            )
          : [
              ...current,
              { id: r.messageId, role: "assistant", content: r.reply, status: "complete" },
            ],
      );
      qc.invalidateQueries({ queryKey: ["threads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setInput(message);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  async function applyEdit() {
    const instruction = editInstruction.trim();
    if (!instruction || editing) return;
    if (contract !== savedContract && !(await saveContract())) return;
    setEditing(true);
    try {
      const r = await applyLeaseEdit({ data: { threadId, instruction } });
      setContract(r.revised);
      setSavedContract(r.revised);
      setEditInstruction("");
      setMsgs((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", content: `✏️ Edit requested: ${instruction}` },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "I've applied that change and updated the attached contract. Open the contract panel to review the revised text.",
        },
      ]);
      toast.success("Contract updated with your change");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setEditing(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-paper px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            {savedContract ? (
              <>
                📄 Contract attached ·{" "}
                <span className="text-muted-foreground">
                  {savedContract.length.toLocaleString()} characters
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No contract attached yet</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              Upload file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.text,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => setShowDoc((s) => !s)}>
              {showDoc ? "Hide" : savedContract ? "View / edit contract" : "Paste contract"}
            </Button>
          </div>
        </div>
        {showDoc && (
          <div className="mt-3 space-y-2">
            <Textarea
              rows={10}
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="Paste the full text of the commercial lease or NDA here…"
              className="bg-background font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={saveContract} disabled={contract === savedContract}>
                Attach contract
              </Button>
            </div>
          </div>
        )}
        {savedContract && (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyEdit();
              }}
              placeholder='Describe a change, e.g. "reduce the notice period to 2 months"…'
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              disabled={editing}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={applyEdit}
              disabled={editing || !editInstruction.trim()}
            >
              {editing ? "Applying…" : "Edit with AI"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {msgs.length === 0 && (
            <div className="pt-8 text-center">
              <p className="font-serif text-2xl">Ask your reviewer anything.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    onClick={() => send(s)}
                    className="h-auto whitespace-normal bg-paper text-sm"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-md bg-ink px-4 py-2.5 text-sm text-ink-foreground">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-3">
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-seal font-serif text-xs font-semibold text-seal">
                  §
                </span>
                <div className="chat-md min-w-0 flex-1 text-sm">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                  {m.status === "streaming" && (
                    <span className="animate-pulse text-xs text-muted-foreground">Writing…</span>
                  )}
                </div>
              </div>
            ),
          )}
          {pending && !msgs.some((message) => message.status === "streaming") && (
            <div className="flex gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-seal font-serif text-xs text-seal">
                §
              </span>
              <span className="animate-pulse pt-1 text-sm text-muted-foreground">
                Reviewing the agreement…
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t bg-paper px-6 py-4"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about clauses, risks, obligations…"
            className="resize-none bg-background"
          />
          <Button type="submit" disabled={pending || !input.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
