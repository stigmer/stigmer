/**
 * Pins the Postgres migration chain (DD-010 §3, independent v1): fresh
 * replay creates the full schema and records the version, reopen is
 * idempotent, and concurrent first boots serialize on the advisory lock
 * instead of racing the chain — the multi-instance failure class sqlite's
 * single-file lock never had.
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import pg from "pg";

import { CURRENT_SCHEMA_VERSION } from "../migrations.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres migrations",
  () => {
    let db: TestDatabase;

    beforeEach(async () => {
      db = await createTestDatabase();
    });

    afterEach(async () => {
      await db.drop();
    });

    it("a fresh database replays the chain: all tables present, version recorded", async () => {
      const store = await PostgresStore.open(db.databaseUrl);
      await store.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const version = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        expect(Number((version.rows[0] as { version: string }).version)).toBe(
          CURRENT_SCHEMA_VERSION,
        );

        const tables = await client.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' ORDER BY table_name`,
        );
        const names = (tables.rows as Array<{ table_name: string }>).map(
          (row) => row.table_name,
        );
        expect(names).toEqual([
          "bootstrap_state",
          "oauth_grant",
          "pending_oauth_state",
          "resource_audit",
          "resources",
          "schedule_runs",
          "schema_version",
          "search_index",
          "signal_dedupe",
          "workflow_execution_events",
        ]);
      } finally {
        await client.end();
      }
    });

    it("reopening a migrated database is an idempotent no-op", async () => {
      const first = await PostgresStore.open(db.databaseUrl);
      await first.close();
      const second = await PostgresStore.open(db.databaseUrl);
      await second.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const rows = await client.query(`SELECT version FROM schema_version`);
        expect(rows.rowCount, "one version row per chain step, ever").toBe(
          CURRENT_SCHEMA_VERSION,
        );
      } finally {
        await client.end();
      }
    });

    it("concurrent first boots serialize on the advisory lock — both succeed", async () => {
      // Without pg_advisory_lock, one of these would fail on a duplicate
      // CREATE TABLE or duplicate version insert.
      const [a, b] = await Promise.all([
        PostgresStore.open(db.databaseUrl),
        PostgresStore.open(db.databaseUrl),
      ]);
      await a.close();
      await b.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const rows = await client.query(`SELECT version FROM schema_version`);
        expect(rows.rowCount).toBe(CURRENT_SCHEMA_VERSION);
      } finally {
        await client.end();
      }
    });
  },
);
