/**
 * Pins the schema-continuity contract: a fresh database replays
 * v1–v7; a REAL Go-created v6 database (the Go fixture) adopts to v7
 * with every row preserved — including the three out-of-chain tables Go's
 * consumer stores created lazily; a pending_oauth_state table that
 * predates Go's idempotent ALTERs gains its columns; a legacy pre-v2
 * database gets its prefix-based audit rows migrated. Rollback safety: a
 * v7 database re-opened by Go-shaped version checks (< 6) runs nothing.
 * v10, the chain's first row-decoding step, moves
 * every row of the seven kinds that held the retired public level to org
 * and leaves every other row's bytes as they were; a row it cannot decode
 * fails the step and leaves the database at v9. v11 adds the list index's
 * schema only, and a Go-written row of a declared kind is derived by the
 * store's reconciliation at open and read through the index. v12 creates
 * the organization-slug ledger and fills it: every live organization
 * unretired, every organization a surviving scoped row names with none live
 * retired, across keyset pages; a scoped row it cannot decode fails the
 * step and leaves the database at v11 with no ledger. v14 removes the agent
 * instance kind: every session that ran against an instance names the
 * instance's agent and pins its current version (or keeps a deleted
 * agent's id, or continues with the built-in assistant when the instance is
 * gone, or names no agent), across keyset pages, and the instance rows
 * leave every table; the store opened on the migrated database finds each
 * moved session through the session list index's `agent` key, the one
 * listByAgent reads; every IamPolicy row naming an instance as resource
 * or principal leaves with its list keys (its history kept) while a grant
 * on another kind stays; a session, instance, agent or policy row it
 * cannot decode fails the step, naming the row, and leaves the database at
 * v13.
 * A schema written by a newer release is refused before any migration or
 * list-index reconciliation, with the failed store's connection closed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ApprovalMode,
  InteractionMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import {
  CONTRACT_SESSION_INDEX,
  CONTRACT_STORE_OPTIONS,
} from "../../__tests__/store-contract.js";
import { sessionListIndex } from "../../../domain/session/list-index.js";
import { SqliteStore } from "../store.js";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_10,
  SCHEMA_VERSION_12,
  SCHEMA_VERSION_13,
  SCHEMA_VERSION_14,
  SCHEMA_VERSION_15,
  getSchemaVersion,
  runMigrations,
} from "../migrations.js";
import { RETIREMENT_PAGE_SIZE } from "../../agent-instance-retired.js";
import {
  policyRow,
  retiredInstanceRow,
  retiredSessionRow,
  sessionBytes,
} from "../../__tests__/retired-instance-rows.js";
import {
  executionBytes,
  retiredExecutionRow,
} from "../../__tests__/retired-execution-rows.js";
import { EXECUTION_CONFIG_PAGE_SIZE } from "../../execution-config-retired.js";
import { HISTORY_PAGE_SIZE } from "../../organization-slug-history.js";
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

describe("newer database schema", () => {
  it.each([CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1])(
    "rejects a newer schema without changing schema or data, even with target %i",
    (targetVersion) => {
      const db = new DatabaseSync(tempDbPath());
      cleanups.push(() => db.close());
      runMigrations(db);
      const newerVersion = CURRENT_SCHEMA_VERSION + 1;
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(
        newerVersion,
      );
      db.prepare(`INSERT INTO bootstrap_state (key, value) VALUES (?, ?)`).run(
        "preserved",
        "before-reopen",
      );
      const schema = db
        .prepare(`SELECT * FROM sqlite_master ORDER BY name`)
        .all();
      const versions = db
        .prepare(`SELECT * FROM schema_version ORDER BY version`)
        .all();
      const state = db.prepare(`SELECT * FROM bootstrap_state`).all();

      expect(() => runMigrations(db, targetVersion)).toThrow(
        `Database schema version ${newerVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION}). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
      );

      expect(
        db.prepare(`SELECT * FROM sqlite_master ORDER BY name`).all(),
      ).toEqual(schema);
      expect(
        db.prepare(`SELECT * FROM schema_version ORDER BY version`).all(),
      ).toEqual(versions);
      expect(db.prepare(`SELECT * FROM bootstrap_state`).all()).toEqual(state);
      expect(db.isTransaction).toBe(false);
    },
  );

  it("rejects a newer schema before reconciliation and closes the failed store", async () => {
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    runMigrations(db);
    const newerVersion = CURRENT_SCHEMA_VERSION + 1;
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(
      newerVersion,
    );
    const session = create(SessionSchema, {
      metadata: { id: "ses_preserved", org: "acme" },
      status: { agentId: "agt_preserved" },
    });
    db.prepare(
      `INSERT INTO resources (kind, id, data) VALUES ('session', 'ses_preserved', ?)`,
    ).run(toBinary(SessionSchema, session));
    const row = db
      .prepare(`SELECT * FROM resources WHERE id = 'ses_preserved'`)
      .get();
    db.close();

    const close = vi.spyOn(DatabaseSync.prototype, "close");
    let opened: SqliteStore | undefined;
    try {
      expect(() => {
        opened = SqliteStore.open(dbPath, undefined, CONTRACT_STORE_OPTIONS);
      }).toThrow(
        `Database schema version ${newerVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION})`,
      );
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
      await opened?.close();
    }

    const reopened = new DatabaseSync(dbPath);
    cleanups.push(() => reopened.close());
    expect(
      reopened
        .prepare(`SELECT * FROM resources WHERE id = 'ses_preserved'`)
        .get(),
    ).toEqual(row);
    expect(getSchemaVersion(reopened)).toBe(newerVersion);
  });

  it("keeps a supported schema newer than a fixture target unchanged", () => {
    const db = new DatabaseSync(tempDbPath());
    cleanups.push(() => db.close());
    runMigrations(db);

    expect(() => runMigrations(db, 1)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });
});

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
      "resource_names",
    ]) {
      expect(tables, `table ${expected} should exist`).toContain(expected);
    }
    expect(tables, "v13 replaced the slug ledger").not.toContain(
      "organization_slugs",
    );
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
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

describe("Go-created v6 database adoption (the Go fixture)", () => {
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
    // connection — the FTS5 probe on real Go-built index data.
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
      status: { agentId: "agt_go" },
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
      anyKey: [{ name: "agent", value: "agt_go" }],
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

describe("rollback safety", () => {
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

    // The chain stops at v10: v14 removes the retired agent instance rows
    // this step moves.
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_10);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_10);
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
    const { db } = v9Database();
    cleanups.push(() => db.close());
    // Bytes no schema decodes, under a kind the level never applied to.
    // The chain stops at v10: v12 reads every organization-scoped row, so
    // a later step would refuse these bytes for its own reason.
    insert(db, "session", "ses_opaque", new Uint8Array([0xff, 0xff]));

    runMigrations(db, SCHEMA_VERSION_10);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_10);
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

describe("v12: the organization-slug ledger records every slug taken before it", () => {
  /** A v11 database: the chain replayed up to the step before v12. */
  function v11Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_12 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_12 - 1);
    return { dbPath, db: setup };
  }

  function agentNaming(id: string, org: string): Uint8Array {
    return toBinary(
      AgentSchema,
      create(AgentSchema, {
        metadata: { id, name: id, slug: id, org },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
  }

  function sessionNaming(id: string, org: string): Uint8Array {
    return toBinary(
      SessionSchema,
      create(SessionSchema, { metadata: { id, name: id, slug: id, org } }),
    );
  }

  function insert(
    db: DatabaseSync,
    kind: string,
    id: string,
    data: Uint8Array,
  ): void {
    db.prepare(`INSERT INTO resources (kind, id, data) VALUES (?, ?, ?)`).run(
      kind,
      id,
      data,
    );
  }

  function ledger(db: DatabaseSync): Array<{ slug: string; retired: number }> {
    return db
      .prepare(
        `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs ORDER BY slug`,
      )
      .all() as Array<{ slug: string; retired: number }>;
  }

  it("records every live organization unretired and every organization a surviving row names with none live retired", () => {
    const { dbPath, db: setup } = v11Database();
    insert(setup, "organization", "acme", new Uint8Array([0x00]));
    insert(setup, "agent", "agt_live", agentNaming("agt_live", "acme"));
    insert(setup, "agent", "agt_gone", agentNaming("agt_gone", "deleted-one"));
    insert(
      setup,
      "session",
      "ses_gone",
      sessionNaming("ses_gone", "deleted-two"),
    );
    insert(setup, "agent", "agt_orphan", agentNaming("agt_orphan", ""));
    // A kind outside the table is never decoded, whatever it holds.
    insert(
      setup,
      "identity_account",
      "ida_opaque",
      new Uint8Array([0xff, 0xff]),
    );
    setup.close();

    // To v12 alone: v13 replaces the ledger this step makes.
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_12);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_12);
    expect(ledger(db)).toEqual([
      { slug: "acme", retired: 0 },
      { slug: "deleted-one", retired: 1 },
      { slug: "deleted-two", retired: 1 },
    ]);
  });

  it("reads a kind across keyset pages, missing no row past the first page", () => {
    const { dbPath, db: setup } = v11Database();
    const rows = HISTORY_PAGE_SIZE + 2;
    // One transaction for the seed: row by row, each insert is its own
    // synced commit, and 502 of them outran the test's limit on a busy runner
    // (stigmer/stigmer#1569).
    setup.exec("BEGIN");
    for (let i = 0; i < rows; i++) {
      const id = `agt_${String(i).padStart(4, "0")}`;
      // The last row, past the first page, is the only one naming its
      // organization.
      insert(
        setup,
        "agent",
        id,
        agentNaming(id, i === rows - 1 ? "past-the-page" : "on-the-page"),
      );
    }
    setup.exec("COMMIT");
    setup.close();

    // To v12 alone: v13 replaces the ledger this step makes.
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_12);
    expect(ledger(db)).toEqual([
      { slug: "on-the-page", retired: 1 },
      { slug: "past-the-page", retired: 1 },
    ]);
  });

  it("a scoped row that does not decode fails the step, names the row, and leaves the database at v11 with no ledger", () => {
    const { dbPath, db: setup } = v11Database();
    insert(setup, "agent", "agt_broken", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    expect(() => SqliteStore.open(dbPath)).toThrow(
      /migrate to v12: .*agent 'agt_broken' cannot be read for the organization it names/,
    );

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_12 - 1);
    expect(tableNames(db)).not.toContain("organization_slugs");
  });
});

describe("v13: the resource-name table replaces the organization-slug ledger", () => {
  it("records every live organization's slug as its current name, keeps every other ledger slug reserved, and drops the ledger", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_13 - 1);
    // Before minted ids an organization's id was its slug.
    setup
      .prepare(`INSERT INTO resources (kind, id, data) VALUES (?, ?, ?)`)
      .run("organization", "acme", new Uint8Array([0x00]));
    setup
      .prepare(
        `INSERT INTO organization_slugs (slug, claimed_at, retired_at) VALUES (?, ?, ?)`,
      )
      .run("deleted-one", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    setup
      .prepare(`INSERT INTO organization_slugs (slug, claimed_at) VALUES (?, ?)`)
      .run("acme", "2026-01-01T00:00:00.000Z");
    setup.close();

    const store = SqliteStore.open(dbPath);
    cleanups.push(() => store.close());
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(tableNames(db)).not.toContain("organization_slugs");
    expect(
      db
        .prepare(
          `SELECT kind, org, name, id, state, expires_at FROM resource_names ORDER BY name`,
        )
        .all(),
    ).toEqual([
      {
        kind: "organization",
        org: "",
        name: "acme",
        id: "acme",
        state: "current",
        expires_at: "",
      },
      {
        kind: "organization",
        org: "",
        name: "deleted-one",
        id: "deleted-one",
        state: "previous",
        expires_at: "",
      },
    ]);
  });
});

describe("v14: sessions name their agent and the agent instance rows leave", () => {
  const ORG = "org_01jz0000000000000000000000";
  const HEAD = "e".repeat(64);
  const SPEC = { subject: "Release notes" };

  /** A v13 database: the chain replayed up to the step before v14. */
  function v13Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_14 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_14 - 1);
    return { dbPath, db: setup };
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

  function data(db: DatabaseSync, kind: string, id: string): Uint8Array {
    return (
      db
        .prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`)
        .get(kind, id) as { data: Uint8Array }
    ).data;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`)
        .get(kind) as { n: number }
    ).n;
  }

  function seedInstances(db: DatabaseSync): void {
    insert(
      db,
      "agent",
      "agt_1",
      toBinary(
        AgentSchema,
        create(AgentSchema, {
          metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
          status: { versionHash: HEAD },
        }),
      ),
    );
    insert(
      db,
      "agent_instance",
      "ain_1",
      retiredInstanceRow({
        metadata: { id: "ain_1", org: ORG, slug: "reviewer-default" },
        agentId: "agt_1",
      }),
    );
    insert(
      db,
      "agent_instance",
      "ain_orphan",
      retiredInstanceRow({
        metadata: { id: "ain_orphan", org: ORG, slug: "gone-default" },
        agentId: "agt_gone",
      }),
    );
  }

  it("moves every session onto its instance's agent and removes the instance rows from every table", async () => {
    const { dbPath, db: setup } = v13Database();
    seedInstances(setup);
    const metadata = (id: string) => ({ id, org: ORG, slug: id });
    insert(
      setup,
      "session",
      "ses_live",
      retiredSessionRow({ metadata: metadata("ses_live"), instanceId: "ain_1", spec: SPEC }),
    );
    insert(
      setup,
      "session",
      "ses_agent_gone",
      retiredSessionRow({
        metadata: metadata("ses_agent_gone"),
        instanceId: "ain_orphan",
        spec: SPEC,
      }),
    );
    insert(
      setup,
      "session",
      "ses_instance_gone",
      retiredSessionRow({
        metadata: metadata("ses_instance_gone"),
        instanceId: "ain_deleted",
        spec: SPEC,
      }),
    );
    const assistant = retiredSessionRow({
      metadata: metadata("ses_assistant"),
      instanceId: "",
      spec: SPEC,
    });
    insert(setup, "session", "ses_assistant", assistant);
    setup
      .prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_instance', 'ain_1', ?, '', '')`,
      )
      .run(new Uint8Array([0x00]));
    setup
      .prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('agent_instance', 'ain_1', 'agent', 'agt_1', '')`,
      )
      .run();
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_14);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_14);

    expect(data(db, "session", "ses_live")).toEqual(
      sessionBytes({
        metadata: metadata("ses_live"),
        spec: {
          ...SPEC,
          agentRef: { kind: 40, org: ORG, slug: "reviewer" },
        },
        status: { agentId: "agt_1", agentVersionHash: HEAD },
      }),
    );
    expect(data(db, "session", "ses_agent_gone")).toEqual(
      sessionBytes({
        metadata: metadata("ses_agent_gone"),
        spec: SPEC,
        status: { agentId: "agt_gone" },
      }),
    );
    expect(data(db, "session", "ses_instance_gone")).toEqual(
      sessionBytes({ metadata: metadata("ses_instance_gone"), spec: SPEC }),
    );
    expect(data(db, "session", "ses_assistant")).toEqual(assistant);
    expect(
      (
        db
          .prepare(
            `SELECT updated_at FROM resources WHERE kind = 'session' AND id = 'ses_assistant'`,
          )
          .get() as { updated_at: string }
      ).updated_at,
    ).toBe("2026-09-01 00:00:00");

    for (const table of ["resources", "resource_audit", "resource_list_keys"]) {
      expect(count(db, table, "agent_instance")).toBe(0);
    }
    expect(count(db, "resources", "agent")).toBe(1);

    // The store the server opens on the migrated database lists each moved
    // session under its agent, through the key listByAgent reads.
    const store = SqliteStore.open(dbPath, undefined, {
      listIndexes: [sessionListIndex],
    });
    cleanups.push(() => store.close());
    const byAgent = async (agentId: string): Promise<string[]> =>
      (
        await store.queryResources(sessionListIndex, {
          anyKey: [{ name: "agent", value: agentId }],
        })
      ).map((row) => row.id);
    expect(await byAgent("agt_1")).toEqual(["ses_live"]);
    expect(await byAgent("agt_gone")).toEqual(["ses_agent_gone"]);
  });

  it("removes every grant naming an instance and keeps a grant on another kind", () => {
    const { dbPath, db: setup } = v13Database();
    seedInstances(setup);
    const onAgent = {
      id: "iam_on_agent",
      principal: "identity_account:ida_1",
      relation: "viewer",
      resource: "agent:agt_1",
    };
    for (const policy of [
      {
        id: "iam_on_instance",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "agent_instance:ain_1",
      },
      {
        id: "iam_from_instance",
        principal: "agent_instance:ain_1",
        relation: "agent_instance",
        resource: "session:ses_1",
      },
      onAgent,
    ]) {
      insert(setup, "iam_policy", policy.id, policyRow(policy));
      setup
        .prepare(
          `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
        )
        .run(policy.id, policy.principal.split(":")[1] ?? "");
    }
    setup
      .prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_instance', ?, '', '')`,
      )
      .run(new Uint8Array([0x00]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_14);

    const ids = (table: string) =>
      (
        db
          .prepare(`SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`)
          .all() as Array<{ id: string }>
      ).map((row) => row.id);
    expect(ids("resources")).toEqual(["iam_on_agent"]);
    expect(ids("resource_list_keys")).toEqual(["iam_on_agent"]);
    expect(data(db, "iam_policy", "iam_on_agent")).toEqual(policyRow(onAgent));
    expect(count(db, "resource_audit", "iam_policy")).toBe(1);
  });

  it("reads sessions across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = v13Database();
    seedInstances(setup);
    const total = RETIREMENT_PAGE_SIZE + 3;
    for (let i = 0; i < total; i++) {
      const id = `ses_${String(i).padStart(4, "0")}`;
      insert(
        setup,
        "session",
        id,
        retiredSessionRow({
          metadata: { id, org: ORG, slug: id },
          instanceId: "ain_1",
        }),
      );
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_14);

    const rows = db
      .prepare(`SELECT data FROM resources WHERE kind = 'session'`)
      .all() as Array<{ data: Uint8Array }>;
    expect(rows).toHaveLength(total);
    for (const row of rows) {
      expect(fromBinary(SessionSchema, row.data).status?.agentId).toBe("agt_1");
    }
  });

  it("a session that does not decode fails the step, names the row, and leaves the database at v13", () => {
    const { dbPath, db: setup } = v13Database();
    seedInstances(setup);
    insert(setup, "session", "ses_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_14)).toThrow(
      "session 'ses_broken' cannot be read to retire the agent instance kind",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_14 - 1);
    expect(count(db, "resources", "agent_instance")).toBe(2);
  });

  it("continues a session on an instance that names no agent with the built-in assistant", () => {
    const BLANK_SESSION = { id: "ses_blank", org: ORG, slug: "ses_blank" };
    const { dbPath, db: setup } = v13Database();
    insert(
      setup,
      "agent_instance",
      "ain_blank",
      retiredInstanceRow({
        metadata: { id: "ain_blank", org: ORG, slug: "blank-default" },
        agentId: "",
      }),
    );
    insert(
      setup,
      "session",
      "ses_blank",
      retiredSessionRow({
        metadata: BLANK_SESSION,
        instanceId: "ain_blank",
        spec: SPEC,
      }),
    );
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_14);

    expect(data(db, "session", "ses_blank")).toEqual(
      sessionBytes({ metadata: BLANK_SESSION, spec: SPEC }),
    );
    expect(count(db, "resources", "agent_instance")).toBe(0);
  });

  it.each([
    { kind: "agent_instance", id: "ain_broken" },
    // ain_orphan names agt_gone: the step reads it as the agent.
    { kind: "agent", id: "agt_gone" },
    { kind: "iam_policy", id: "iam_broken" },
  ])(
    "a $kind row that does not decode fails the step, names the row, and leaves the database at v13",
    (broken) => {
      const { dbPath, db: setup } = v13Database();
      seedInstances(setup);
      insert(setup, broken.kind, broken.id, new Uint8Array([0x22, 0xff]));
      setup.close();

      const db = new DatabaseSync(dbPath);
      cleanups.push(() => db.close());
      expect(() => runMigrations(db, SCHEMA_VERSION_14)).toThrow(
        `${broken.kind} '${broken.id}' cannot be read to retire the agent instance kind`,
      );
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_14 - 1);
      expect(count(db, "resources", "agent_instance")).toBe(
        broken.kind === "agent_instance" ? 3 : 2,
      );
    },
  );

  it("replays the frozen steps over instance rows from v9 exactly as they shipped, then removes them", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_10 - 1);
    insert(
      setup,
      "agent_instance",
      "ain_public",
      retiredInstanceRow({
        metadata: {
          id: "ain_public",
          org: "deleted-org",
          slug: "bot-shared",
          visibility: ApiResourceVisibility.visibility_public,
        },
        agentId: "agt_1",
      }),
    );
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_12);
    // v10 moved the retired row to org without disturbing another byte…
    expect(data(db, "agent_instance", "ain_public")).toEqual(
      retiredInstanceRow({
        metadata: {
          id: "ain_public",
          org: "deleted-org",
          slug: "bot-shared",
          visibility: ApiResourceVisibility.visibility_org,
        },
        agentId: "agt_1",
      }),
    );
    // …and v12 recorded the organization it names, with none live, retired.
    expect(
      db
        .prepare(
          `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs`,
        )
        .all(),
    ).toEqual([{ slug: "deleted-org", retired: 1 }]);

    runMigrations(db, SCHEMA_VERSION_14);
    expect(count(db, "resources", "agent_instance")).toBe(0);
  });
});

describe("v15: a turn's settings leave the retired execution_config", () => {
  const metadata = (id: string) => ({ id, org: "org_1", slug: id });

  function v14Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_15 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_15 - 1);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent_execution', ?, ?, '2026-09-01 00:00:00')`,
    ).run(id, data);
  }

  function row(db: DatabaseSync, id: string): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = 'agent_execution' AND id = ?`)
      .get(id) as { data: Uint8Array; updated_at: string };
  }

  it("rewrites every turn into the current shape and leaves its stamp alone", () => {
    const { dbPath, db: setup } = v14Database();
    insert(
      setup,
      "aex_plan",
      retiredExecutionRow({
        metadata: metadata("aex_plan"),
        config: {
          modelName: "claude-sonnet-5",
          maxCostUsd: 2,
          interactionMode: InteractionMode.PLAN,
          approvalMode: ApprovalMode.UNATTENDED,
        },
      }),
    );
    insert(setup, "aex_bare", retiredExecutionRow({ metadata: metadata("aex_bare") }));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_15);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_15);

    const plan = row(db, "aex_plan");
    expect(plan.data).toEqual(
      executionBytes({
        metadata: metadata("aex_plan"),
        spec: {
          message: "hello",
          runConfig: { modelName: "claude-sonnet-5", maxCostUsd: 2 },
          interactionMode: InteractionMode.PLAN,
        },
        status: {
          runConfig: { modelName: "claude-sonnet-5", maxCostUsd: 2 },
          approvalMode: ApprovalMode.UNATTENDED,
        },
      }),
    );
    expect(plan.updated_at).toBe("2026-09-01 00:00:00");
    expect(row(db, "aex_bare").data).toEqual(
      executionBytes({
        metadata: metadata("aex_bare"),
        spec: { message: "hello" },
        status: { runConfig: {}, approvalMode: ApprovalMode.INTERACTIVE },
      }),
    );
  });

  it("reads every page of turns", () => {
    const { dbPath, db: setup } = v14Database();
    for (let i = 0; i <= EXECUTION_CONFIG_PAGE_SIZE; i++) {
      const id = `aex_${String(i).padStart(4, "0")}`;
      insert(setup, id, retiredExecutionRow({ metadata: metadata(id), config: { maxCostUsd: 1 } }));
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_15);
    const last = `aex_${String(EXECUTION_CONFIG_PAGE_SIZE).padStart(4, "0")}`;
    expect(row(db, last).data).toEqual(
      executionBytes({
        metadata: metadata(last),
        spec: { message: "hello", runConfig: { maxCostUsd: 1 } },
        status: { runConfig: { maxCostUsd: 1 }, approvalMode: ApprovalMode.INTERACTIVE },
      }),
    );
  });

  it("an unreadable turn fails the step, rolls back the turns it rewrote, and leaves the database at v14", () => {
    const { dbPath, db: setup } = v14Database();
    // A readable turn ahead of the unreadable one in id order is rewritten
    // first; the failure must take that rewrite back.
    const good = retiredExecutionRow({ metadata: metadata("aex_a_good"), config: { maxCostUsd: 1 } });
    insert(setup, "aex_a_good", good);
    insert(setup, "aex_b_bad", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_15)).toThrow("agent_execution 'aex_b_bad'");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_15 - 1);
    expect(row(db, "aex_a_good").data).toEqual(good);
  });
});
