/**
 * Pins the schema-continuity contract (D2 §3): a fresh database replays
 * v1–v7; a REAL Go-created v6 database (the DD-002 fixture) adopts to v7
 * with every row preserved — including the three out-of-chain tables Go's
 * consumer stores created lazily; a pending_oauth_state table that
 * predates Go's idempotent ALTERs gains its columns; a legacy pre-v2
 * database gets its prefix-based audit rows migrated. Rollback safety
 * (DD-006): a v7 database re-opened by Go-shaped version checks
 * (< 6) runs nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteStore } from "../store.js";
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from "../migrations.js";
import { materializeGoFixture } from "./support.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

function tempDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-migrations-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "stigmer.db");
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("fresh database", () => {
  it("replays the full chain to the current version with every table present", async () => {
    const dbPath = tempDbPath();
    const store = SqliteStore.open(dbPath);
    cleanups.push(() => store.close());

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const tables = tableNames(db);
    for (const expected of [
      "resources",
      "resource_audit",
      "search_index",
      "bootstrap_state",
      "workflow_execution_events",
      "schedule_runs",
      "signal_dedupe",
      "oauth_grant",
      "pending_oauth_state",
    ]) {
      expect(tables, `table ${expected} should exist`).toContain(expected);
    }
  });

  it("records one schema_version row per migration (MAX semantics, as Go computes it)", () => {
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db);

    const rows = db
      .prepare(`SELECT version FROM schema_version ORDER BY version`)
      .all() as Array<{ version: number }>;
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("re-opening an already-migrated database is a no-op", async () => {
    const dbPath = tempDbPath();
    const first = SqliteStore.open(dbPath);
    await first.close();
    const second = SqliteStore.open(dbPath);
    cleanups.push(() => second.close());

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    const count = db
      .prepare(`SELECT COUNT(*) AS count FROM schema_version`)
      .get() as { count: number };
    expect(count.count).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("Go-created v6 database adoption (DD-002 fixture)", () => {
  it("migrates 6 → current preserving every row, including the out-of-chain tables", async () => {
    const fixture = materializeGoFixture();
    cleanups.push(() => fixture.cleanup());

    // Preconditions: the fixture really is a v6 database with live data.
    const before = new DatabaseSync(fixture.dbPath);
    expect(getSchemaVersion(before)).toBe(6);
    before.close();

    const store = SqliteStore.open(fixture.dbPath);
    cleanups.push(() => store.close());

    const db = new DatabaseSync(fixture.dbPath);
    cleanups.push(() => db.close());

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

    // Every Go-written row survives adoption untouched.
    const org = db
      .prepare(`SELECT id FROM resources WHERE kind = 'organization'`)
      .get() as { id: string };
    expect(org.id).toBe("acme");

    const audit = db
      .prepare(`SELECT version_hash, tag FROM resource_audit`)
      .get() as { version_hash: string; tag: string };
    expect(audit).toEqual({ version_hash: "hash-v1", tag: "stable" });

    const bootstrap = db
      .prepare(
        `SELECT value FROM bootstrap_state WHERE key = 'seedpack_version'`,
      )
      .get() as { value: string };
    expect(bootstrap.value).toBe("1.1.0");

    const events = db
      .prepare(
        `SELECT COUNT(*) AS count FROM workflow_execution_events WHERE execution_id = 'wfe_fixture'`,
      )
      .get() as { count: number };
    expect(events.count).toBe(2);

    const run = db
      .prepare(`SELECT outcome, completed_at FROM schedule_runs`)
      .get() as { outcome: string; completed_at: string };
    expect(run.outcome).toBe("completed");
    expect(run.completed_at).toBe("2026-08-20T00:00:05Z");

    // The consolidated tables: Go-written rows adopted, not shadowed.
    const dedupe = db
      .prepare(`SELECT status FROM signal_dedupe WHERE id = 'acme:fixture-key'`)
      .get() as { status: string };
    expect(dedupe.status).toBe("DELIVERED");

    const grant = db
      .prepare(
        `SELECT client_id FROM oauth_grant WHERE identity_account_id = 'ida_fixture'`,
      )
      .get() as { client_id: string };
    expect(grant.client_id).toBe("client-1");

    const pending = db
      .prepare(
        `SELECT code_verifier, org FROM pending_oauth_state WHERE state = 'state-fixture'`,
      )
      .get() as { code_verifier: string; org: string };
    expect(pending.code_verifier).toBe("enc:v1:sealed");
    expect(pending.org).toBe("acme");

    // The Go-written FTS5 index stays queryable through the TS driver's
    // connection — SP-C on real Go-built index data.
    const hits = db
      .prepare(
        `SELECT resource_id FROM search_index WHERE search_index MATCH 'fixture'`,
      )
      .all() as Array<{ resource_id: string }>;
    expect(hits).toEqual([{ resource_id: "acme" }]);
  });

  it("reads a Go-marshaled resource blob through the TS driver (wire-format continuity)", async () => {
    const fixture = materializeGoFixture();
    cleanups.push(() => fixture.cleanup());

    const store = SqliteStore.open(fixture.dbPath);
    cleanups.push(() => store.close());

    const { OrganizationSchema } =
      await import("@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb");
    const { ApiResourceKind } =
      await import("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb");
    const org = await store.getResource(
      ApiResourceKind.organization,
      "acme",
      OrganizationSchema,
    );
    expect(org.metadata?.slug).toBe("acme");
    expect(org.spec?.description).toBe("fixture org");
  });
});

describe("v7 column reconciliation", () => {
  it("adds org/token_auth_method to a pending_oauth_state table that predates Go's ALTERs", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);

    // A v6 database whose pending_oauth_state was created by an OLD Go
    // build — before pending_state_store.go gained the idempotent ALTERs
    // for `org` and `token_auth_method`. v7 must reconcile the columns
    // without touching the row.
    setup.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (1),(2),(3),(4),(5),(6);
      CREATE TABLE resources (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kind, id)) WITHOUT ROWID;
      CREATE TABLE pending_oauth_state (
        state               TEXT PRIMARY KEY,
        code_verifier       TEXT NOT NULL,
        client_id           TEXT NOT NULL DEFAULT '',
        client_secret       TEXT NOT NULL DEFAULT '',
        token_endpoint      TEXT NOT NULL DEFAULT '',
        mcp_server_id       TEXT NOT NULL,
        identity_account_id TEXT NOT NULL,
        target_env_var      TEXT NOT NULL DEFAULT '',
        auth_method         TEXT NOT NULL DEFAULT '',
        redirect_uri        TEXT NOT NULL DEFAULT '',
        created_at          INTEGER NOT NULL
      );
      INSERT INTO pending_oauth_state (state, code_verifier, mcp_server_id, identity_account_id, created_at)
        VALUES ('old-state', 'verifier', 'mcp_1', 'ida_1', 1700000000);
    `);
    setup.close();

    const migrating = new DatabaseSync(dbPath);
    runMigrations(migrating);
    migrating.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    const row = db
      .prepare(
        `SELECT state, org, token_auth_method FROM pending_oauth_state WHERE state = 'old-state'`,
      )
      .get() as { state: string; org: string; token_auth_method: string };
    expect(row).toEqual({ state: "old-state", org: "", token_auth_method: "" });
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("legacy pre-v2 database", () => {
  it("moves prefix-based audit rows out of resources into resource_audit (Go migrateAuditRecords)", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);

    // A v1-era database: audit snapshots lived in `resources` under
    // "<type>_audit/<resource_id>/<timestamp>" ids.
    setup.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (1);
      CREATE TABLE resources (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kind, id)) WITHOUT ROWID;
      INSERT INTO resources (kind, id, data) VALUES ('skill', 'skl_1', X'0a01aa');
      INSERT INTO resources (kind, id, data) VALUES ('skill', 'skill_audit/skl_1/1706123456789', X'0a01bb');
    `);
    setup.close();

    const migrating = new DatabaseSync(dbPath);
    runMigrations(migrating);
    migrating.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());

    const liveIds = (
      db.prepare(`SELECT id FROM resources ORDER BY id`).all() as Array<{
        id: string;
      }>
    ).map((row) => row.id);
    expect(liveIds, "the legacy audit row leaves resources").toEqual(["skl_1"]);

    const audit = db
      .prepare(`SELECT resource_id, version_hash, tag FROM resource_audit`)
      .get() as { resource_id: string; version_hash: string; tag: string };
    expect(audit.resource_id).toBe("skl_1");
    // Hash/tag stay empty for migrated rows (unknowable without the type).
    expect(audit.version_hash).toBe("");
    expect(audit.tag).toBe("");
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("rollback safety (DD-006)", () => {
  it("a v7 database passes Go-shaped 'currentVersion < 6' checks untouched", () => {
    const dbPath = tempDbPath();
    const migrating = new DatabaseSync(dbPath);
    runMigrations(migrating);
    migrating.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    // Go's runMigrations gates every step on currentVersion < N with
    // N <= 6; at 7 nothing runs. The MAX query is exactly Go's read.
    const version = db
      .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .get() as { v: number };
    expect(version.v).toBeGreaterThanOrEqual(6);
  });
});
