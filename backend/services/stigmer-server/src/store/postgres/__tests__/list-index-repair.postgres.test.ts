/**
 * The list index's repair never overwrites a newer write (../store.ts,
 * `deriveAndRepair`): a read that finds a row unproven derives its facts
 * from the bytes it read and writes them back only while those bytes are
 * still the stored ones. Pinned against a real interleaving, not assumed
 * from the statement's shape: a second connection rewrites the row and
 * holds its lock uncommitted, the read's repair queues behind that lock
 * (observed in pg_stat_activity, polled with a timeout, never slept for),
 * the rewrite commits, and the repair then matches nothing — the row
 * stays unproven and the next read answers from the newer bytes. The
 * mark a read writes for a row that does not decode is the same
 * compare-and-set and is pinned the same way: a rewrite with good bytes
 * wins over it (stigmer/stigmer#3152). sqlite runs the read and its repair
 * on one synchronous connection, so the interleaving this pins cannot
 * arise inside one process there.
 *
 * Also what this driver logs about such a row: one warning when a list
 * marks it, none from the lists after, and at open one line per kind
 * naming the rows still marked. The contract kit cannot see a store's
 * logger (interface.ts, StoreOpenOptions), so this is proven per driver.
 *
 * Gated on TEST_DATABASE_URL (support.ts).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../list-index.js";
import type { StoreLogger } from "../../logger.js";
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

function sessionBytes(org: string, id = "ses_1"): Buffer {
  return Buffer.from(
    toBinary(SessionSchema, create(SessionSchema, { metadata: { id, org } })),
  );
}

const GARBAGE = Buffer.from([0xff, 0xff, 0xff]);

interface LogLine {
  readonly level: "debug" | "info" | "warn";
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

function recordingLogger(): StoreLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    debug: (message, fields) => lines.push({ level: "debug", message, fields }),
    info: (message, fields) => lines.push({ level: "info", message, fields }),
    warn: (message, fields) => lines.push({ level: "warn", message, fields }),
  };
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

    it("loses a mark to a rewrite with good bytes made while the mark waited, and lists the row next", async () => {
      await hooks.query(`TRUNCATE resources, resource_list_keys`);
      const store = await PostgresStore.open(db.databaseUrl, undefined, {
        listIndexes: [sessions],
      });
      try {
        await hooks.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ('session', 'ses_2', $1, now())`,
          [GARBAGE],
        );

        const writer = await hooks.connect();
        try {
          await writer.query("BEGIN");
          await writer.query(
            `UPDATE resources SET data = $1, updated_at = now() WHERE kind = 'session' AND id = 'ses_2'`,
            [sessionBytes("acme", "ses_2")],
          );

          const read = store.queryResourcesForSweep(sessions, {});
          await waitForLockWaiter(hooks, 10_000);
          await writer.query("COMMIT");

          expect(
            (await read).undecodable,
            "the read judged the bytes it read",
          ).toEqual(["ses_2"]);
        } finally {
          writer.release();
        }

        const stamped = await hooks.query(
          `SELECT list_indexed_at IS NOT DISTINCT FROM updated_at AS stamped
           FROM resources WHERE kind = 'session' AND id = 'ses_2'`,
        );
        expect(stamped.rows[0], "the mark matched nothing").toEqual({
          stamped: false,
        });
        const next = await store.queryResourcesForSweep(sessions, {
          org: "acme",
        });
        expect(next.rows.map((row) => row.id)).toEqual(["ses_2"]);
        expect(next.undecodable).toEqual([]);
      } finally {
        await store.close();
      }
    });

    it("warns once when a list marks a row, never on the lists after, and names the marked rows once per kind at open", async () => {
      await hooks.query(`TRUNCATE resources, resource_list_keys`);
      const logger = recordingLogger();
      const store = await PostgresStore.open(db.databaseUrl, logger, {
        listIndexes: [sessions],
      });
      try {
        for (const id of ["ses_b", "ses_a"]) {
          await hooks.query(
            `INSERT INTO resources (kind, id, data, updated_at) VALUES ('session', $1, $2, now())`,
            [id, GARBAGE],
          );
        }
        logger.lines.length = 0;
        for (let i = 0; i < 3; i++) {
          await store.queryResources(sessions, { org: "acme" });
          await store.queryResourcesForSweep(sessions, {});
        }
        // The unproven arms answer in no set order, so the lines are compared by id.
        const byId = [...logger.lines].sort((a, b) =>
          String(a.fields?.id).localeCompare(String(b.fields?.id)),
        );
        expect(byId).toEqual([
          {
            level: "warn",
            message:
              "list index: a row does not decode; marked, lists skip it until it is rewritten",
            fields: { kind: "session", id: "ses_a" },
          },
          {
            level: "warn",
            message:
              "list index: a row does not decode; marked, lists skip it until it is rewritten",
            fields: { kind: "session", id: "ses_b" },
          },
        ]);
      } finally {
        await store.close();
      }

      const reopened = recordingLogger();
      const again = await PostgresStore.open(db.databaseUrl, reopened, {
        listIndexes: [sessions],
      });
      try {
        expect(reopened.lines.filter((line) => line.level === "warn")).toEqual([
          {
            level: "warn",
            message:
              "list index: rows do not decode; lists skip them until they are rewritten",
            fields: { kind: "session", rows: 2, ids: ["ses_a", "ses_b"] },
          },
        ]);
        reopened.lines.length = 0;
        await again.queryResources(sessions, {});
        expect(reopened.lines, "a list after open logs nothing").toEqual([]);
      } finally {
        await again.close();
      }
    });

    it("warns when a mark cannot be written, leaves the row to be judged again, and marks it on the next read", async () => {
      await hooks.query(`TRUNCATE resources, resource_list_keys`);
      const logger = recordingLogger();
      const store = await PostgresStore.open(db.databaseUrl, logger, {
        listIndexes: [sessions],
      });
      try {
        await hooks.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ('session', 'ses_3', $1, now())`,
          [GARBAGE],
        );
        await hooks.query(
          `CREATE FUNCTION refuse_list_stamp() RETURNS trigger LANGUAGE plpgsql AS
             $$ BEGIN RAISE EXCEPTION 'refused by the test'; END $$`,
        );
        await hooks.query(
          `CREATE TRIGGER refuse_list_stamp BEFORE UPDATE OF list_indexed_at ON resources
             FOR EACH ROW EXECUTE FUNCTION refuse_list_stamp()`,
        );
        logger.lines.length = 0;
        try {
          expect(
            (await store.queryResourcesForSweep(sessions, {})).undecodable,
          ).toEqual(["ses_3"]);
        } finally {
          await hooks.query(`DROP TRIGGER refuse_list_stamp ON resources`);
          await hooks.query(`DROP FUNCTION refuse_list_stamp()`);
        }
        expect(logger.lines).toEqual([
          {
            level: "warn",
            message: "list index: marking a row that does not decode failed",
            fields: {
              kind: "session",
              id: "ses_3",
              error: "refused by the test",
            },
          },
        ]);

        logger.lines.length = 0;
        expect(
          (await store.queryResourcesForSweep(sessions, {})).undecodable,
        ).toEqual(["ses_3"]);
        expect(
          logger.lines.map((line) => line.message),
          "the next read marks it",
        ).toEqual([
          "list index: a row does not decode; marked, lists skip it until it is rewritten",
        ]);
      } finally {
        await store.close();
      }
    });
  },
);
