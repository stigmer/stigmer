/**
 * The sign-in grant ledger's Postgres adapter over `ee.iam_sign_in_grants`,
 * which the Enterprise schema chain creates (schema/enterprise-migrations.ts).
 * The primary key (account_id, org) is the claim race's guard: two
 * concurrent first sign-ins insert, and exactly one row lands. The
 * organization purge's delete rides the index `iam_sign_in_grants_org`.
 */
import type { Pool } from "pg";

import type { SignInGrantLedger } from "./sign-in-grants.js";

export function newSignInGrantLedger(pool: Pool): SignInGrantLedger {
  return {
    async recorded(accountId, org) {
      const result = await pool.query(
        `SELECT 1 FROM ee.iam_sign_in_grants WHERE account_id = $1 AND org = $2`,
        [accountId, org],
      );
      return result.rowCount !== null && result.rowCount > 0;
    },

    async claim(accountId, org, identityProviderId) {
      const result = await pool.query(
        `INSERT INTO ee.iam_sign_in_grants (account_id, org, identity_provider_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, org) DO NOTHING
         RETURNING account_id`,
        [accountId, org, identityProviderId],
      );
      return result.rowCount !== null && result.rowCount > 0;
    },

    async release(accountId, org) {
      await pool.query(
        `DELETE FROM ee.iam_sign_in_grants WHERE account_id = $1 AND org = $2`,
        [accountId, org],
      );
    },

    async removeByOrgId(org) {
      const result = await pool.query(
        `DELETE FROM ee.iam_sign_in_grants WHERE org = $1`,
        [org],
      );
      return result.rowCount ?? 0;
    },
  };
}
