import { describe, expect, it } from "vitest";
import { emptyLease } from "./lease";
import { contractTitle, emptyNda, isNda, looksLikeContract, missingContractFields, restoreContractParams } from "./contracts";

describe("NDA support alongside commercial leases", () => {
  it("requires NDA details without requiring rent or premises", () => {
    const params = { ...emptyNda, party1Name: "Acme Ltd", party2Name: "Beta Ltd", effectiveDate: "2026-11-03", purpose: "Manufacturing partnership", confidentialInformation: "Designs and pricing", agreementTerm: "12 months", confidentialityPeriod: "3 years after termination" };
    expect(missingContractFields(params)).toEqual([]);
    expect(missingContractFields({ ...params, confidentialInformation: "" })).toEqual(["confidentialInformation"]);
  });
  it("preserves legacy leases without a type marker", () => {
    const params = restoreContractParams({ landlordName: "Acme Ltd", tenantName: "Beta Ltd" });
    expect(isNda(params)).toBe(false);
    expect(missingContractFields(params)).toEqual(["premisesAddress", "commencementDate", "monthlyRent"]);
    expect(contractTitle(params)).toBe("Acme Ltd → Beta Ltd");
    expect(missingContractFields(emptyLease)).toContain("monthlyRent");
  });
  it("restores and titles saved NDA drafts", () => {
    const params = restoreContractParams({ contractType: "nda", party1Name: "Acme Ltd", party2Name: "Beta Ltd" });
    expect(isNda(params)).toBe(true);
    expect(contractTitle(params)).toBe("NDA: Acme Ltd ↔ Beta Ltd");
  });
  it("accepts NDA uploads without lease language", () => {
    expect(looksLikeContract("NON-DISCLOSURE AGREEMENT. The disclosing company shares confidential information with the receiving company for a permitted use. Disclosure is prohibited.")).toBe(true);
  });
  it("continues accepting leases", () => {
    expect(looksLikeContract("Commercial lease agreement between landlord and tenant for premises with monthly rent.")).toBe(true);
  });
  it("rejects unrelated documents", () => {
    expect(looksLikeContract("Shopping list: milk, bread, apples. Buy groceries on Tuesday.")).toBe(false);
  });
});