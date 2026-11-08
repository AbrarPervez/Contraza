import { emptyLease, missingFields, type LeaseParams } from "./lease";

export type NdaParams = {
  contractType: "nda";
  ndaType: string;
  party1Name: string;
  party1Type: string;
  party1Address: string;
  party1Signatory: string;
  party2Name: string;
  party2Type: string;
  party2Address: string;
  party2Signatory: string;
  effectiveDate: string;
  purpose: string;
  confidentialInformation: string;
  exclusions: string;
  permittedRecipients: string;
  agreementTerm: string;
  confidentialityPeriod: string;
  returnDestruction: string;
  governingLaw: string;
  disputeResolution: string;
  signingPlace: string;
  signingDate: string;
  witness1Name: string;
  witness2Name: string;
  specialTerms: string;
};

export type ContractParams = LeaseParams | NdaParams;
export type ContractType = "lease" | "nda";

export const emptyNda: NdaParams = {
  contractType: "nda", ndaType: "Mutual", party1Name: "", party1Type: "Private Limited Company",
  party1Address: "", party1Signatory: "", party2Name: "", party2Type: "Private Limited Company",
  party2Address: "", party2Signatory: "", effectiveDate: "", purpose: "", confidentialInformation: "",
  exclusions: "", permittedRecipients: "", agreementTerm: "", confidentialityPeriod: "",
  returnDestruction: "", governingLaw: "India", disputeResolution: "Arbitration",
  signingPlace: "", signingDate: "", witness1Name: "", witness2Name: "", specialTerms: "",
};

export const NDA_REQUIRED_FIELDS: (keyof NdaParams)[] = [
  "party1Name", "party2Name", "effectiveDate", "purpose", "confidentialInformation", "agreementTerm", "confidentialityPeriod",
];

export function isNda(params: ContractParams): params is NdaParams {
  return "contractType" in params && params.contractType === "nda";
}

export function restoreContractParams(value: unknown): ContractParams {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return "contractType" in raw && raw.contractType === "nda"
    ? { ...emptyNda, ...raw } as NdaParams
    : { ...emptyLease, ...raw } as LeaseParams;
}

export function missingContractFields(params: ContractParams): string[] {
  return isNda(params)
    ? NDA_REQUIRED_FIELDS.filter((key) => !String(params[key] ?? "").trim())
    : missingFields(params);
}

export function contractTitle(params: ContractParams): string {
  if (isNda(params)) return params.party1Name && params.party2Name ? `NDA: ${params.party1Name} ↔ ${params.party2Name}` : "Untitled NDA";
  return params.landlordName && params.tenantName ? `${params.landlordName} → ${params.tenantName}` : "Untitled lease";
}

// This is a lightweight language check, not legal document classification.
export function looksLikeContract(text: string): boolean {
  const signals = ["lease", "lessor", "lessee", "landlord", "tenant", "premises", "rent", "agreement", "contract", "party", "parties", "term", "clause", "deposit", "termination", "whereas", "hereby", "covenant", "indemnif", "arbitration", "non-disclosure", "nondisclosure", "nda", "confidential", "disclosing", "receiving", "recipient", "trade secret", "permitted use"];
  const lower = text.toLowerCase();
  return signals.filter((signal) => new RegExp(`\\b${signal}`, "i").test(lower)).length >= 4;
}