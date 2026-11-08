import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/review/")({
  head: () => ({ meta: [
    { title: "Start a contract review — Contraza" },
    { name: "description", content: "Start a commercial lease or NDA review conversation in Contraza." },
    { property: "og:title", content: "Start a contract review — Contraza" },
    { property: "og:description", content: "Start a commercial lease or NDA review conversation in Contraza." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-md">
        <h1 className="text-3xl font-semibold">Review a lease or NDA</h1>
        <p className="mt-3 text-muted-foreground">
          Commercial lease agreements · Non-disclosure agreements
        </p>
      </div>
    </div>
  ),
});
