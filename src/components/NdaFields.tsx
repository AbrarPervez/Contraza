import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NDA_REQUIRED_FIELDS, type NdaParams } from "@/lib/contracts";
import type { ReactNode } from "react";

const ENTITY_TYPES = ["Private Limited Company", "LLP", "Partnership Firm", "Sole Proprietorship", "Public Limited Company", "Individual"];

export function NdaFields({ params, onChange }: { params: NdaParams; onChange: (params: NdaParams) => void }) {
  const set = (key: keyof NdaParams, value: string) => onChange({ ...params, [key]: value });
  const field = (key: keyof NdaParams, label: string, type = "text", multiline = false) => (
    <div key={key}>
      <Label htmlFor={key} className="text-xs">{label}{NDA_REQUIRED_FIELDS.includes(key) && <span className="text-seal"> *</span>}</Label>
      {multiline ? <Textarea id={key} rows={3} value={params[key]} onChange={(event) => set(key, event.target.value)} className="mt-1 bg-paper" />
        : <Input id={key} type={type} value={params[key]} onChange={(event) => set(key, event.target.value)} className="mt-1 bg-paper" />}
    </div>
  );
  const select = (key: keyof NdaParams, label: string, options: string[]) => (
    <div><Label htmlFor={key} className="text-xs">{label}</Label><Select value={params[key]} onValueChange={(value) => set(key, value)}><SelectTrigger id={key} className="mt-1 w-full bg-paper"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
  );
  return <>
    <Group title="NDA type">{select("ndaType", "Disclosure arrangement", ["Mutual", "One-way"])}{field("effectiveDate", "Effective date", "date")}</Group>
    <Group title={params.ndaType === "One-way" ? "Disclosing party" : "First party"}>{field("party1Name", "First party legal name")}{select("party1Type", "First party entity type", ENTITY_TYPES)}{field("party1Address", "First party registered address")}{field("party1Signatory", "First party authorised signatory & designation")}</Group>
    <Group title={params.ndaType === "One-way" ? "Receiving party" : "Second party"}>{field("party2Name", "Second party legal name")}{select("party2Type", "Second party entity type", ENTITY_TYPES)}{field("party2Address", "Second party registered address")}{field("party2Signatory", "Second party authorised signatory & designation")}</Group>
    <Group title="Confidential information">{field("purpose", "Purpose of disclosure", "text", true)}{field("confidentialInformation", "Information protected", "text", true)}{field("exclusions", "Excluded information", "text", true)}{field("permittedRecipients", "Permitted recipients", "text", true)}</Group>
    <Group title="Duration & obligations">{field("agreementTerm", "Agreement duration")}{field("confidentialityPeriod", "Confidentiality survival period")}{field("returnDestruction", "Return / destruction requirements", "text", true)}</Group>
    <Group title="Governing law & special terms">{field("governingLaw", "Governing law")}{select("disputeResolution", "Dispute resolution", ["Arbitration", "Courts", "Mediation then arbitration"])}{field("specialTerms", "Special terms / additional clauses", "text", true)}</Group>
    <Group title="Signing">{field("signingPlace", "Place of signing")}{field("signingDate", "Date of signing", "date")}{field("witness1Name", "Witness 1 name & address")}{field("witness2Name", "Witness 2 name & address")}</Group>
  </>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-3 border-t pt-4"><legend className="pr-2 font-serif text-lg font-semibold">{title}</legend>{children}</fieldset>;
}