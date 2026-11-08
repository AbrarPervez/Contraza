import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { contractPlaceholderLabel, fillContractPlaceholders, findContractPlaceholders, matchingContractPlaceholders, placeholderMarkdown } from "@/lib/contract-placeholders";

type Props = {
  content: string;
  saving: boolean;
  onSave: (content: string) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
};

export function DraftContentEditor({ content, saving, onSave, onEditingChange }: Props) {
  const [mode, setMode] = useState<"text" | null>(null);
  const [text, setText] = useState(content);
  const [active, setActive] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [autofill, setAutofill] = useState(true);
  const article = useRef<HTMLElement>(null);
  const fields = findContractPlaceholders(content);
  const target = fields.find((field) => field.start === active);
  const matches = target ? matchingContractPlaceholders(content, target) : [];

  function start() {
    setText(content);
    setMode("text");
    onEditingChange(true);
  }

  function close() {
    setMode(null);
    setActive(null);
    onEditingChange(false);
  }

  async function save() {
    if (await onSave(text)) close();
  }

  function openBlank(start: number) {
    setValue("");
    setAutofill(true);
    setActive(start);
    onEditingChange(true);
    article.current?.querySelector(`[data-blank="${start}"]`)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  async function saveBlank() {
    if (!target || !value.trim()) return;
    const selected = autofill ? matches : [target];
    const revised = fillContractPlaceholders(content, Object.fromEntries(selected.map((field) => [field.start, value])));
    if (await onSave(revised)) close();
  }

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 border-y py-3">
        <Button variant="secondary" size="sm" disabled={!fields.length || saving || !!mode} onClick={() => { const first = fields[0]; if (first) openBlank(first.start); }}><Pencil />Edit blanks{fields.length ? ` (${fields.length})` : ""}</Button>
        <Button variant="outline" size="sm" disabled={saving || active !== null || !!mode} onClick={start}><Pencil />Edit contract</Button>
      </div>
      {mode && <section className="no-print mb-6 min-w-0 border-y py-4" aria-label="Contract editor">
          <h2 className="mb-4 text-lg font-semibold">Edit contract</h2>
          <Label htmlFor="contract-text">Contract text</Label>
          <Textarea id="contract-text" value={text} onChange={(event) => setText(event.target.value)} disabled={saving} className="mt-2 min-h-[32rem] bg-paper font-mono text-sm" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving || !text.trim() || text === content}><Save />{saving ? "Saving…" : "Save contract"}</Button>
            <Button size="sm" variant="outline" onClick={close} disabled={saving}><X />Cancel</Button>
          </div>
      </section>}
      <article ref={article} className="paper-sheet legal-doc min-h-[80vh] break-words rounded-sm border px-6 py-12 md:px-16">
        <div className="hidden print:block"><ReactMarkdown>{content}</ReactMarkdown></div>
        <div className="print:hidden">
          <ReactMarkdown components={{ a: ({ href, children }) => {
            if (!href?.startsWith("#contract-blank-")) return <a href={href}>{children}</a>;
            const start = Number(href.slice("#contract-blank-".length));
            const field = fields.find((item) => item.start === start);
            if (!field) return <>{children}</>;
            const fieldLabel = contractPlaceholderLabel(content, field);
            return <Popover open={active === start} onOpenChange={(open) => { if (saving) return; if (open) openBlank(start); else if (active === start) close(); }}>
              <PopoverTrigger asChild><Button data-blank={start} variant="ghost" size="sm" disabled={saving || !!mode} aria-label={`Edit blank: ${fieldLabel}`} className="inline-flex h-auto min-h-6 whitespace-normal border-b border-dashed border-seal bg-accent px-1 py-0 font-serif text-seal">[{children}]</Button></PopoverTrigger>
              <PopoverContent className="no-print w-80 max-w-[calc(100vw-2rem)]" align="start" onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => document.getElementById(`blank-value-${start}`)?.focus({ preventScroll: true })); }}>
                <form onSubmit={(event) => { event.preventDefault(); void saveBlank(); }}>
                  <h3 className="font-serif text-lg font-semibold">Fill missing detail</h3>
                  <Label htmlFor={`blank-value-${start}`} className="mt-3 block">{fieldLabel}</Label>
                  <Input id={`blank-value-${start}`} className="mt-1" value={value} onChange={(event) => setValue(event.target.value)} disabled={saving} />
                  {matches.length > 1 && <label className="mt-3 flex items-start gap-2 text-xs"><Checkbox checked={autofill} disabled={saving} onCheckedChange={(checked) => setAutofill(checked === true)} />Autofill {matches.length - 1} matching blank{matches.length > 2 ? "s" : ""}</label>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={saving || !value.trim()}><Save />{saving ? "Saving…" : "Update contract"}</Button>
                    <Button type="button" variant="outline" size="sm" disabled={saving} onClick={close}><X />Cancel</Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>;
          } }}>{placeholderMarkdown(content)}</ReactMarkdown>
        </div>
      </article>
    </>
  );
}