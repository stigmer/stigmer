/**
 * The access move ticket store's Postgres adapter over
 * `ee.iam_access_move_tickets`, which the Enterprise schema chain creates
 * (schema/enterprise-migrations.ts, v2). The primary key is the ticket's
 * hash; `markRedeemed` is a conditional update, so exactly one call closes a
 * ticket. The sweep and the purge ride their indexes.
 */
import type { Pool } from "pg";

import type { AccessMoveTicketRow, AccessMoveTicketStore } from "./store.js";

interface TicketRecord {
  readonly token_hash: string;
  readonly account_id: string;
  readonly org: string;
  readonly expires_at: Date;
  readonly redeemed_at: Date | null;
}

export function newAccessMoveTicketStore(pool: Pool): AccessMoveTicketStore {
  return {
    async insert(ticket) {
      await pool.query(
        `INSERT INTO ee.iam_access_move_tickets (token_hash, account_id, org, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [ticket.tokenHash, ticket.accountId, ticket.org, ticket.expiresAt],
      );
    },

    async findByHash(tokenHash): Promise<AccessMoveTicketRow | undefined> {
      const result = await pool.query<TicketRecord>(
        `SELECT token_hash, account_id, org, expires_at, redeemed_at
           FROM ee.iam_access_move_tickets WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : {
            tokenHash: row.token_hash,
            accountId: row.account_id,
            org: row.org,
            expiresAt: row.expires_at,
            redeemedAt: row.redeemed_at ?? undefined,
          };
    },

    async markRedeemed(tokenHash, at) {
      const result = await pool.query(
        `UPDATE ee.iam_access_move_tickets SET redeemed_at = $2
          WHERE token_hash = $1 AND redeemed_at IS NULL`,
        [tokenHash, at],
      );
      return result.rowCount !== null && result.rowCount > 0;
    },

    async deleteExpired(before) {
      const result = await pool.query(
        `DELETE FROM ee.iam_access_move_tickets WHERE expires_at < $1`,
        [before],
      );
      return result.rowCount ?? 0;
    },

    async removeByOrgId(org) {
      const result = await pool.query(`DELETE FROM ee.iam_access_move_tickets WHERE org = $1`, [org]);
      return result.rowCount ?? 0;
    },
  };
}
