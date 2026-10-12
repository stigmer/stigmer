/**
 * The Invitation store's Postgres adapter (../postgres-store.ts) over the
 * real `ee.iam_invitation` table, through the real Enterprise schema chain
 * (one throwaway database per describe).
 *
 * First what only the adapter can show:
 *   - a token another invitation holds is refused by the table's unique
 *     index, and nothing is written;
 *   - the list's cursor keeps microseconds, so a row a microsecond older
 *     than the cursor is the next one, never rounded out;
 *   - a cursor the adapter would never render (the cursor is client text,
 *     inside an unsigned page token) continues nothing instead of failing
 *     the cast;
 *   - a row it cannot read under the row lock rolls back and rethrows,
 *     leaving no lock held.
 * Then the port's contract kit (../store-contract.ts) over this adapter,
 * the same cases the in-memory double passes, on a pool per case so the
 * outage case can end it: every other line the adapter keeps (the round
 * trip, update, the list's order, cursor and limit, the sweep, delete, the
 * guarded redemption and its race, the release) is the kit's.
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
import { newInvitationStore } from "../postgres-store.js";
import type { InvitationStore } from "../store.js";
import { invitationStoreContract, type InvitationStoreContractFixture } from "../store-contract.js";
import { storedInvitation } from "./in-memory-invitation-store.js";

describe.skipIf(!TEST_DATABASE_URL)("the Invitation store over ee.iam_invitation", () => {
  let database: ProvisionedEnterpriseDatabase;
  let store: InvitationStore;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
    store = newInvitationStore(database.pool);
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("refuses a token another invitation holds, naming the table's unique index", async () => {
    await store.save(storedInvitation({ id: "inv_rt", org: "acme", token: "RoundTrip" }));
    await expect(
      store.save(storedInvitation({ id: "inv_rt2", org: "other", token: "RoundTrip" })),
    ).rejects.toThrow(/iam_invitation_token/);
    expect(await store.findById("inv_rt2")).toBeUndefined();
  });

  it("continues after a cursor to a row a microsecond older, never rounding it out", async () => {
    await store.save(storedInvitation({ id: "inv_us_new", org: "micros", token: "UsNew" }));
    await store.save(storedInvitation({ id: "inv_us_old", org: "micros", token: "UsOld" }));
    // Both rows inside one millisecond, which a millisecond cursor cannot tell apart.
    await database.pool.query(
      "UPDATE ee.iam_invitation SET created_at = $2::timestamptz WHERE id = $1",
      ["inv_us_new", "2026-09-25T12:00:00.000400Z"],
    );
    await database.pool.query(
      "UPDATE ee.iam_invitation SET created_at = $2::timestamptz WHERE id = $1",
      ["inv_us_old", "2026-09-25T12:00:00.000100Z"],
    );

    const first = await store.pageByOrg("micros", undefined, 1);
    expect(first[0]?.cursor).toEqual({ createdAt: "2026-09-25T12:00:00.000400Z", id: "inv_us_new" });
    const next = await store.pageByOrg("micros", first[0]?.cursor, 1);
    expect(next.map((row) => row.id)).toEqual(["inv_us_old"]);
  });

  it("continues nothing after a cursor it would never render, rather than faulting", async () => {
    await store.save(storedInvitation({ id: "inv_forged", org: "forged", token: "Forged" }));
    for (const createdAt of [
      "not an instant",
      "2026-02-31T12:00:00.000000Z",
      "2026-09-25T12:00:00.000Z",
      "2026-09-25 12:00:00.000000+00",
      "0000-01-01T00:00:00.000000Z",
    ]) {
      expect(await store.pageByOrg("forged", { createdAt, id: "inv_x" }, 2)).toEqual([]);
    }
    expect(
      await store.pageByOrg("forged", { createdAt: "2026-09-25T12:00:00.000000Z", id: "inv_\u0000" }, 2),
    ).toEqual([]);
    expect((await store.pageByOrg("forged", undefined, 2)).map((row) => row.id)).toEqual(["inv_forged"]);
  });

  it("rolls back and rethrows on a row it cannot read, leaving no lock held", async () => {
    await store.save(storedInvitation({ id: "inv_bad", org: "broken", token: "Broken" }));
    await database.pool.query("UPDATE ee.iam_invitation SET data = $2 WHERE id = $1", [
      "inv_bad",
      Buffer.from([0xff, 0xff, 0xff]),
    ]);

    // A session of its own, checked out before the store's, so the pool
    // never hands the store this one: it asks for the row lock afterwards.
    const probe = await database.pool.connect();
    try {
      await expect(store.recordRedemption("inv_bad", "ida_one", new Date())).rejects.toThrow();
      await expect(store.releaseRedemption("inv_bad", "ida_one", new Date())).rejects.toThrow();

      // A session the store left in its transaction would still hold the
      // row's lock, and this one would time out waiting for it.
      await probe.query("BEGIN");
      await probe.query("SET LOCAL lock_timeout = '2s'");
      const locked = await probe.query(
        "SELECT id FROM ee.iam_invitation WHERE id = $1 FOR UPDATE",
        ["inv_bad"],
      );
      expect(locked.rowCount).toBe(1);
    } finally {
      await probe.query("ROLLBACK");
      probe.release();
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the Invitation store holds the port's contract (real Postgres)", () => {
  let database: ProvisionedEnterpriseDatabase;

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function makeFixture(): Promise<InvitationStoreContractFixture> {
    await database.pool.query("TRUNCATE ee.iam_invitation");
    const pool = new Pool({ connectionString: database.databaseUrl, max: 8 });
    let ended = false;
    const end = async (): Promise<void> => {
      if (!ended) {
        ended = true;
        await pool.end();
      }
    };
    return { store: newInvitationStore(pool), disconnect: end, cleanup: end };
  }

  for (const contractCase of invitationStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
