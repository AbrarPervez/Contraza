import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createUnstructuredDraftChat,
  getUnstructuredDraftChat,
  saveUnstructuredDraftContract,
  sendUnstructuredDraftMessage,
} from "@/lib/lease.functions";

export const Route = createFileRoute("/_authenticated/draft/chat/$chatId")({
  head: () => ({
    meta: [
      { title: "Contraza AI Assistant — Contract Drafting" },
      {
        name: "description",
        content:
          "Discuss requirements and draft contracts conversationally with Contraza AI Assistant.",
      },
    ],
  }),
  component: DraftChat,
});

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  contractText?: string;
  status?: "streaming" | "complete";
};

const WELCOME_MESSAGE = `Hello! I'm Contraza AI Assistant. I can help you understand contracts, explain legal clauses, discuss contract requirements, and draft complete contracts through conversation.

Tell me what kind of agreement you need, or simply describe your requirements.`;

const STARTERS = [
  "I need a contract for a business arrangement. What details do you need?",
  "Help me understand what to include in a services agreement.",
  "I need a rental agreement. What details should we discuss?",
];

function markdownRuns(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return new TextRun({ text: part.slice(2, -2), bold: true });
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return new TextRun({ text: part.slice(1, -1), italics: true });
      }
      return new TextRun(part);
    });
}

function contractParagraphs(markdown: string) {
  return markdown.split(/\r?\n/).map((line) => {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length;
      const title = heading[2] ?? "";
      return new Paragraph({
        heading:
          level === 1
            ? HeadingLevel.HEADING_1
            : level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        children: markdownRuns(title),
      });
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      return new Paragraph({ bullet: { level: 0 }, children: markdownRuns(bullet[1] ?? "") });
    }
    const ordered = /^\s*(\d+[.)]\s+)(.+)$/.exec(line);
    if (ordered) {
      return new Paragraph({
        children: markdownRuns(`${ordered[1] ?? ""}${ordered[2] ?? ""}`),
        indent: { left: 360 },
      });
    }
    if (!line.trim()) return new Paragraph("");
    return new Paragraph({ children: markdownRuns(line) });
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function DraftChat() {
  const { chatId } = Route.useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatExists, setChatExists] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const chat = await getUnstructuredDraftChat({ data: { chatId } });
        if (cancelled) return;
        setChatExists(true);
        setMessages(chat.messages);
        inputRef.current?.focus();
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Could not load this conversation.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || pending || !chatExists) return;
    setInput("");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: message },
    ]);
    setPending(true);
    try {
      const result = await sendUnstructuredDraftMessage({ data: { chatId, message } });
      setMessages((current) => [
        ...current,
        {
          id: result.messageId,
          role: "assistant",
          content: result.reply,
          ...(result.contractText ? { contractText: result.contractText } : {}),
        },
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your message.");
      setInput(message);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  async function createChat() {
    try {
      const chat = await createUnstructuredDraftChat({ data: {} });
      await navigate({ to: "/draft/chat/$chatId", params: { chatId: chat.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start a new chat.");
    }
  }

  async function copyContract(contractText: string) {
    try {
      await navigator.clipboard.writeText(contractText);
      toast.success("Contract copied to clipboard.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy the contract.");
    }
  }

  async function downloadDocx(contractText: string) {
    try {
      const doc = new Document({
        sections: [
          {
            properties: { page: { margin: { top: 900, right: 960, bottom: 900, left: 960 } } },
            children: contractParagraphs(contractText),
          },
        ],
      });
      downloadBlob(await Packer.toBlob(doc), "contraza-contract.docx");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the DOCX file.");
    }
  }

  function downloadPdf(messageId: string) {
    document.body.classList.add("print-contract-mode");
    window.addEventListener(
      "afterprint",
      () => document.body.classList.remove("print-contract-mode"),
      { once: true },
    );
    requestAnimationFrame(() => {
      document.querySelectorAll("[data-print-target]").forEach((element) => {
        element.removeAttribute("data-print-target");
      });
      document.getElementById(`contract-${messageId}`)?.setAttribute("data-print-target", "true");
      window.print();
    });
  }

  function startEditing(message: Message) {
    setEditingContractId(message.id);
    setEditValue(message.contractText ?? "");
  }

  async function saveEditedContract(messageId: string) {
    try {
      const result = await saveUnstructuredDraftContract({
        data: { chatId, messageId, contractText: editValue },
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, contractText: result.contractText } : message,
        ),
      );
      setEditingContractId(null);
      setEditValue("");
      toast.success("Contract changes saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save contract changes.");
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-6xl flex-col px-3 sm:px-6">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/draft/chat"
            className="text-sm text-seal hover:underline"
            aria-label="Chat history"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-seal font-serif font-semibold text-seal">
            C
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">Contraza AI Assistant</h1>
            <p className="text-xs text-muted-foreground">Contract drafting and discussions</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void createChat()}>
            <FilePlus2 />
            New Chat
          </Button>
          <Link to="/draft/chat" className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm">
              Chat history
            </Button>
          </Link>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto py-5" aria-label="Drafting conversation">
        <div className="mx-auto max-w-3xl space-y-6">
          {loading && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
          {!loading && messages.length === 0 && (
            <>
              <article className="flex gap-3">
                <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-seal font-serif text-xs font-semibold text-seal">
                  C
                </span>
                <div className="chat-md min-w-0 max-w-[90%] rounded-xl border bg-paper px-4 py-3 text-sm shadow-sm">
                  <ReactMarkdown>{WELCOME_MESSAGE}</ReactMarkdown>
                </div>
              </article>
              <div className="flex flex-wrap gap-2 pl-11">
                {STARTERS.map((starter) => (
                  <Button
                    key={starter}
                    variant="outline"
                    className="h-auto whitespace-normal bg-paper text-left text-sm"
                    disabled={pending || !chatExists}
                    onClick={() => void sendMessage(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={message.role === "user" ? "flex justify-end" : "flex gap-3"}
            >
              {message.role === "assistant" && (
                <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-seal font-serif text-xs font-semibold text-seal">
                  C
                </span>
              )}
              <div
                className={
                  message.role === "user"
                    ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm text-ink-foreground shadow-sm"
                    : "min-w-0 max-w-[92%] flex-1"
                }
              >
                {message.role === "assistant" ? (
                  <>
                    {message.content && (
                      <div className="chat-md rounded-xl border bg-paper px-4 py-3 text-sm shadow-sm">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    )}
                    {message.contractText && (
                      <section
                        id={`contract-${message.id}`}
                        className="contract-print-target paper-sheet mt-4 rounded-lg border p-4 sm:p-7"
                        aria-label="Generated contract"
                      >
                        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                          <div className="flex items-center gap-2 font-medium">
                            <FileText className="h-4 w-4 text-seal" />
                            Generated contract
                          </div>
                          {editingContractId === message.id ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!editValue.trim()}
                                onClick={() => void saveEditedContract(message.id)}
                              >
                                <Check />
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingContractId(null);
                                  setEditValue("");
                                }}
                              >
                                <X />
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Print or save as PDF"
                                title="Print or save as PDF"
                                onClick={() => downloadPdf(message.id)}
                              >
                                <Printer />
                                PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Download DOCX"
                                title="Download DOCX"
                                onClick={() => void downloadDocx(message.contractText ?? "")}
                              >
                                <Download />
                                DOCX
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void copyContract(message.contractText ?? "")}
                              >
                                <Copy />
                                Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditing(message)}
                              >
                                <Pencil />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() =>
                                  void sendMessage(
                                    "Regenerate the contract based on our confirmed requirements. Use the existing contract as the baseline and preserve all requirements.",
                                  )
                                }
                              >
                                <RotateCcw />
                                Regenerate
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setInput("I'd like to discuss this contract: ");
                                  inputRef.current?.focus();
                                }}
                              >
                                Discuss
                              </Button>
                            </div>
                          )}
                        </div>
                        {editingContractId === message.id ? (
                          <Textarea
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            className="no-print min-h-[50vh] bg-background font-mono text-sm"
                            aria-label="Edit generated contract"
                          />
                        ) : (
                          <div className="legal-doc break-words">
                            <ReactMarkdown>{message.contractText}</ReactMarkdown>
                          </div>
                        )}
                      </section>
                    )}
                  </>
                ) : (
                  message.content
                )}
              </div>
            </article>
          ))}
          {pending && (
            <div className="flex gap-3" role="status" aria-live="polite">
              <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-seal font-serif text-xs text-seal">
                C
              </span>
              <span className="animate-pulse rounded-xl border bg-paper px-4 py-3 text-sm text-muted-foreground">
                Contraza AI Assistant is thinking…
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(input);
        }}
        className="shrink-0 border-t bg-paper py-3"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background p-2 shadow-sm">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Message Contraza AI Assistant…"
            className="max-h-40 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
            disabled={pending || !chatExists}
            aria-label="Message Contraza AI Assistant"
          />
          <Button
            type="submit"
            disabled={pending || !input.trim() || !chatExists}
            aria-label="Send message"
          >
            <Send />
            Send
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl px-1 text-center text-xs text-muted-foreground">
          AI-generated contracts may need review by a qualified lawyer, especially for
          jurisdiction-specific terms.
        </p>
      </form>
    </main>
  );
}
