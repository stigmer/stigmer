/**
 * Pins the SQLite schema runner (../schema-chain.ts) on a chain of its own:
 * it creates its ledger, applies each step once with its digest, runs a
 * step's rewrite inside the step's transaction, rolls a failing step back
 * whole and names it, stops at `through` and resumes after it, leaves a
 * step a second connection already applied alone, refuses a database ahead
 * of the build, and refuses a database whose recorded digest differs from
 * the build's step, naming the version.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrationChecksum } from "../../schema-checksum.js";
import { runSqliteSchemaChain } from "../schema-chain.js";
import type { SqliteSchemaMigration } from "../schema-chain.js";

const STEPS: ReadonlyArray<SqliteSchemaMigration> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`,
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE notes ADD COLUMN words INTEGER NOT NULL DEFAULT 0`,
    ],
    rewrite: (db) => {
      db.exec(
        `UPDATE notes SET words = length(body) - length(replace(body, ' ', '')) + 1`,
      );
    },
  },
];

describe("runSqliteSchemaChain", () => {
  let dir: string;
  let file: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "stigmer-schema-chain-"));
    file = path.join(dir, "chain.db");
    db = new DatabaseSync(file);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ledger = () =>
    db
      .prepare(`SELECT version, checksum FROM schema_version ORDER BY version`)
      .all() as Array<{
      version: number;
      checksum: string;
    }>;

  it("applies each step once with its digest, and runs a rewrite in its step", () => {
    runSqliteSchemaChain(db, { migrations: STEPS, through: 1 });
    db.exec(`INSERT INTO notes (id, body) VALUES ('a', 'one two three')`);
    runSqliteSchemaChain(db, { migrations: STEPS });
    runSqliteSchemaChain(db, { migrations: STEPS });

    expect(ledger()).toEqual([
      { version: 1, checksum: migrationChecksum(STEPS[0]!.statements) },
      { version: 2, checksum: migrationChecksum(STEPS[1]!.statements) },
    ]);
    expect(db.prepare(`SELECT words FROM notes`).all()).toEqual([{ words: 3 }]);
  });

  it("rolls a failing step back whole, its rewrite included, and names it", () => {
    const failing: ReadonlyArray<SqliteSchemaMigration> = [
      STEPS[0]!,
      {
        version: 2,
        statements: [`CREATE TABLE tags (id TEXT PRIMARY KEY)`],
        rewrite: () => {
          throw new Error("a row did not decode");
        },
      },
    ];
    expect(() => runSqliteSchemaChain(db, { migrations: failing })).toThrow(
      "migrate to v2: Error: a row did not decode",
    );
    expect(ledger().map((row) => row.version)).toEqual([1]);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE name = 'tags'`).all(),
    ).toEqual([]);
  });

  it("leaves a step another connection applied after this one read the version", () => {
    runSqliteSchemaChain(db, { migrations: STEPS, through: 1 });
    const other = new DatabaseSync(file);
    try {
      runSqliteSchemaChain(other, { migrations: STEPS });
    } finally {
      other.close();
    }
    runSqliteSchemaChain(db, { migrations: STEPS });
    expect(ledger().map((row) => row.version)).toEqual([1, 2]);
  });

  it("refuses a database ahead of the build", () => {
    runSqliteSchemaChain(db, { migrations: STEPS });
    expect(() =>
      runSqliteSchemaChain(db, { migrations: STEPS.slice(0, 1) }),
    ).toThrow(
      "Database schema version 2 is newer than this server supports (maximum 1)",
    );
  });

  it("refuses a database whose recorded step differs from the build's, naming the version", () => {
    runSqliteSchemaChain(db, { migrations: STEPS });
    const edited = [
      STEPS[0]!,
      {
        ...STEPS[1]!,
        statements: [`ALTER TABLE notes ADD COLUMN chars INTEGER`],
      },
    ];
    expect(() => runSqliteSchemaChain(db, { migrations: edited })).toThrow(
      "Database schema version 2 was applied from different statements",
    );
  });
});
