import { describe, expect, it } from "vitest";
import { fillContractPlaceholders, findContractPlaceholders, matchingContractPlaceholders } from "./contract-placeholders";

it("does not crash when console.error is unavailable", async () => {
  const originalConsole = globalThis.console;

  try {
    Object.defineProperty(globalThis, "console", {
      value: { log: () => undefined },
      configurable: true,
      writable: true,
    });

    await expect(import(`./error-capture?ts=${Date.now()}`)).resolves.toBeDefined();
  } finally {
    Object.defineProperty(globalThis, "console", {
      value: originalConsole,
      configurable: true,
      writable: true,
    });
  }
});

describe("post-draft missing details", () => {
  it("finds unnamed and labelled blank fields without treating citations or links as blanks", () => {
    const fields = findContractPlaceholders("Date: [●]. Place: [Insert city]. See [1] and [guide](https://example.com).");
    expect(fields.map((field) => field.text)).toEqual(["[●]", "[Insert city]"]);
  });

  it("fills identical placeholders independently and preserves the rest of the contract", () => {
    const text = "Landlord: [●]. Tenant: [●]. Rent remains INR 50000.";
    const fields = findContractPlaceholders(text);
    const [landlord, tenant] = fields;
    if (!landlord || !tenant) throw new Error("Expected two blank fields");
    expect(fillContractPlaceholders(text, { [landlord.start]: "Acme Ltd", [tenant.start]: "Beta Ltd" }))
      .toBe("Landlord: Acme Ltd. Tenant: Beta Ltd. Rent remains INR 50000.");
  });

  it("retains unfilled placeholders", () => {
    expect(fillContractPlaceholders("Date: [●].", { 6: "   " })).toBe("Date: [●].");
  });

  it("autofills repeated named information but not unrelated blanks", () => {
    const text = "Place: [Signing city]. Witness: [Witness name]. Signed at [Signing city].";
    const target = findContractPlaceholders(text)[0];
    if (!target) throw new Error("Expected blank");
    const values = Object.fromEntries(matchingContractPlaceholders(text, target).map((field) => [field.start, "Kolkata"]));
    expect(fillContractPlaceholders(text, values)).toBe("Place: Kolkata. Witness: [Witness name]. Signed at Kolkata.");
  });

  it("matches signing dates by context without filling other anonymous blanks", () => {
    const text = "Executed on [●] at [●].\nDate of signing: [●].\nWitness: [●].";
    const target = findContractPlaceholders(text)[0];
    if (!target) throw new Error("Expected blank");
    expect(matchingContractPlaceholders(text, target).map((field) => field.start)).toEqual([12, 41]);
  });
});