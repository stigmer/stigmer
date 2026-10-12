/**
 * The Team store's Postgres adapter (../postgres-store.ts) over the real
 * `ee.iam_team` table, through the real Enterprise schema chain (one
 * throwaway database for the file).
 *
 * First what only the adapter can show: an insert refused by a unique
 * constraint other than the organization's slug (a taken id, the table's
 * primary key) is the driver's error, named by its constraint, and writes
 * nothing. Then the port's contract kit (../store-contract.ts) over this
 * adapter, the same cases the in-memory double passes, on a pool per case
 * so the outage case can end it: every other line the adapter keeps
 * (round trip, the slug claim per organization, replace, the reads and
 * their order, delete) is the kit's.
 *
 * TEST_DATABASE_URL unset skips loudly by suite name (stigmer's
 * `make postgres-dev` prints the export).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../../__test-utils__/enterprise-postgres.js";
import { newTeamStore } from "../postgres-store.js";
import { teamStoreContract, type TeamStoreContractFixture } from "../store-contract.js";
import { storedTeam } from "./in-memory-team-store.js";

describe.skipIf(!TEST_DATABASE_URL)("the Team store over ee.iam_team", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("answers a taken id as the driver's error, never as a taken slug", async () => {
    const store = newTeamStore(database.pool);
    await store.insert(storedTeam({ id: "tm_id", org: "acme", slug: "first" }));

    await expect(
      store.insert(storedTeam({ id: "tm_id", org: "acme", slug: "second" })),
    ).rejects.toMatchObject({ code: "23505", constraint: "iam_team_pkey" });
    expect((await store.findById("tm_id"))?.metadata?.slug).toBe("first");
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the Team store holds the port's contract (real Postgres)", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function makeFixture(): Promise<TeamStoreContractFixture> {
    await database.pool.query("TRUNCATE ee.iam_team");
    const pool = new Pool({ connectionString: database.databaseUrl, max: 4 });
    let ended = false;
    const end = async (): Promise<void> => {
      if (!ended) {
        ended = true;
        await pool.end();
      }
    };
    return { store: newTeamStore(pool), disconnect: end, cleanup: end };
  }

  for (const contractCase of teamStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
