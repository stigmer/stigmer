/**
 * Shared helpers for the sqlite driver tests: temp-dir stores, the DD-002
 * Go-database fixture loader, and a small organization factory (the proto
 * type the vertical slice ports, so tests exercise real resource bytes).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { create } from "@bufbuild/protobuf";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { SqliteStore } from "../store.js";

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

/** Minimal valid organization resource for storage round-trips. */
export function makeOrganization(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  labels?: Record<string, string>;
}): Organization {
  const id = overrides?.id ?? "acme";
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: {
      id,
      name: overrides?.name ?? "Acme",
      slug: overrides?.slug ?? id,
      labels: overrides?.labels ?? {},
    },
    spec: { description: overrides?.description ?? "a test organization" },
  });
}
