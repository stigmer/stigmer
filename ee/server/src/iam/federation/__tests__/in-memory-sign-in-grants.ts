/**
 * The sign-in grant ledger in memory (iam/federation/sign-in-grants.ts), for
 * the federated lane's suites and the units built over it: the same claim
 * rule as the Postgres adapter (only the request that writes the row wins),
 * with the rows exposed so a suite can read what was recorded and remove a
 * row to stand for a purge, and the organization removal the purge runs.
 * The port's contract kit (../sign-in-grants-contract.ts) holds this double
 * and the Postgres adapter to the same lines.
 */
import type { SignInGrantLedger } from "../sign-in-grants.js";

export interface InMemorySignInGrants extends SignInGrantLedger {
  /** Every recorded (account, organization), as `account:org`, with the provider that recorded it. */
  readonly rows: Map<string, string>;
}

export function inMemorySignInGrants(): InMemorySignInGrants {
  const rows = new Map<string, string>();
  const key = (accountId: string, org: string): string => `${accountId}:${org}`;
  return {
    rows,
    recorded: (accountId, org) => Promise.resolve(rows.has(key(accountId, org))),
    claim(accountId, org, identityProviderId) {
      const at = key(accountId, org);
      if (rows.has(at)) {
        return Promise.resolve(false);
      }
      rows.set(at, identityProviderId);
      return Promise.resolve(true);
    },
    release(accountId, org) {
      rows.delete(key(accountId, org));
      return Promise.resolve();
    },
    removeByOrgId(org) {
      const removed = [...rows.keys()].filter((at) => at.endsWith(`:${org}`));
      for (const at of removed) {
        rows.delete(at);
      }
      return Promise.resolve(removed.length);
    },
  };
}
