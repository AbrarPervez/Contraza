import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function RenameConversationButton({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);

  async function save() {
    const nextTitle = value.trim();
    if (!nextTitle || saving) return;
    setSaving(true);
    try {
      await onRename(nextTitle);
      setOpen(false);
      toast.success("Conversation renamed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename this conversation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (saving) return;
        if (nextOpen) setValue(title);
        setOpen(nextOpen);
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Rename conversation: ${title}`}
        title="Rename conversation"
        className="shrink-0 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Pencil />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Choose a name that helps you find this chat later.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          maxLength={100}
          value={value}
          aria-label="Conversation name"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          disabled={saving}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !value.trim()}>
            {saving ? "Saving…" : "Save name"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
