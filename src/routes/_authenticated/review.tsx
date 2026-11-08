import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { addDoc, getDocs, orderBy, query } from "firebase/firestore";
import { MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { userCollection } from "@/integrations/firebase/data";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DeleteContractButton } from "@/components/DeleteContractButton";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Review — Contraza" },
      { name: "description", content: "Ask questions about commercial lease agreements and NDAs." },
      { property: "og:title", content: "Review — Contraza" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:description", content: "Ask questions about commercial lease agreements and NDAs." },
    ],
  }),
  component: ReviewLayout,
});

const threadsQuery = {
  queryKey: ["threads"],
  queryFn: async () => {
    const snapshot = await getDocs(query(userCollection("reviewThreads"), orderBy("updatedAt", "desc")));
    return snapshot.docs.map((thread) => ({ id: thread.id, ...thread.data() }));
  },
};

function ReviewLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data, refetch } = useQuery(threadsQuery);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  async function create() {
    try {
      const now = new Date().toISOString();
      const thread = await addDoc(userCollection("reviewThreads"), {
        title: "New review",
        contractText: "",
        createdAt: now,
        updatedAt: now,
      });
      await refetch();
      setMobileSidebarOpen(false);
      await navigate({ to: "/review/$threadId", params: { threadId: thread.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a review.");
    }
  }

  return (
    <div className="grid h-[calc(100dvh-4rem)] w-full grid-cols-1 overflow-hidden md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r bg-paper/80 md:flex">
        <ConversationSidebar
          conversations={data ?? []}
          pathname={pathname}
          onCreate={create}
          onNavigate={() => setMobileSidebarOpen(false)}
          onDeleted={(id) => {
            if (pathname === `/review/${id}`) void navigate({ to: "/review" });
          }}
        />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b bg-paper px-3 md:hidden">
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Conversations
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(85vw,320px)] max-w-none flex-col p-0">
              <SheetTitle className="sr-only">Review conversations</SheetTitle>
              <SheetDescription className="sr-only">
                Open an existing review or start a new one.
              </SheetDescription>
              <ConversationSidebar
                conversations={data ?? []}
                pathname={pathname}
                onCreate={create}
                onNavigate={() => setMobileSidebarOpen(false)}
                onDeleted={(id) => {
                  if (pathname === `/review/${id}`) void navigate({ to: "/review" });
                }}
              />
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="sm" className="ml-auto gap-2" onClick={create}>
            <Plus className="h-4 w-4" />
            New review
          </Button>
        </div>
        <Outlet />
      </section>
    </div>
  );
}

type Conversation = { id: string; title: string; updatedAt: string };

function ConversationSidebar({
  conversations,
  pathname,
  onCreate,
  onNavigate,
  onDeleted,
}: {
  conversations: Conversation[];
  pathname: string;
  onCreate: () => void;
  onNavigate: () => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-4">
        <Button className="w-full justify-start gap-2" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          New review
        </Button>
      </div>
      <div className="px-4 pb-2 pt-4">
        <p className="eyebrow">Your conversations</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {conversations.map((conversation) => {
          const active = pathname === `/review/${conversation.id}`;
          return (
            <li
              key={conversation.id}
              className={`group flex min-w-0 items-center rounded-md transition-colors ${
                active ? "bg-muted" : "hover:bg-muted/70"
              }`}
            >
              <Link
                to="/review/$threadId"
                params={{ threadId: conversation.id }}
                onClick={onNavigate}
                className={`min-w-0 flex-1 truncate px-3 py-2.5 text-sm ${
                  active ? "font-medium text-foreground" : "text-muted-foreground"
                }`}
                title={conversation.title}
              >
                {conversation.title}
              </Link>
              <DeleteContractButton
                id={conversation.id}
                title={conversation.title}
                kind="review"
                iconOnly
                onDeleted={() => onDeleted(conversation.id)}
              />
            </li>
          );
        })}
        {conversations.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            Your reviews will appear here.
          </li>
        )}
      </ul>
    </div>
  );
}
