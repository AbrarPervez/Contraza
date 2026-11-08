import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getFirestoreDb } from "@/integrations/firebase/client";
import { reviewMessagesCollection, userDocument } from "@/integrations/firebase/data";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

export function DeleteContractButton({ id, title, kind, onDeleted, iconOnly = false, disabled = false }: {
  id: string; title: string; kind: "draft" | "review"; onDeleted?: () => void; iconOnly?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  async function remove() {
    setDeleting(true);
    try {
      if (kind === "draft") {
        await deleteDoc(userDocument("leaseDrafts", id));
      } else {
        const messages = await getDocs(reviewMessagesCollection(id));
        for (let offset = 0; offset < messages.docs.length; offset += 450) {
          const batch = writeBatch(getFirestoreDb());
          messages.docs.slice(offset, offset + 450).forEach((message) => batch.delete(message.ref));
          await batch.commit();
        }
        await deleteDoc(userDocument("reviewThreads", id));
      }
      setOpen(false);
      onDeleted?.();
      await queryClient.invalidateQueries({ queryKey: [kind === "draft" ? "drafts" : "threads"] });
      toast.success(kind === "draft" ? "Draft deleted" : "Review session deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deletion failed");
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <Button variant="ghost" size={iconOnly ? "icon" : "sm"} disabled={disabled || deleting} onClick={() => setOpen(true)} aria-label={`Delete ${kind}: ${title}`} title={`Delete ${kind}`} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 />{!iconOnly && "Delete"}</Button>
    <AlertDialog open={open} onOpenChange={(next) => { if (!deleting) setOpen(next); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <AlertDialogTitle>Delete {kind === "draft" ? "contract draft" : "review session"}?</AlertDialogTitle>
        <AlertDialogDescription className="break-words">“{title}” will be permanently deleted{kind === "review" ? ", including its attached contract and all messages" : ", including its generated contract"}. This cannot be undone.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={remove} disabled={deleting}><Trash2 />{deleting ? "Deleting…" : "Delete permanently"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}