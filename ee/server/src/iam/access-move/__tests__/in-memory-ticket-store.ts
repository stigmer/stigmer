/**
 * An in-memory access move ticket store with the Postgres adapter's
 * semantics (../postgres-store.ts): a held hash refuses a second insert,
 * `claimFor` binds a ticket to its first redeemer, `markRedeemed` closes a
 * ticket once, the sweep removes what expired
 * before the instant asked. For the unit suites that compose the identity
 * unit or drive the move's handlers without a database.
 */
import type { AccessMoveTicketRow, AccessMoveTicketStore } from "../store.js";

export interface InMemoryTicketStore extends AccessMoveTicketStore {
  readonly rows: Map<string, AccessMoveTicketRow>;
}

export function newInMemoryTicketStore(): InMemoryTicketStore {
  const rows = new Map<string, AccessMoveTicketRow>();
  return {
    rows,
    async insert(ticket) {
      if (rows.has(ticket.tokenHash)) {
        throw new Error(`access move ticket ${ticket.tokenHash} is already held`);
      }
      rows.set(ticket.tokenHash, { ...ticket, redeemedAt: undefined, redeemerId: undefined });
    },
    async findByHash(tokenHash) {
      return rows.get(tokenHash);
    },
    async claimFor(tokenHash, redeemerId) {
      const row = rows.get(tokenHash);
      if (row === undefined || (row.redeemerId !== undefined && row.redeemerId !== redeemerId)) {
        return false;
      }
      rows.set(tokenHash, { ...row, redeemerId });
      return true;
    },
    async markRedeemed(tokenHash, at) {
      const row = rows.get(tokenHash);
      if (row === undefined || row.redeemedAt !== undefined) {
        return false;
      }
      rows.set(tokenHash, { ...row, redeemedAt: at });
      return true;
    },
    async deleteExpired(before) {
      let removed = 0;
      for (const [hash, row] of rows) {
        if (row.expiresAt.getTime() < before.getTime()) {
          rows.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
    async removeByOrgId(org) {
      let removed = 0;
      for (const [hash, row] of rows) {
        if (row.org === org) {
          rows.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
