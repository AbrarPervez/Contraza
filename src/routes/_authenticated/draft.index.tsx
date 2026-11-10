import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileText, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/draft/")({
  head: () => ({
    meta: [
      { title: "Choose a drafting method — Contraza" },
      {
        name: "description",
        content: "Choose structured fields or a conversational workflow to draft a contract.",
      },
      { property: "og:title", content: "Choose a drafting method — Contraza" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content: "Choose structured fields or a conversational workflow to draft a contract.",
      },
    ],
  }),
  component: DraftingMode,
});

function DraftingMode() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="eyebrow">Contract drafting</p>
      <h1 className="mt-2 text-4xl font-semibold">Choose Your Drafting Method</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Use guided fields for a lease or NDA, or describe what you need in a conversation.
      </p>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <section className="paper-sheet group rounded-lg border p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-seal hover:shadow-md">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-seal">
            <FileText className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold">Structured requirements</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create a contract by filling in predefined fields and providing specific contract
            details.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link to="/draft/structured">
              Start Structured Drafting
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </section>

        <section className="paper-sheet group rounded-lg border p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-seal hover:shadow-md">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-seal">
            <MessageSquareText className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold">Unstructured requirements</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create contracts through natural conversations with an AI assistant. Explain what you
            need, and the AI will guide you through the process.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link to="/draft/chat">
              Start AI Drafting
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </section>
      </div>
    </main>
  );
}
