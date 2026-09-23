/**
 * The list index's repair never overwrites a newer write (../store.ts,
 * `deriveAndRepair`): a read that finds a row unproven derives its facts
 * from the bytes it read and writes them back only while those bytes are
 * still the stored ones. Pinned against a real interleaving, not assumed
 * from the statement's shape: a second connection rewrites the row and
 * holds its lock uncommitted, the read's repair queues behind that lock
 * (observed in pg_stat_activity, polled with a timeout, never slept for),
 * the rewrite commits, and the repair then matches nothing — the row
 * stays unproven and the next read answers from the newer bytes. sqlite
 * runs the read and its repair on one synchronous connection, so the
 * interleaving this pins cannot arise inside one process there.
 *
 * Gated on TEST_DATABASE_URL (support.ts).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../list-index.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

const sessions = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 1,
  keys: {},
});

function sessionBytes(org: string): Buffer {
  return Buffer.from(
    toBinary(
      SessionSchema,
      create(SessionSchema, { metadata: { id: "ses_1", org } }),
    ),
  );
}

async function waitForLockWaiter(
  hooks: pg.Pool,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await hooks.query(
      `SELECT count(*) AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (Number((result.rows[0] as { waiting: string }).waiting) > 0) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the repair never queued behind the row lock");
}

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres list-index repair",
  () => {
    let db: TestDatabase;
    let hooks: pg.Pool;

    beforeAll(async () => {
      db = await createTestDatabase();
      hooks = new pg.Pool({ connectionString: db.databaseUrl, max: 3 });
    });

    afterAll(async () => {
      await hooks.end();
      await db.drop();
    });

    it("leaves a row rewritten while its repair waited unproven, and reads the newer bytes next", async () => {
      const store = await PostgresStore.open(db.databaseUrl, undefined, {
        listIndexes: [sessions],
      });
      try {
        // An older binary's write: the row is unproven.
        await hooks.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ('session', 'ses_1', $1, now())`,
          [sessionBytes("old")],
        );

        const writer = await hooks.connect();
        try {
          await writer.query("BEGIN");
          await writer.query(
            `UPDATE resources SET data = $1, updated_at = now() WHERE kind = 'session' AND id = 'ses_1'`,
            [sessionBytes("newer")],
          );

          const read = store.queryResources(sessions, { org: "old" });
          await waitForLockWaiter(hooks, 10_000);
          await writer.query("COMMIT");

          expect(
            (await read).map((row) => row.id),
            "the read answers from the bytes it read",
          ).toEqual(["ses_1"]);
        } finally {
          writer.release();
        }

        const stamped = await hooks.query(
          `SELECT list_indexed_at IS NOT DISTINCT FROM updated_at AS stamped, list_org
           FROM resources WHERE kind = 'session' AND id = 'ses_1'`,
        );
        expect(stamped.rows[0], "the repair matched nothing").toEqual({
          stamped: false,
          list_org: null,
        });
        expect(
          (await store.queryResources(sessions, { org: "old" })).length,
        ).toBe(0);
        expect(
          (await store.queryResources(sessions, { org: "newer" })).map(
            (row) => row.id,
          ),
        ).toEqual(["ses_1"]);
      } finally {
        await store.close();
      }
    });
  },
);
