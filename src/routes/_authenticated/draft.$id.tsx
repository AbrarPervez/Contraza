import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { userDocument } from "@/integrations/firebase/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CLAUSE_OPTIONS, REQUIRED_FIELDS, type LeaseParams } from "@/lib/lease";
import {
  contractTitle,
  isNda,
  missingContractFields,
  restoreContractParams,
  type ContractParams,
} from "@/lib/contracts";
import { NdaFields } from "@/components/NdaFields";
import { generateLease } from "@/lib/lease.functions";
import { DraftContentEditor } from "@/components/DraftContentEditor";
import { DeleteContractButton } from "@/components/DeleteContractButton";
import { LanguageSelector, VoiceInputButton, useLanguagePreference } from "@/components/LanguageVoiceControls";

export const Route = createFileRoute("/_authenticated/draft/$id")({
  head: () => ({
    meta: [
      { title: "Edit contract draft — Contraza" },
      {
        name: "description",
        content: "Fill in commercial lease or NDA details and generate the agreement.",
      },
      { property: "og:title", content: "Edit contract draft — Contraza" },
      {
        property: "og:description",
        content: "Fill in commercial lease or NDA details and generate the agreement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DraftEditor,
});

const ENTITY_TYPES = [
  "Private Limited Company",
  "LLP",
  "Partnership Firm",
  "Sole Proprietorship",
  "Public Limited Company",
  "Individual",
];

function DraftEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [p, setP] = useState<ContractParams | null>(null);
  const { language, setLanguage } = useLanguagePreference();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const loaded = useRef(false);
  const generationActive = useRef(false);
  const originalContent = useRef("");
  const contentEditing = useRef(false);
  contentEditing.current = editingContent || savingContent;

  useEffect(() => {
    loaded.current = false;
    let cancelled = false;
    void getDoc(userDocument("leaseDrafts", id))
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          toast.error("Draft not found.");
          return;
        }
        const data = snapshot.data();
        setP(restoreContractParams(data["params"]));
        setTitle(data["title"]);
        setContent(data["content"]);
        setTimeout(() => (loaded.current = true), 0);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Could not load the draft."),
      );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(
    () =>
      onSnapshot(
        userDocument("leaseDrafts", id),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const nextContent = snapshot.data()["content"];
          if (typeof nextContent !== "string") return;
          if (generationActive.current) {
            setStreamingContent(nextContent === originalContent.current ? null : nextContent);
          } else if (loaded.current && !contentEditing.current) {
            setContent(nextContent);
          }
        },
        (error) => toast.error(error.message || "Could not receive live draft updates."),
      ),
    [id],
  );

  // autosave
  useEffect(() => {
    if (!p || !loaded.current) return;
    const t = setTimeout(async () => {
      setSaving(true);
      const autoTitle = contractTitle(p);
      try {
        await updateDoc(userDocument("leaseDrafts", id), {
          params: p,
          title: autoTitle || "Untitled lease",
          updatedAt: new Date().toISOString(),
        });
        setTitle(autoTitle || "Untitled lease");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the draft.");
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, id]);

  if (!p) return <div className="p-12 text-muted-foreground">Loading…</div>;

  const set = <K extends keyof LeaseParams>(k: K, v: LeaseParams[K]) => {
    if (!isNda(p)) setP({ ...p, [k]: v });
  };
  const missing = missingContractFields(p);

  async function generate() {
    if (missing.length) {
      toast.error("Please complete the required fields marked *");
      return;
    }
    if (
      content &&
      !window.confirm(
        "Re-generating will replace the current contract, including any details or edits you saved. Continue?",
      )
    )
      return;
    originalContent.current = content;
    generationActive.current = true;
    setStreamingContent(null);
    setGenerating(true);
    const diagnosticId = crypto.randomUUID();
    let stage = "firebase_prewrite";
    const startedAt = Date.now();
    try {
      // flush save first
      await updateDoc(userDocument("leaseDrafts", id), {
        params: p,
        updatedAt: new Date().toISOString(),
      });
      stage = "tanstack_server_function";
      const r = await generateLease({ data: { draftId: id, diagnosticId, language } });
      setContent(r.content);
      setStreamingContent(null);
      toast.success(p && isNda(p) ? "NDA drafted" : "Lease agreement drafted");
    } catch (e) {
      setStreamingContent(null);
      console.warn("[Contraza Draft Client]", {
        requestId: diagnosticId,
        stage,
        totalMs: Date.now() - startedAt,
        failureCategory:
          e instanceof TypeError
            ? "browser_fetch_error"
            : stage === "firebase_prewrite"
              ? "firebase_error"
              : "server_function_error",
      });
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      generationActive.current = false;
      setGenerating(false);
    }
  }

  async function saveContent(revised: string): Promise<boolean> {
    if (!revised.trim()) return false;
    setSavingContent(true);
    try {
      await updateDoc(userDocument("leaseDrafts", id), {
        content: revised,
        updatedAt: new Date().toISOString(),
      });
      setContent(revised);
      toast.success("Contract changes saved");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contract could not be saved");
      return false;
    } finally {
      setSavingContent(false);
    }
  }

  function download() {
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-")}.md`;
    a.click();
  }

  const F = ({
    k,
    label,
    type = "text",
    placeholder,
  }: {
    k: keyof LeaseParams;
    label: string;
    type?: string;
    placeholder?: string;
  }) => (
    <div>
      <Label htmlFor={k} className="text-xs">
        {label}
        {REQUIRED_FIELDS.includes(k) && <span className="text-seal"> *</span>}
      </Label>
      <Input
        id={k}
        type={type}
        placeholder={placeholder}
        value={!isNda(p) ? (p[k] as string) : ""}
        onChange={(e) => set(k, e.target.value as never)}
        className="mt-1 bg-paper"
      />
    </div>
  );
  const S = ({ k, label, options }: { k: keyof LeaseParams; label: string; options: string[] }) => (
    <div>
      <Label htmlFor={k} className="text-xs">
        {label}
      </Label>
      <select
        id={k}
        value={!isNda(p) ? (p[k] as string) : ""}
        onChange={(e) => set(k, e.target.value as never)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-paper px-3 text-sm"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,460px)_1fr]">
      <div className="no-print space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">
              {saving ? "Saving…" : "All changes saved"}
            </p>
          </div>
          <LanguageSelector value={language} onChange={setLanguage} />
        </div>

        <fieldset disabled={generating} className="min-w-0 space-y-6 border-0 p-0">
          {isNda(p) ? (
            <NdaFields params={p} onChange={setP} disabled={generating} />
          ) : (
            <>
              <Section n="1" title="Landlord (Lessor)">
                {F({ k: "landlordName", label: "Legal name" })}
                {S({ k: "landlordType", label: "Entity type", options: ENTITY_TYPES })}
                {F({ k: "landlordAddress", label: "Registered address" })}
                {F({ k: "landlordSignatory", label: "Authorised signatory & designation" })}
              </Section>
              <Section n="2" title="Tenant (Lessee)">
                {F({ k: "tenantName", label: "Legal name" })}
                {S({ k: "tenantType", label: "Entity type", options: ENTITY_TYPES })}
                {F({ k: "tenantAddress", label: "Registered address" })}
                {F({ k: "tenantSignatory", label: "Authorised signatory & designation" })}
              </Section>
              <Section n="3" title="Premises">
                {F({ k: "premisesAddress", label: "Premises address" })}
                <div className="grid grid-cols-2 gap-3">
                  {F({
                    k: "premisesArea",
                    label: "Area (sq ft)",
                    placeholder: "e.g. 2,500 sq ft carpet",
                  })}
                  {S({
                    k: "permittedUse",
                    label: "Permitted use",
                    options: [
                      "Office",
                      "Retail",
                      "Warehouse",
                      "Industrial / Manufacturing",
                      "Restaurant / F&B",
                      "Mixed use",
                    ],
                  })}
                </div>
              </Section>
              <Section n="4" title="Duration">
                <div className="grid grid-cols-3 gap-3">
                  {F({ k: "commencementDate", label: "Start date", type: "date" })}
                  {F({ k: "termMonths", label: "Term (months)", type: "number" })}
                  {F({ k: "lockInMonths", label: "Lock-in (months)", type: "number" })}
                </div>
                {F({ k: "renewalOption", label: "Renewal option" })}
              </Section>
              <Section n="5" title="Financial terms">
                <div className="grid grid-cols-3 gap-3">
                  {F({ k: "monthlyRent", label: "Monthly rent", type: "number" })}
                  {S({
                    k: "currency",
                    label: "Currency",
                    options: ["INR", "USD", "EUR", "GBP", "AED", "SGD"],
                  })}
                  {F({ k: "rentDueDay", label: "Due day of month", type: "number" })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {F({ k: "escalationPercent", label: "Escalation (%)", type: "number" })}
                  {F({ k: "escalationEveryMonths", label: "Every (months)", type: "number" })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {F({
                    k: "securityDeposit",
                    label: "Security deposit",
                    placeholder: "e.g. 6 months' rent",
                  })}
                  {F({
                    k: "camCharges",
                    label: "CAM / maintenance",
                    placeholder: "e.g. ₹15 per sq ft",
                  })}
                </div>
              </Section>
              <Section n="6" title="Termination & law">
                <div className="grid grid-cols-3 gap-3">
                  {F({ k: "noticePeriodMonths", label: "Notice (months)", type: "number" })}
                  {F({ k: "governingLaw", label: "Governing law" })}
                  {S({
                    k: "disputeResolution",
                    label: "Disputes",
                    options: ["Arbitration", "Courts", "Mediation then arbitration"],
                  })}
                </div>
              </Section>
              <Section n="7" title="Clauses to include">
                <div className="grid grid-cols-2 gap-2">
                  {CLAUSE_OPTIONS.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={p.clauses.includes(c)}
                        disabled={generating}
                        onCheckedChange={(v) =>
                          set("clauses", v ? [...p.clauses, c] : p.clauses.filter((x) => x !== c))
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Special terms / additional clauses</Label>
                    <VoiceInputButton
                      language={language}
                      disabled={generating}
                      onTranscript={(transcript) => setP((current) => current ? {
                        ...current,
                        specialTerms: current.specialTerms ? `${current.specialTerms} ${transcript}` : transcript,
                      } : current)}
                    />
                  </div>
                  <Textarea
                    rows={4}
                    value={p.specialTerms}
                    onChange={(e) => set("specialTerms", e.target.value)}
                    className="mt-1 bg-paper"
                    placeholder="e.g. 60-day rent-free fit-out period; exclusive parking for 4 cars"
                  />
                </div>
              </Section>
              <Section n="8" title="Signing">
                <div className="grid grid-cols-2 gap-3">
                  {F({ k: "signingPlace", label: "Place of signing", placeholder: "e.g. Mumbai" })}
                  {F({ k: "signingDate", label: "Date of signing", type: "date" })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {F({ k: "witness1Name", label: "Witness 1 name & address" })}
                  {F({ k: "witness2Name", label: "Witness 2 name & address" })}
                </div>
              </Section>
            </>
          )}
        </fieldset>
        <Button
          className="w-full"
          size="lg"
          onClick={generate}
          disabled={generating || editingContent || savingContent}
        >
          {generating
            ? "Drafting agreement…"
            : content
              ? "Re-generate agreement"
              : "Generate agreement"}
        </Button>
        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {missing.length} required field(s) remaining.
          </p>
        )}
      </div>

      <div className="min-w-0">
        <div className="no-print mb-3 flex flex-wrap justify-end gap-2">
          <DeleteContractButton
            id={id}
            title={title}
            kind="draft"
            disabled={generating || savingContent || editingContent}
            onDeleted={() => {
              void navigate({ to: "/draft" });
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!content || editingContent || generating}
            onClick={download}
          >
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!content || editingContent || generating}
            onClick={() => window.print()}
          >
            Print / PDF
          </Button>
        </div>
        {streamingContent !== null ? (
          <article className="paper-sheet legal-doc min-h-[80vh] rounded-sm border px-10 py-12 md:px-16">
            <p className="no-print mb-5 text-sm text-muted-foreground" role="status">
              Generating agreement…
            </p>
            <ReactMarkdown>{streamingContent}</ReactMarkdown>
          </article>
        ) : content ? (
          <DraftContentEditor
            key={id}
            content={content}
            saving={savingContent || generating}
            onSave={saveContent}
            onEditingChange={setEditingContent}
          />
        ) : (
          <article className="paper-sheet legal-doc min-h-[80vh] rounded-sm border px-10 py-12 md:px-16">
            <div className="grid h-[60vh] place-items-center text-center text-muted-foreground">
              <div>
                <p className="font-serif text-2xl">Your agreement will appear here.</p>
                <p className="mt-2 font-sans text-sm">Complete the fields and press Generate.</p>
              </div>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t pt-4">
      <legend className="flex items-baseline gap-2 pr-2">
        <span className="font-mono text-xs text-seal">§{n}</span>
        <span className="font-serif text-lg font-semibold">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}
