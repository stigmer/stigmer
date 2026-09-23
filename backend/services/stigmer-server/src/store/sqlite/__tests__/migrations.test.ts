/**
 * Pins the schema-continuity contract (D2 §3): a fresh database replays
 * v1–v7; a REAL Go-created v6 database (the DD-002 fixture) adopts to v7
 * with every row preserved — including the three out-of-chain tables Go's
 * consumer stores created lazily; a pending_oauth_state table that
 * predates Go's idempotent ALTERs gains its columns; a legacy pre-v2
 * database gets its prefix-based audit rows migrated. Rollback safety
 * (DD-006): a v7 database re-opened by Go-shaped version checks
 * (< 6) runs nothing. v10, the chain's first row-decoding step, moves
 * every row of the seven kinds that held the retired public level to org
 * and leaves every other row's bytes as they were; a row it cannot decode
 * fails the step and leaves the database at v9. v11 adds the list index's
 * schema only, and a Go-written row of a declared kind is derived by the
 * store's reconciliation at open and read through the index.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import {
  CONTRACT_SESSION_INDEX,
  CONTRACT_STORE_OPTIONS,
} from "../../__tests__/store-contract.js";
import { SqliteStore } from "../store.js";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_10,
  getSchemaVersion,
  runMigrations,
} from "../migrations.js";
import { PUBLIC_ROW_KINDS_AT_RETIREMENT } from "../../public-visibility-retired.js";
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
    expect(rows.map((row) => row.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
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
    // Beside the fixture's rows, one row of the Project kind an earlier
    // release seeded (the kind column holds the enum NAME): v9 must
    // remove exactly it, from both tables, and nothing else.
    const before = new DatabaseSync(fixture.dbPath);
    expect(getSchemaVersion(before)).toBe(6);
    before
      .prepare(
        `INSERT INTO resources (kind, id, data, updated_at) VALUES ('project', 'prj_seeded', X'00', '2026-08-23 11:43:54')`,
      )
      .run();
    before
      .prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, archived_at, version_hash, tag) VALUES ('project', 'prj_seeded', X'00', '2026-08-23 11:43:54', '', '')`,
      )
      .run();
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
      .prepare(
        `SELECT version_hash, tag FROM resource_audit WHERE kind = 'organization'`,
      )
      .get() as { version_hash: string; tag: string };
    expect(audit).toEqual({ version_hash: "hash-v1", tag: "stable" });

    // v9 removed the Project rows and nothing else.
    const projectRows = db
      .prepare(
        `SELECT (SELECT count(*) FROM resources WHERE kind = 'project') AS resources,
                (SELECT count(*) FROM resource_audit WHERE kind = 'project') AS audit,
                (SELECT count(*) FROM resources) AS total`,
      )
      .get() as { resources: number; audit: number; total: number };
    expect(projectRows).toEqual({ resources: 0, audit: 0, total: 1 });

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

  it("derives the list facts of a Go-written row of a declared kind at open", async () => {
    const fixture = materializeGoFixture();
    cleanups.push(() => fixture.cleanup());

    // A session as the Go server wrote it: four columns, no list facts.
    const session = create(SessionSchema, {
      metadata: { id: "ses_go", org: "acme" },
      spec: { agentInstanceId: "ain_go" },
    });
    const before = new DatabaseSync(fixture.dbPath);
    before
      .prepare(
        `INSERT INTO resources VALUES ('session', 'ses_go', ?, '2026-08-23 11:43:54')`,
      )
      .run(toBinary(SessionSchema, session));
    before.close();

    const store = SqliteStore.open(
      fixture.dbPath,
      undefined,
      CONTRACT_STORE_OPTIONS,
    );
    cleanups.push(() => store.close());

    const db = new DatabaseSync(fixture.dbPath);
    cleanups.push(() => db.close());
    const unproven = db
      .prepare(
        `SELECT count(*) AS count FROM resources WHERE list_indexed_at IS NOT updated_at`,
      )
      .get() as { count: number };
    expect(unproven.count, "every adopted row derived or stamped at open").toBe(
      0,
    );
    const rows = await store.queryResources(CONTRACT_SESSION_INDEX, {
      anyKey: [{ name: "agent_instance", value: "ain_go" }],
    });
    expect(rows.map((row) => row.id)).toEqual(["ses_go"]);
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
      CREATE TABLE resource_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, resource_id TEXT NOT NULL, data BLOB NOT NULL, archived_at TEXT NOT NULL DEFAULT (datetime('now')), version_hash TEXT, tag TEXT);
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
      -- Field 1 (api_version) holding one ASCII byte: bytes v10 can decode
      -- as a Skill, since it walks every live row of that kind.
      INSERT INTO resources (kind, id, data) VALUES ('skill', 'skl_1', X'0a0176');
      INSERT INTO resources (kind, id, data) VALUES ('skill', 'skill_audit/skl_1/1706123456789', X'0a0177');
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

describe("v10: the retired public level leaves every row", () => {
  /** A v9 database: the chain replayed up to the step before v10. */
  function v9Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_10 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_10 - 1);
    return { dbPath, db: setup };
  }

  function agentBytes(
    id: string,
    visibility: ApiResourceVisibility,
  ): Uint8Array {
    return toBinary(
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { id, name: id, slug: id, org: "acme", visibility },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
  }

  /** A row of `schema` carrying only the envelope every kind shares, at `visibility`. */
  function envelopeBytes(
    schema: DescMessage,
    id: string,
    visibility: ApiResourceVisibility,
  ): Uint8Array {
    return toBinary(
      schema,
      fromJson(schema, {
        metadata: {
          id,
          name: id,
          slug: id,
          org: "acme",
          visibility: ApiResourceVisibility[visibility],
        },
      }),
    );
  }

  function insert(
    db: DatabaseSync,
    kind: string,
    id: string,
    data: Uint8Array,
  ): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-09-01 00:00:00')`,
    ).run(kind, id, data);
  }

  function row(
    db: DatabaseSync,
    kind: string,
    id: string,
  ): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(
        `SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`,
      )
      .get(kind, id) as { data: Uint8Array; updated_at: string };
  }

  it("moves a public row of every kind in the frozen table to org, and leaves an org row and a private row byte-for-byte", () => {
    const { dbPath, db: setup } = v9Database();
    // One public row per kind the level could live under, each encoded
    // through its own schema.
    for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
      insert(
        setup,
        entry.kind,
        `${entry.kind}_public`,
        envelopeBytes(
          entry.schema,
          `${entry.kind}_public`,
          ApiResourceVisibility.visibility_public,
        ),
      );
    }
    const orgBytes = agentBytes(
      "agt_org",
      ApiResourceVisibility.visibility_org,
    );
    const privateBytes = agentBytes(
      "agt_private",
      ApiResourceVisibility.visibility_private,
    );
    insert(setup, "agent", "agt_org", orgBytes);
    insert(setup, "agent", "agt_private", privateBytes);
    setup.close();

    const store = SqliteStore.open(dbPath);
    cleanups.push(() => store.close());
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
      const moved = row(db, entry.kind, `${entry.kind}_public`);
      expect(moved.data, entry.kind).toEqual(
        envelopeBytes(
          entry.schema,
          `${entry.kind}_public`,
          ApiResourceVisibility.visibility_org,
        ),
      );
      expect(moved.updated_at, `${entry.kind} updated_at bumped`).not.toBe(
        "2026-09-01 00:00:00",
      );
    }
    expect(row(db, "agent", "agt_org")).toEqual({
      data: orgBytes,
      updated_at: "2026-09-01 00:00:00",
    });
    expect(row(db, "agent", "agt_private")).toEqual({
      data: privateBytes,
      updated_at: "2026-09-01 00:00:00",
    });
    const publicLeft = db
      .prepare(`SELECT count(*) AS n FROM resources WHERE kind = 'agent'`)
      .get() as { n: number };
    expect(publicLeft.n).toBe(3);
  });

  it("a row of a kind outside the frozen table is never decoded", () => {
    const { dbPath, db: setup } = v9Database();
    // Bytes no schema decodes, under a kind the level never applied to.
    insert(setup, "session", "ses_opaque", new Uint8Array([0xff, 0xff]));
    setup.close();

    const store = SqliteStore.open(dbPath);
    cleanups.push(() => store.close());
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(row(db, "session", "ses_opaque").data).toEqual(
      new Uint8Array([0xff, 0xff]),
    );
  });

  it("a row of a table kind that does not decode fails the step, names the row, and leaves the database at v9 with every row untouched", () => {
    const { dbPath, db: setup } = v9Database();
    const publicBytes = agentBytes(
      "agt_public",
      ApiResourceVisibility.visibility_public,
    );
    insert(setup, "agent", "agt_public", publicBytes);
    insert(setup, "agent", "agt_broken", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    expect(() => SqliteStore.open(dbPath)).toThrow(
      /migrate to v10: .*agent 'agt_broken' cannot be moved off the retired public level/,
    );

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_10 - 1);
    expect(row(db, "agent", "agt_public").data).toEqual(publicBytes);
  });
});
