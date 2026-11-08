import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDocs, orderBy, query } from "firebase/firestore";
import { userCollection } from "@/integrations/firebase/data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Contraza" },
      { name: "description", content: "Your commercial lease and NDA drafts and reviews." },
      { property: "og:title", content: "Dashboard — Contraza" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:description", content: "Your commercial lease and NDA drafts and reviews." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const drafts = useQuery({
    queryKey: ["drafts"],
    queryFn: async () => {
      const snapshot = await getDocs(query(userCollection("leaseDrafts"), orderBy("updatedAt", "desc")));
      return snapshot.docs.map((draft) => ({ id: draft.id, ...draft.data() }));
    },
  });
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const snapshot = await getDocs(query(userCollection("reviewThreads"), orderBy("updatedAt", "desc")));
      return snapshot.docs.map((thread) => ({ id: thread.id, ...thread.data() }));
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="eyebrow">Workspace</p>
      <h1 className="mt-2 text-4xl font-semibold">What are we working on?</h1>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Panel title="Drafting" to="/draft" cta="Open drafting" items={drafts.data ?? []} kind="draft" />
        <Panel title="Review" to="/review" cta="Open review" items={threads.data ?? []} kind="review" />
      </div>
    </main>
  );
}

function Panel({
  title, to, cta, items, kind,
}: { title: string; to: "/draft" | "/review"; cta: string; items: { id: string; title: string; updatedAt: string }[]; kind: "draft" | "review" }) {
  return (
    <section className="paper-sheet rounded-md border p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Link to={to} className="text-sm text-seal hover:underline">{cta} →</Link>
      </div>
      <ul className="mt-4 divide-y">
        {items.slice(0, 5).map((i) => (
          <li key={i.id} className="py-2">
            {kind === "draft" ? (
              <Link to="/draft/$id" params={{ id: i.id }} className="hover:text-seal">{i.title}</Link>
            ) : (
              <Link to="/review/$threadId" params={{ threadId: i.id }} className="hover:text-seal">{i.title}</Link>
            )}
            <span className="ml-2 text-xs text-muted-foreground">{new Date(i.updatedAt).toLocaleDateString()}</span>
          </li>
        ))}
        {items.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nothing yet.</li>}
      </ul>
    </section>
  );
}
