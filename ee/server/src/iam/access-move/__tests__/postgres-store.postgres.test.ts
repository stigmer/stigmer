/**
 * The access move ticket store's Postgres adapter (../postgres-store.ts)
 * over the real `ee.iam_access_move_tickets` table, through the real
 * Enterprise schema chain: the port's contract kit (../store-contract.ts),
 * the same cases the in-memory double passes, on a pool per case so the
 * outage case can end it.
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
import { newAccessMoveTicketStore } from "../postgres-store.js";
import {
  accessMoveTicketStoreContract,
  type AccessMoveTicketStoreContractFixture,
} from "../store-contract.js";

describe.skipIf(!TEST_DATABASE_URL)("the access move ticket store holds the port's contract (real Postgres)", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function makeFixture(): Promise<AccessMoveTicketStoreContractFixture> {
    await database.pool.query("TRUNCATE ee.iam_access_move_tickets");
    const pool = new Pool({ connectionString: database.databaseUrl, max: 4 });
    let ended = false;
    const end = async (): Promise<void> => {
      if (!ended) {
        ended = true;
        await pool.end();
      }
    };
    return { store: newAccessMoveTicketStore(pool), disconnect: end, cleanup: end };
  }

  for (const contractCase of accessMoveTicketStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
