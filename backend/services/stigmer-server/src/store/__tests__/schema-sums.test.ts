/**
 * Holds each store chain to its committed `migrations.sum`
 * (../schema-checksum.ts): the file is the chain's digests, line for line,
 * so a step and its line change together. A step's digest covers its
 * statements in order and nothing else, and a chain's versions run 1, 2,
 * 3, … with no gap or repeat. Against the base branch's file, a branch may
 * add lines and may not change, reorder or remove one, nor delete the file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { POSTGRES_MIGRATIONS } from "../postgres/migrations.js";
import {
  assertChainShape,
  compareSums,
  migrationChecksum,
  renderMigrationSum,
  sumLines,
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

describe("compareSums", () => {
  const ONE = "1 aaaa";
  const TWO = "2 bbbb";

  it("reads only step lines", () => {
    expect(sumLines(`# header\n\n${ONE}\n${TWO}\n`)).toEqual([ONE, TWO]);
  });

  it("passes a branch that adds a step after the base's, whatever its header says", () => {
    expect(
      compareSums("x/migrations.sum", `# a\n${ONE}\n`, `# b\n${ONE}\n${TWO}\n`),
    ).toEqual([]);
  });

  it("refuses a changed, reordered or removed merged line, naming it", () => {
    expect(
      compareSums("x/migrations.sum", `${ONE}\n${TWO}\n`, `${ONE}\n2 cccc\n`),
    ).toEqual([
      'x/migrations.sum: the merged line "2 bbbb" now reads "2 cccc"; a merged step never changes, so add a new step instead',
    ]);
    expect(
      compareSums("x/migrations.sum", `${ONE}\n${TWO}\n`, `${TWO}\n${ONE}\n`),
    ).toHaveLength(2);
    expect(
      compareSums("x/migrations.sum", `${ONE}\n${TWO}\n`, `${ONE}\n`),
    ).toEqual(['x/migrations.sum: the merged line "2 bbbb" was removed']);
  });

  it("refuses a deleted sum file", () => {
    expect(compareSums("x/migrations.sum", `${ONE}\n`, undefined)).toEqual([
      "x/migrations.sum: removed, but its steps have merged; a merged step never goes",
    ]);
  });
});
