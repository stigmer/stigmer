/**
 * The sign-in grant ledger's Postgres adapter (../postgres-sign-in-grants.ts)
 * over the real `ee.iam_sign_in_grants` table, through the real Enterprise
 * schema chain: the port's contract kit (../sign-in-grants-contract.ts),
 * the same cases the in-memory double (in-memory-sign-in-grants.ts, beside
 * this suite) passes, on a pool per case so the outage case can end it.
 * Every line the adapter keeps (one winning claim, concurrent claims
 * included, a row per account and organization, release and reclaim, the
 * organization's removal) is the kit's; the adapter adds none of its own.
 *
 * TEST_DATABASE_URL unset skips loudly by suite name (stigmer's
 * `make postgres-dev` prints the export).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../../__test-utils__/enterprise-postgres.js";
import { newSignInGrantLedger } from "../postgres-sign-in-grants.js";
import {
  signInGrantLedgerContract,
  type SignInGrantLedgerContractFixture,
} from "../sign-in-grants-contract.js";

describe.skipIf(!TEST_DATABASE_URL)("the sign-in grant ledger holds the port's contract (real Postgres)", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function makeFixture(): Promise<SignInGrantLedgerContractFixture> {
    await database.pool.query("TRUNCATE ee.iam_sign_in_grants");
    const pool = new Pool({ connectionString: database.databaseUrl, max: 8 });
    let ended = false;
    const end = async (): Promise<void> => {
      if (!ended) {
        ended = true;
        await pool.end();
      }
    };
    return { store: newSignInGrantLedger(pool), disconnect: end, cleanup: end };
  }

  for (const contractCase of signInGrantLedgerContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
