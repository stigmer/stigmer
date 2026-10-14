/**
 * The IdentityProvider store's Postgres adapter (../postgres-store.ts) on
 * a driver error that holds no claim: anything but a unique violation of
 * one of the two claiming constraints, including a thrown value that is
 * not an error object at all, is the driver's fault and comes back as it
 * was, never read as a taken slug or route. The claims
 * themselves are the port's contract kit's, over a real table
 * (store.postgres.test.ts).
 */
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { newFederationIssuerStore } from "../postgres-store.js";
import { storedProvider } from "./in-memory-provider-store.js";

/** A pool whose transaction's insert fails with `fault`; BEGIN and ROLLBACK succeed. */
function failingPool(fault: unknown): Pool {
  const client = {
    query: (sql: string) => (sql.startsWith("INSERT") ? Promise.reject(fault) : Promise.resolve({ rows: [], rowCount: 0 })),
    release: () => undefined,
  } as unknown as PoolClient;
  return { connect: () => Promise.resolve(client) } as unknown as Pool;
}

describe("the IdentityProvider store's Postgres adapter", () => {
  const provider = storedProvider({ id: "idp_acme", org: "acme", slug: "acme-okta", issuers: ["https://okta.acme.test"] });

  it("returns a thrown value that is not an error object as it was", async () => {
    await expect(newFederationIssuerStore(failingPool("socket closed")).insert(provider)).rejects.toBe("socket closed");
  });

  it("returns a driver error that is not a unique violation as it was", async () => {
    const fault = Object.assign(new Error("null value in column"), { code: "23502", constraint: "iam_identity_provider_pkey" });
    await expect(newFederationIssuerStore(failingPool(fault)).insert(provider)).rejects.toBe(fault);
  });
});
