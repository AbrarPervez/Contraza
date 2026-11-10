import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, MessageSquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createUnstructuredDraftChat,
  deleteUnstructuredDraftChat,
  listUnstructuredDraftChats,
} from "@/lib/lease.functions";

export const Route = createFileRoute("/_authenticated/draft/chat")({
  head: () => ({
    meta: [
      { title: "Unstructured drafting — Contraza" },
      {
        name: "description",
        content: "Discuss requirements and draft contracts conversationally.",
      },
    ],
  }),
  component: DraftChatLayout,
});

function DraftChatLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      {pathname === "/draft/chat" && <DraftChatList />}
      <Outlet />
    </>
  );
}

function DraftChatList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const { data } = useQuery({
    queryKey: ["draftChats"],
    queryFn: async () => {
      return listUnstructuredDraftChats({ data: {} });
    },
  });

  async function createChat() {
    try {
      const chat = await createUnstructuredDraftChat({ data: {} });
      await navigate({ to: "/draft/chat/$chatId", params: { chatId: chat.id } });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a drafting conversation.",
      );
    }
  }

  async function deleteChat() {
    if (!pendingDelete || deletingId) return;
    setDeletingId(pendingDelete.id);
    try {
      await deleteUnstructuredDraftChat({ data: { chatId: pendingDelete.id } });
      await queryClient.invalidateQueries({ queryKey: ["draftChats"] });
      setPendingDelete(null);
      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the conversation.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        to="/draft"
        className="inline-flex items-center gap-2 text-sm text-seal hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Drafting methods
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Unstructured requirements</p>
          <h1 className="mt-2 text-4xl font-semibold">Draft by conversation</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Describe the agreement you need, ask questions, and refine your requirements before
            asking for a draft.
          </p>
        </div>
        <Button onClick={createChat}>
          <MessageSquarePlus />
          New conversation
        </Button>
      </div>

      <div className="mt-8 grid gap-3">
        {(data ?? []).map((chat) => (
          <div
            key={chat.id}
            className="paper-sheet flex flex-wrap items-center justify-between gap-3 rounded-md border px-5 py-3 hover:border-seal"
          >
            <Link
              to="/draft/chat/$chatId"
              params={{ chatId: chat.id }}
              className="min-w-0 flex-1 break-words py-1 font-serif text-lg hover:text-seal"
            >
              <span className="block">{chat.title}</span>
              <span className="mt-1 block font-sans text-xs text-muted-foreground">
                {new Date(chat.updatedAt).toLocaleString()}
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete conversation: ${chat.title}`}
              title="Delete conversation"
              disabled={deletingId === chat.id}
              onClick={() => setPendingDelete({ id: chat.id, title: chat.title })}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {data?.length === 0 && (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Your drafting conversations will appear here.
          </p>
        )}
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            “{pendingDelete?.title}” and its messages will be permanently deleted. This cannot be
            undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void deleteChat()}
              disabled={deletingId !== null}
            >
              <Trash2 />
              {deletingId ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
