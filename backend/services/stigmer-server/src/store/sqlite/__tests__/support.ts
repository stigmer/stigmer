/**
 * Shared helpers for the sqlite driver tests: temp-dir stores and the
 * DD-002 Go-database fixture loader. The organization factory moved to
 * ../../__tests__/support.ts with the contract-suite extraction (T01
 * D-4); re-exported here so existing driver tests keep their import path.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SqliteStore } from "../store.js";

export { makeOrganization } from "../../__tests__/support.js";

export interface TempStore {
  store: SqliteStore;
  dbPath: string;
  cleanup(): Promise<void>;
}

/** A fresh store on a throwaway database file. */
export function tempStore(): TempStore {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-store-test-"));
  const dbPath = path.join(dir, "stigmer.db");
  const store = SqliteStore.open(dbPath);
  return {
    store,
    dbPath,
    async cleanup() {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const FIXTURE_PATH = path.join(
  import.meta.dirname,
  "fixtures",
  "go-v6-database.sql",
);

/**
 * Reconstructs the Go-created v6 database from its committed SQL dump into
 * a throwaway file and returns the path. Write-then-reopen is required:
 * the dump instantiates the FTS5 virtual table through writable_schema,
 * which only takes effect on the next connection — the same shape as real
 * adoption, where the driver always opens an existing file fresh.
 */
export function materializeGoFixture(): { dbPath: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-go-fixture-"));
  const dbPath = path.join(dir, "stigmer.db");
  const writer = new DatabaseSync(dbPath);
  writer.exec(readFileSync(FIXTURE_PATH, "utf8"));
  writer.close();
  return {
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
