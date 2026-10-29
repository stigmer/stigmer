/**
 * Holds each store chain to its committed `migrations.sum`
 * (../schema-checksum.ts): the file is the chain's digests, line for line,
 * so a step and its line change together. A step's digest covers its
 * statements in order and nothing else, and a chain's versions run 1, 2,
 * 3, … with no gap or repeat.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { POSTGRES_MIGRATIONS } from "../postgres/migrations.js";
import {
  assertChainShape,
  migrationChecksum,
  renderMigrationSum,
} from "../schema-checksum.js";
import { SQLITE_MIGRATIONS } from "../sqlite/migrations.js";

const STORE = path.resolve(import.meta.dirname, "..");

describe("migrations.sum", () => {
  it("is the Postgres chain's digests", () => {
    expect(
      readFileSync(path.join(STORE, "postgres", "migrations.sum"), "utf8"),
    ).toBe(renderMigrationSum(POSTGRES_MIGRATIONS));
  });

  it("is the SQLite chain's digests", () => {
    expect(
      readFileSync(path.join(STORE, "sqlite", "migrations.sum"), "utf8"),
    ).toBe(renderMigrationSum(SQLITE_MIGRATIONS));
  });
});

describe("migrationChecksum", () => {
  it("covers the statements and their order", () => {
    expect(migrationChecksum(["CREATE TABLE a (x INT)"])).toBe(
      migrationChecksum(["CREATE TABLE a (x INT)"]),
    );
    expect(migrationChecksum(["CREATE TABLE a (x INT)"])).not.toBe(
      migrationChecksum(["CREATE TABLE a (y INT)"]),
    );
    expect(migrationChecksum(["A", "B"])).not.toBe(
      migrationChecksum(["B", "A"]),
    );
    expect(migrationChecksum(["AB"])).not.toBe(migrationChecksum(["A", "B"]));
    expect(migrationChecksum([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("assertChainShape", () => {
  it("refuses a gap, a repeat or a chain that does not start at 1", () => {
    const step = (version: number) => ({ version, statements: [] });
    expect(() => assertChainShape([step(1), step(2), step(3)])).not.toThrow();
    expect(() => assertChainShape([step(1), step(3)])).toThrow(
      "step 2 has version 3",
    );
    expect(() => assertChainShape([step(1), step(1)])).toThrow(
      "step 2 has version 1",
    );
    expect(() => assertChainShape([step(2)])).toThrow("step 1 has version 2");
  });
});
