// Pins CloudTarget.fundTenancy's two calls: the target's own caller makes
// sure the organization has a billing account, and the credit issuer seeds
// it, both naming the organization as `org`. The two client accessors are
// stubbed; nothing here starts a server.
import { describe, expect, it, vi } from "vitest";

import type { ConformanceClients } from "../../harness/clients";
import { CloudTarget } from "../cloud";

describe("CloudTarget.fundTenancy", () => {
  it("ensures the organization's account, then funds it, naming the organization as org", async () => {
    const ensured: unknown[] = [];
    const funded: unknown[] = [];
    const target = new CloudTarget();
    vi.spyOn(target, "clients").mockReturnValue({
      billingCommand: {
        getOrCreateBillingAccount: async (input: unknown) => (ensured.push(input), {}),
      },
    } as unknown as ConformanceClients);
    vi.spyOn(target, "creditIssuer").mockReturnValue({
      billingCommand: {
        adjustCredits: async (input: unknown) => (funded.push(input), {}),
      },
    } as unknown as ConformanceClients);

    await target.fundTenancy("acme");

    expect(ensured).toEqual([{ org: "acme" }]);
    expect(funded).toEqual([
      {
        org: "acme",
        amountMicros: 100_000_000n,
        reason: "conformance execution tenancy seed",
        idempotencyKey: "conformance-seed-acme",
      },
    ]);
  });
});
