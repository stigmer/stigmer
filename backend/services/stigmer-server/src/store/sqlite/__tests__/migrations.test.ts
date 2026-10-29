/**
 * Pins the SQLite store's chain (../migrations.ts): a fresh database file
 * opened through the store reaches the newest version and holds exactly
 * the committed `schema.snapshot.sql`; reopening changes nothing; and a
 * database whose ledger is ahead of the build, as one from before the
 * 0.1.0 baseline is, is refused before anything is read. The runner's own
 * discipline is schema-chain.test.ts's.
 *
 * `npm run schema:snapshot` rewrites the snapshot after a new step.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, getSchemaVersion } from "../migrations.js";
import { snapshotSqliteSchema } from "../schema-snapshot.js";
import { SqliteStore } from "../store.js";

const SNAPSHOT = path.resolve(import.meta.dirname, "..", "schema.snapshot.sql");

describe("sqlite store migrations", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "stigmer-migrations-"));
    file = path.join(dir, "stigmer.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function inspect<T>(read: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(file);
    try {
      return read(db);
    } finally {
      db.close();
    }
  }

  it("brings a fresh file to the newest version, holding exactly the committed snapshot", async () => {
    await SqliteStore.open(file).close();
    expect(inspect(getSchemaVersion)).toBe(CURRENT_SCHEMA_VERSION);
    expect(inspect(snapshotSqliteSchema)).toBe(readFileSync(SNAPSHOT, "utf8"));
  });

  it("changes nothing on reopen", async () => {
    await SqliteStore.open(file).close();
    const ledger = (db: DatabaseSync) =>
      db
        .prepare(
          `SELECT version, applied_at, checksum FROM schema_version ORDER BY version`,
        )
        .all();
    const before = inspect(ledger);
    await SqliteStore.open(file).close();
    expect(inspect(ledger)).toEqual(before);
    expect(before).toHaveLength(CURRENT_SCHEMA_VERSION);
  });

  it("refuses a database whose ledger is ahead of the build, before reading anything else", () => {
    // The ledger a database from before the 0.1.0 baseline holds: no digest column, at v49.
    inspect((db) => {
      db.exec(
        `CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      );
      db.exec(`INSERT INTO schema_version (version) VALUES (49)`);
    });
    expect(() => SqliteStore.open(file)).toThrow(
      `Database schema version 49 is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION})`,
    );
  });
});
