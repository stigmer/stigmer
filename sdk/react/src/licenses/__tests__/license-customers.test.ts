// Customers derived from issued licenses: one entry per customer id, read
// from the most recently issued license, and the duplicate guard that
// keeps one company from being minted twice.

import { describe, it, expect } from "vitest";
import { deriveLicenseCustomers, findCustomerMatches } from "../license-customers";
import { license } from "./fixtures";

describe("deriveLicenseCustomers", () => {
  it("keeps one entry per customer id, from its latest license, sorted by name", () => {
    const customers = deriveLicenseCustomers([
      license({ id: "lic_1", contactEmail: "old@acme.test", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" }),
      license({ id: "lic_2", customerId: "cus_beta", customerName: "Beta", issuedAt: "2026-02-01T00:00:00Z", expiresAt: "2027-02-01T00:00:00Z" }),
      license({ id: "lic_3", contactEmail: "new@acme.test", issuedAt: "2026-06-01T00:00:00Z", expiresAt: "2027-06-01T00:00:00Z" }),
    ]);
    expect(customers.map((c) => [c.customer.displayName, c.customer.contactEmail, c.licenseCount])).toEqual([
      ["Acme Corp", "new@acme.test", 2],
      ["Beta", "licensing@acme.test", 1],
    ]);
  });
});

describe("findCustomerMatches", () => {
  const customers = deriveLicenseCustomers([
    license({ id: "lic_1", customerName: "Acme Corp", contactEmail: "ops@acme.test", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" }),
  ]);

  it("matches a name or an address regardless of case and spacing", () => {
    expect(findCustomerMatches(customers, { displayName: "  acme   CORP ", contactEmail: "" })).toHaveLength(1);
    expect(findCustomerMatches(customers, { displayName: "", contactEmail: "OPS@acme.test" })).toHaveLength(1);
  });

  it("matches nothing for empty or different input", () => {
    expect(findCustomerMatches(customers, { displayName: "", contactEmail: "" })).toHaveLength(0);
    expect(findCustomerMatches(customers, { displayName: "Acme Labs", contactEmail: "labs@acme.test" })).toHaveLength(0);
  });
});
