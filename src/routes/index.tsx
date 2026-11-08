import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Contraza — Draft & Review Leases and NDAs" },
      {
        name: "description",
        content: "Structured drafting and AI-assisted review of commercial lease agreements and NDAs for private businesses.",
      },
      { property: "og:title", content: "Contraza — Draft & Review Leases and NDAs" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content: "Draft commercial leases and NDAs from structured fields, or review existing agreements with AI.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <Button asChild variant="outline" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20">
        <p className="eyebrow">Commercial leases · NDAs · Private industry</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight md:text-6xl">
          Draft a lease or NDA. <em className="text-seal">Review</em> an agreement.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Commercial leases and non-disclosure agreements for private businesses.
        </p>
        <div className="mt-10 flex gap-3">
          <Button asChild size="lg">
            <Link to="/dashboard">Open workspace</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-2">
        {[
          {
            n: "I.",
            t: "Drafting module",
            d: "Commercial leases and mutual or one-way NDAs, with parties, terms, clauses and signing details.",
          },
          {
            n: "II.",
            t: "Review module",
            d: "Lease and NDA review covering risks, missing protections, confidentiality obligations and suggested revisions.",
          },
        ].map((c) => (
          <div key={c.n} className="paper-sheet rounded-md border p-8">
            <span className="font-serif text-3xl text-seal">{c.n}</span>
            <h2 className="mt-3 text-2xl font-semibold">{c.t}</h2>
            <p className="mt-2 text-muted-foreground">{c.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
