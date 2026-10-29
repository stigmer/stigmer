/**
 * Pins the Postgres store's chain (../migrations.ts): a fresh database
 * opened through the store reaches the newest version and holds exactly
 * the committed `schema.snapshot.sql`; reopening changes nothing; and a
 * database whose ledger is ahead of the build, as one from before the
 * 0.1.0 baseline is, is refused before anything is read. The runner's own
 * discipline (lock, digest check, rollback, `through`) is
 * schema-chain.postgres.test.ts's.
 *
 * Gated on TEST_DATABASE_URL (support.ts). `npm run schema:snapshot`
 * rewrites the snapshot after a new step.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
