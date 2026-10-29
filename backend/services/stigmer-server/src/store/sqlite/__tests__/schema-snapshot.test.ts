/**
 * Pins the SQLite schema printer (../schema-snapshot.ts): every table and
 * virtual table in name order, each followed by its indexes in name order;
 * whitespace collapsed and a CREATE TABLE's list one item per line, a comma
 * inside parentheses or quotes never splitting an item; WITHOUT ROWID and
 * CHECK kept as written; an FTS5 table's shadow tables and the chain's
 * ledger left out.
 */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { snapshotSqliteSchema } from "../schema-snapshot.js";

describe("snapshotSqliteSchema", () => {
  it("prints tables with their indexes, a list item per line, and leaves out the engine's tables", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE zeta (
          id    TEXT PRIMARY KEY,
          note  TEXT NOT NULL DEFAULT 'a, b',
          state TEXT NOT NULL CHECK (state IN ('open', 'shut'))
        ) WITHOUT ROWID;
        CREATE INDEX zeta_state ON zeta (state, id) WHERE state <> 'shut';
        CREATE VIRTUAL TABLE docs USING fts5(name, body, tokenize='porter unicode61');
        CREATE TABLE alpha ( a INTEGER );
      `);
      expect(snapshotSqliteSchema(db).split("\n").slice(3).join("\n")).toBe(
        [
          "CREATE TABLE alpha (",
          "  a INTEGER",
          ");",
          "",
          "CREATE VIRTUAL TABLE docs USING fts5(name, body, tokenize='porter unicode61');",
          "",
          "CREATE TABLE zeta (",
          "  id TEXT PRIMARY KEY,",
          "  note TEXT NOT NULL DEFAULT 'a, b',",
          "  state TEXT NOT NULL CHECK (state IN ('open', 'shut'))",
          ") WITHOUT ROWID;",
          "CREATE INDEX zeta_state ON zeta (state, id) WHERE state <> 'shut';",
          "",
        ].join("\n"),
      );
    } finally {
      db.close();
    }
  });
});
