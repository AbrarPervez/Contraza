export type LeaseParams = {
  landlordName: string;
  landlordType: string;
  landlordAddress: string;
  landlordSignatory: string;
  tenantName: string;
  tenantType: string;
  tenantAddress: string;
  tenantSignatory: string;
  premisesAddress: string;
  premisesArea: string;
  permittedUse: string;
  commencementDate: string;
  termMonths: string;
  lockInMonths: string;
  renewalOption: string;
  monthlyRent: string;
  currency: string;
  rentDueDay: string;
  escalationPercent: string;
  escalationEveryMonths: string;
  securityDeposit: string;
  camCharges: string;
  noticePeriodMonths: string;
  governingLaw: string;
  disputeResolution: string;
  signingPlace: string;
  signingDate: string;
  witness1Name: string;
  witness2Name: string;
  clauses: string[];
  specialTerms: string;
};

export const CLAUSE_OPTIONS = [
  "Maintenance & repairs",
  "Subletting & assignment",
  "Insurance",
  "Indemnity",
  "Alterations & fit-outs",
  "Utilities & taxes",
  "Force majeure",
  "Confidentiality",
  "Default & termination",
  "Right of entry / inspection",
  "Signage",
  "Stamp duty & registration",
] as const;

export const emptyLease: LeaseParams = {
  landlordName: "",
  landlordType: "Private Limited Company",
  landlordAddress: "",
  landlordSignatory: "",
  tenantName: "",
  tenantType: "Private Limited Company",
  tenantAddress: "",
  tenantSignatory: "",
  premisesAddress: "",
  premisesArea: "",
  permittedUse: "Office",
  commencementDate: "",
  termMonths: "36",
  lockInMonths: "12",
  renewalOption: "One renewal of equal term at mutually agreed rent",
  monthlyRent: "",
  currency: "INR",
  rentDueDay: "7",
  escalationPercent: "5",
  escalationEveryMonths: "12",
  securityDeposit: "",
  camCharges: "",
  noticePeriodMonths: "3",
  governingLaw: "India",
  disputeResolution: "Arbitration",
  signingPlace: "",
  signingDate: "",
  witness1Name: "",
  witness2Name: "",
  clauses: [
    "Maintenance & repairs",
    "Subletting & assignment",
    "Indemnity",
    "Force majeure",
    "Default & termination",
    "Stamp duty & registration",
  ],
  specialTerms: "",
};

export const REQUIRED_FIELDS: (keyof LeaseParams)[] = [
  "landlordName",
  "tenantName",
  "premisesAddress",
  "commencementDate",
  "termMonths",
  "monthlyRent",
];

export function missingFields(p: LeaseParams): (keyof LeaseParams)[] {
  return REQUIRED_FIELDS.filter((k) => !String(p[k] ?? "").trim());
}
