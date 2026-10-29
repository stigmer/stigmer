/**
 * Pins the Postgres store's chain (../migrations.ts): a fresh database
 * opened through the store reaches the newest version and holds exactly
 * the committed `schema.snapshot.sql`; reopening changes nothing; and a
 * database whose ledger is ahead of the build, as one from before the
 * 0.1.0 baseline is, is refused before anything is read: the list index's
 * reconciliation never runs, and the refused open ends its pool. The runner's own
 * discipline (lock, digest check, rollback, `through`) is
 * schema-chain.postgres.test.ts's.
 *
 * Gated on TEST_DATABASE_URL (support.ts). `npm run schema:snapshot`
 * rewrites the snapshot after a new step.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { STORE_OPEN_OPTIONS } from "../../../boot/store-options.js";

import {
  CURRENT_SCHEMA_VERSION,
  POSTGRES_STORE_SCHEMA,
  getSchemaVersion,
} from "../migrations.js";
import { snapshotPostgresSchema } from "../schema-snapshot.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

const SNAPSHOT = path.resolve(import.meta.dirname, "..", "schema.snapshot.sql");

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres store migrations",
  () => {
    let db: TestDatabase;
    let pool: pg.Pool;

    beforeEach(async () => {
      db = await createTestDatabase();
      pool = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
    });

    afterEach(async () => {
      await pool.end();
      await db.drop();
    });

    it("brings a fresh database to the newest version, holding exactly the committed snapshot", async () => {
      await (await PostgresStore.open(db.databaseUrl)).close();
      const client = await pool.connect();
      try {
        expect(await getSchemaVersion(client)).toBe(CURRENT_SCHEMA_VERSION);
        expect(
          await snapshotPostgresSchema(client, POSTGRES_STORE_SCHEMA),
        ).toBe(readFileSync(SNAPSHOT, "utf8"));
      } finally {
        client.release();
      }
    });

    it("changes nothing on reopen", async () => {
      await (await PostgresStore.open(db.databaseUrl)).close();
      const before = await pool.query(
        `SELECT version, applied_at, checksum FROM schema_version ORDER BY version`,
      );
      await (await PostgresStore.open(db.databaseUrl)).close();
      const after = await pool.query(
        `SELECT version, applied_at, checksum FROM schema_version ORDER BY version`,
      );
      expect(after.rows).toEqual(before.rows);
      expect(after.rows).toHaveLength(CURRENT_SCHEMA_VERSION);
    });

    it("refuses a newer ledger before reconciling the list index, and ends its pool", async () => {
      const store = await PostgresStore.open(
        db.databaseUrl,
        undefined,
        STORE_OPEN_OPTIONS,
      );
      await store.saveResource(
        ApiResourceKind.agent,
        "agt_unproven",
        AgentSchema,
        create(AgentSchema, {
          metadata: { id: "agt_unproven", org: "acme", slug: "a", name: "A" },
          status: {
            audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
          },
        }),
      );
      await store.close();
      // A row written by a binary that does not know the index: unproven.
      await pool.query(
        `UPDATE resources SET list_indexed_at = NULL WHERE id = 'agt_unproven'`,
      );
      await pool.query(
        `INSERT INTO schema_version (version, checksum) VALUES ($1, 'a step a newer release shipped')`,
        [CURRENT_SCHEMA_VERSION + 1],
      );
      const url = new URL(db.databaseUrl);
      url.searchParams.set("application_name", "refused_open");
      await expect(
        PostgresStore.open(url.toString(), undefined, STORE_OPEN_OPTIONS),
      ).rejects.toThrow("is newer than this server supports");

      const row = await pool.query<{ indexed: Date | null }>(
        `SELECT list_indexed_at AS indexed FROM resources WHERE id = 'agt_unproven'`,
      );
      expect(row.rows).toEqual([{ indexed: null }]);
      let open = -1;
      for (let i = 0; i < 50 && open !== 0; i++) {
        const sessions = await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = 'refused_open'`,
        );
        open = Number(sessions.rows[0]?.n);
        if (open !== 0) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(open).toBe(0);
    });

    it("refuses a database whose ledger is ahead of the build, before reading anything else", async () => {
      // The ledger a database from before the 0.1.0 baseline holds: no digest column, at v45.
      await pool.query(
        `CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      await pool.query(`INSERT INTO schema_version (version) VALUES (45)`);
      await expect(PostgresStore.open(db.databaseUrl)).rejects.toThrow(
        `Database schema version 45 is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION}; schema "public")`,
      );
    });
  },
);
