import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { addDoc, getDocs, orderBy, query } from "firebase/firestore";
import { toast } from "sonner";
import { userCollection } from "@/integrations/firebase/data";
import { Button } from "@/components/ui/button";
import { emptyLease } from "@/lib/lease";
import { emptyNda, type ContractType } from "@/lib/contracts";
import { Plus, ShieldCheck } from "lucide-react";
import { DeleteContractButton } from "@/components/DeleteContractButton";

export const Route = createFileRoute("/_authenticated/draft/")({
  head: () => ({
    meta: [
      { title: "Drafting — Contraza" },
      { name: "description", content: "Create commercial lease and NDA drafts from structured fields." },
      { property: "og:title", content: "Drafting — Contraza" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:description", content: "Create commercial lease and NDA drafts from structured fields." },
    ],
  }),
  component: DraftList,
});

function DraftList() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["drafts"],
    queryFn: async () => {
      const snapshot = await getDocs(query(userCollection("leaseDrafts"), orderBy("updatedAt", "desc")));
      return snapshot.docs.map((draft) => ({ id: draft.id, ...draft.data() }));
    },
  });

  async function create(type: ContractType) {
    try {
      const now = new Date().toISOString();
      const draft = await addDoc(userCollection("leaseDrafts"), {
        title: type === "nda" ? "Untitled NDA" : "Untitled lease",
        params: type === "nda" ? emptyNda : emptyLease,
        content: "",
        createdAt: now,
        updatedAt: now,
      });
      await navigate({ to: "/draft/$id", params: { id: draft.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the draft.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">Contract drafts</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => create("lease")}><Plus />New lease draft</Button>
          <Button onClick={() => create("nda")}><ShieldCheck />New NDA draft</Button>
        </div>
      </div>
      <div className="mt-8 grid gap-3">
        {(data ?? []).map((d) => (
          <div key={d.id} className="paper-sheet flex flex-wrap items-center justify-between gap-3 rounded-md border px-5 py-4">
            <Link to="/draft/$id" params={{ id: d.id }} className="min-w-0 break-words font-serif text-lg hover:text-seal">
              {d.title}
            </Link>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{d.content ? "Generated" : "In progress"}</span>
              <span>{new Date(d.updatedAt).toLocaleString()}</span>
              <DeleteContractButton id={d.id} title={d.title} kind="draft" />
            </div>
          </div>
        ))}
        {data?.length === 0 && <p className="text-muted-foreground">No drafts yet — start a new one.</p>}
      </div>
    </main>
  );
}
