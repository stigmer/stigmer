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
 * v13. v17 removes the workflow instance rows from every table and every
 * grant naming an instance, across keyset pages, with its list keys and its
 * history kept; a grant it cannot decode fails the step, naming the row,
 * and leaves the database at v16. The frozen steps replay over workflow
 * instance rows from v9 exactly as they shipped. v18 renames the agent run
 * kind: every table keyed by kind names agent_run, every run row reads the
 * contract's kind string with its stamp kept, and every grant on a run is
 * re-keyed to the id its new triple derives (its history kept under the old
 * id); the store opened on the migrated database finds each run through its
 * session and each re-keyed grant through its principal; a run or grant it
 * cannot decode fails the step, naming the row, and leaves the database at
 * v17. v19 removes every workflow, workflow run (under either kind name)
 * and artifact row from every table keyed by kind, and every grant naming
 * one of those kinds with its list keys (its history kept); it rewrites
 * every agent run that carries a workflow parent, a workflow step's task
 * token or the workflow lineage labels without them, every other byte
 * kept, and drops workflow_execution_events and signal_dedupe. Proven by a
 * chain from v9 through v16 (the frozen steps read the retired kinds
 * through their envelopes, so a public workflow moves to org and a dead
 * organization's slug is still recorded) and by a store at v18: at head no
 * row of a retired kind and no grant naming one is left, both tables are
 * gone, and every agent, session and agent run reads back unchanged (a
 * parented run without its parent); across keyset pages; an agent run or
 * grant it cannot decode fails the step, naming the row, and leaves the
 * database at v18.
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
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

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
  SCHEMA_VERSION_17,
  SCHEMA_VERSION_18,
  SCHEMA_VERSION_19,
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
import { WORKFLOW_RETIREMENT_PAGE_SIZE } from "../../workflow-instance-retired.js";
import {
  AGENT_RUN_RETIRED_PAGE_SIZE,
  RETIRED_WORKFLOW_KINDS,
  WORKFLOW_RETIRED_PAGE_SIZE,
} from "../../workflow-retired.js";
import {
  WORKFLOW_LINEAGE_LABELS,
  agentRunRow,
  retiredArtifactRow,
  retiredWorkflowInstanceRow,
  retiredWorkflowRow,
  retiredWorkflowRunRow,
} from "../../__tests__/retired-workflow-rows.js";
import { materializeGoFixture } from "./support.js";
import { agentExecutionListIndex } from "../../../domain/agentrun/list-index.js";
import { iamPolicyListIndex } from "../../../domain/iampolicy/list-index.js";
import { RUN_KIND_TABLES, RUN_RENAME_PAGE_SIZE } from "../../run-rename.js";
import {
  NEW_RUN_NAMES,
  OLD_RUN_NAMES,
  RUN_RENAME_ORG,
  agentRunBytes,
} from "../../__tests__/run-rename-rows.js";
import { policyIdFor } from "../../../domain/iampolicy/constants.js";

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
      "schedule_runs",
      "oauth_grant",
      "pending_oauth_state",
      "resource_names",
      "organization_deletions",
    ]) {
      expect(tables, `table ${expected} should exist`).toContain(expected);
    }
    expect(tables, "v13 replaced the slug ledger").not.toContain(
      "organization_slugs",
    );
    for (const dropped of ["workflow_execution_events", "signal_dedupe"]) {
      expect(tables, `v19 dropped ${dropped}`).not.toContain(dropped);
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
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
  it("migrates 6 → current preserving every row of the tables it keeps, including the out-of-chain ones", async () => {
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

    const run = db
      .prepare(`SELECT outcome, completed_at FROM schedule_runs`)
      .get() as { outcome: string; completed_at: string };
    expect(run.outcome).toBe("completed");
    expect(run.completed_at).toBe("2026-08-20T00:00:05Z");

    // The workflow event log and the signal ledger the fixture held are
    // gone with the workflows (v19); the other consolidated tables keep
    // their Go-written rows, adopted, not shadowed.
    expect(tableNames(db)).not.toContain("workflow_execution_events");
    expect(tableNames(db)).not.toContain("signal_dedupe");

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
    // without touching the row. The event log is v5's, as every v6
    // database has it.
    setup.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (1),(2),(3),(4),(5),(6);
      CREATE TABLE resources (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kind, id)) WITHOUT ROWID;
      CREATE TABLE resource_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, resource_id TEXT NOT NULL, data BLOB NOT NULL, archived_at TEXT NOT NULL DEFAULT (datetime('now')), version_hash TEXT, tag TEXT);
      CREATE TABLE workflow_execution_events (execution_id TEXT NOT NULL, sequence_number INTEGER NOT NULL, event_type TEXT NOT NULL, task_name TEXT NOT NULL DEFAULT '', data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), PRIMARY KEY (execution_id, sequence_number));
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

describe("v17: the workflow instance rows and the grants naming them leave", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-09-01 00:00:00";
  const metadata = (id: string) => ({ id, org: ORG, slug: id });

  /** A v16 database: the chain replayed up to the step before v17. */
  function v16Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_17 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_17 - 1);
    return { dbPath, db: setup };
  }

  function insert(
    db: DatabaseSync,
    kind: string,
    id: string,
    data: Uint8Array,
  ): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function row(
    db: DatabaseSync,
    kind: string,
    id: string,
  ): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string };
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`)
        .get(kind) as { n: number }
    ).n;
  }

  /** The default and named instances, with history and a list key. */
  function seedInstances(db: DatabaseSync): void {
    insert(
      db,
      "workflow_instance",
      "win_default",
      retiredWorkflowInstanceRow({
        metadata: { id: "win_default", org: ORG, slug: "wfl-1-default" },
        workflowId: "wfl_1",
      }),
    );
    insert(
      db,
      "workflow_instance",
      "win_named",
      retiredWorkflowInstanceRow({
        metadata: { id: "win_named", org: ORG, slug: "nightly-prod" },
        workflowId: "wfl_1",
        environmentRefs: [{ org: ORG, slug: "prod", kind: 53 }],
        executionVisibility: 2,
      }),
    );
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('workflow_instance', 'win_default', ?, '', '')`,
    ).run(new Uint8Array([0x00]));
    db.prepare(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('workflow_instance', 'win_default', 'workflow', 'wfl_1', '')`,
    ).run();
  }

  const keptGrant = {
    id: "iam_on_agent",
    principal: "identity_account:ida_1",
    relation: "viewer",
    resource: "agent:agt_1",
  };
  const retiredGrants = [
    {
      id: "iam_on_default",
      principal: "identity_account:ida_1",
      relation: "viewer",
      resource: "workflow_instance:win_default",
    },
    {
      id: "iam_on_named",
      principal: "identity_account:ida_2",
      relation: "owner",
      resource: "workflow_instance:win_named",
    },
    {
      id: "iam_named_member",
      principal: "workflow_instance:win_named",
      relation: "member",
      resource: "team:tm_1",
    },
  ];

  function seedGrants(db: DatabaseSync): void {
    for (const grant of [...retiredGrants, keptGrant]) {
      insert(db, "iam_policy", grant.id, policyRow(grant));
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
      ).run(grant.id, grant.principal.split(":")[1] ?? "");
    }
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_named', ?, '', '')`,
    ).run(new Uint8Array([0x00]));
  }

  it("removes the instance rows from every table and every grant naming one, its history kept, and keeps a grant on another kind", () => {
    const { dbPath, db: setup } = v16Database();
    seedInstances(setup);
    seedGrants(setup);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_17);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);

    for (const table of ["resources", "resource_audit", "resource_list_keys"]) {
      expect(count(db, table, "workflow_instance")).toBe(0);
    }
    const policyIds = (table: string) =>
      (
        db
          .prepare(`SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`)
          .all() as Array<{ id: string }>
      ).map((r) => r.id);
    expect(policyIds("resources")).toEqual([keptGrant.id]);
    expect(policyIds("resource_list_keys")).toEqual([keptGrant.id]);
    expect(row(db, "iam_policy", keptGrant.id)).toEqual({
      data: policyRow(keptGrant),
      updated_at: SEEDED_AT,
    });
    expect(count(db, "resource_audit", "iam_policy")).toBe(1);
  });

  it("reads grants across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = v16Database();
    seedInstances(setup);
    setup.exec("BEGIN");
    for (let i = 0; i <= WORKFLOW_RETIREMENT_PAGE_SIZE; i++) {
      const id = `iam_page_${String(i).padStart(4, "0")}`;
      // The last grant, past the first page, is the only one naming an
      // instance.
      insert(
        setup,
        "iam_policy",
        id,
        policyRow({
          id,
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource:
            i === WORKFLOW_RETIREMENT_PAGE_SIZE
              ? "workflow_instance:win_named"
              : "agent:agt_1",
        }),
      );
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_17);

    expect(count(db, "resources", "iam_policy")).toBe(
      WORKFLOW_RETIREMENT_PAGE_SIZE,
    );
    const last = `iam_page_${String(WORKFLOW_RETIREMENT_PAGE_SIZE).padStart(4, "0")}`;
    expect(row(db, "iam_policy", last)).toBeUndefined();
    expect(count(db, "resources", "workflow_instance")).toBe(0);
  });

  it("a grant that does not decode fails the step, names the row, rolls back, and leaves the database at v16", () => {
    const { dbPath, db: setup } = v16Database();
    seedInstances(setup);
    // A retired grant ahead of the broken one in id order is deleted
    // first; the failure must take that delete back.
    insert(setup, "iam_policy", "iam_a_retired", policyRow({ ...retiredGrants[0]!, id: "iam_a_retired" }));
    insert(setup, "iam_policy", "iam_z_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_17)).toThrow(
      "iam_policy 'iam_z_broken' cannot be read to retire the workflow instance kind",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17 - 1);
    expect(row(db, "iam_policy", "iam_a_retired").data).toEqual(
      policyRow({ ...retiredGrants[0]!, id: "iam_a_retired" }),
    );
    expect(count(db, "resources", "workflow_instance")).toBe(2);
  });

  it("replays the frozen steps over workflow instance rows from v9 exactly as they shipped, then removes them", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_10 - 1);
    const instanceAt = (visibility: ApiResourceVisibility) =>
      retiredWorkflowInstanceRow({
        metadata: {
          id: "win_public",
          org: "deleted-org",
          slug: "nightly-shared",
          visibility,
        },
        workflowId: "wfl_1",
        description: "Shared deployment",
        environmentRefs: [{ org: "deleted-org", slug: "prod", kind: 53 }],
        executionVisibility: 2,
      });
    insert(
      setup,
      "workflow_instance",
      "win_public",
      instanceAt(ApiResourceVisibility.visibility_public),
    );
    insert(
      setup,
      "iam_policy",
      "iam_on_public",
      policyRow({
        id: "iam_on_public",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "workflow_instance:win_public",
      }),
    );
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_12);
    // v10 moved the retired row to org without disturbing another byte…
    expect(row(db, "workflow_instance", "win_public").data).toEqual(
      instanceAt(ApiResourceVisibility.visibility_org),
    );
    // …and v12 recorded the organization it names, with none live, retired.
    expect(
      db
        .prepare(
          `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs`,
        )
        .all(),
    ).toEqual([{ slug: "deleted-org", retired: 1 }]);

    runMigrations(db, SCHEMA_VERSION_17);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);
    expect(count(db, "resources", "workflow_instance")).toBe(0);
    expect(count(db, "resources", "iam_policy")).toBe(0);
  });
});

describe("v18: agent executions are runs", () => {
  const SEEDED_AT = "2026-10-01 00:00:00";

  /** A v17 database: the chain replayed up to the step before v18. */
  function v17Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_18 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_18 - 1);
    return { dbPath, db: setup };
  }

  /** A row as the release before stored it, its list facts proven under revision 1. */
  function insertIndexed(
    db: DatabaseSync,
    kind: string,
    id: string,
    data: Uint8Array,
    keys: Record<string, string>,
  ): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at, list_org, list_created_at, list_index_revision, list_indexed_at)
       VALUES (?, ?, ?, ?, ?, '', 1, ?)`,
    ).run(kind, id, data, SEEDED_AT, RUN_RENAME_ORG, SEEDED_AT);
    for (const [key, value] of Object.entries(keys)) {
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, ?, ?, '')`,
      ).run(kind, id, key, value);
    }
  }

  function insertPlain(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function row(
    db: DatabaseSync,
    kind: string,
    id: string,
  ): { data: Uint8Array; updated_at: string } | undefined {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string } | undefined;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as {
        n: number;
      }
    ).n;
  }

  const runGrant = {
    id: "iamp_on_run",
    principal: "identity_account:ida_2",
    relation: "viewer",
    resource: "agent_execution:aex_1",
  };
  const keptGrant = {
    id: "iamp_on_agent",
    principal: "identity_account:ida_3",
    relation: "viewer",
    resource: "agent:agt_1",
  };

  it("renames the run kind in every table, rewrites the rows that spell it and re-keys grants on runs", async () => {
    const { dbPath, db: setup } = v17Database();
    insertIndexed(setup, "agent_execution", "aex_1", agentRunBytes("aex_1", "ses_1", OLD_RUN_NAMES), {
      session: "ses_1",
    });
    const runAudit = new Uint8Array([0x0a, 0x01, 0x61]);
    setup
      .prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_execution', 'aex_1', ?, '', '')`,
      )
      .run(runAudit);
    setup
      .prepare(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('agent_execution', ?, 'aex_1', 'aex_1', 'current', ?)`,
      )
      .run(RUN_RENAME_ORG, SEEDED_AT);
    for (const grant of [runGrant, keptGrant]) {
      insertPlain(setup, "iam_policy", grant.id, policyRow(grant));
      setup
        .prepare(
          `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
        )
        .run(grant.id, grant.principal.split(":")[1] ?? "");
    }
    setup
      .prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', ?, ?, '', '')`,
      )
      .run(runGrant.id, policyRow(runGrant));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_18);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_18);

    for (const table of ["resources", "resource_audit", "resource_list_keys", "resource_names"]) {
      expect(count(db, table, "agent_execution")).toBe(0);
    }
    // The run reads the contract's kind string under its new kind, and
    // keeps its stamp: no list key reads what changed.
    expect(row(db, "agent_run", "aex_1")).toEqual({
      data: agentRunBytes("aex_1", "ses_1", NEW_RUN_NAMES),
      updated_at: SEEDED_AT,
    });
    // A run's history keeps its bytes under the new kind.
    expect(
      db
        .prepare(`SELECT kind, data FROM resource_audit WHERE resource_id = 'aex_1'`)
        .all(),
    ).toEqual([{ kind: "agent_run", data: runAudit }]);
    expect(
      db.prepare(`SELECT kind, name FROM resource_names WHERE id = 'aex_1'`).all(),
    ).toEqual([{ kind: "agent_run", name: "aex_1" }]);

    // The grant on the run moves to the id its renamed triple derives; its
    // history stays under the old id. The grant on the agent is untouched.
    const rekeyedId = policyIdFor(
      fromBinary(
        IamPolicySchema,
        policyRow({ ...runGrant, resource: "agent_run:aex_1" }),
      ).spec!,
    );
    expect(row(db, "iam_policy", runGrant.id)).toBeUndefined();
    const rekeyed = fromBinary(IamPolicySchema, row(db, "iam_policy", rekeyedId)!.data);
    expect(rekeyed.metadata?.id).toBe(rekeyedId);
    expect(rekeyed.spec?.resource).toMatchObject({ kind: "agent_run", id: "aex_1" });
    expect(row(db, "iam_policy", keptGrant.id)?.data).toEqual(policyRow(keptGrant));
    expect(
      db
        .prepare(`SELECT resource_id FROM resource_audit WHERE kind = 'iam_policy'`)
        .all(),
    ).toEqual([{ resource_id: runGrant.id }]);

    // The store the server opens finds the run through the key its list
    // reads, and the re-keyed grant through its principal.
    const store = SqliteStore.open(dbPath, undefined, {
      listIndexes: [agentExecutionListIndex, iamPolicyListIndex],
    });
    cleanups.push(() => store.close());
    const ids = async (
      index: Parameters<typeof store.queryResources>[0],
      name: string,
      value: string,
    ): Promise<string[]> =>
      (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
    expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
    expect(await ids(iamPolicyListIndex, "principal", "ida_2")).toEqual([rekeyedId]);
    expect(await ids(iamPolicyListIndex, "principal", "ida_3")).toEqual([keptGrant.id]);
  });

  it("reads runs across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = v17Database();
    for (let i = 0; i <= RUN_RENAME_PAGE_SIZE; i++) {
      const id = `aex_page_${String(i).padStart(4, "0")}`;
      insertPlain(setup, "agent_execution", id, agentRunBytes(id, "ses_1", OLD_RUN_NAMES));
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_18);
    const last = `aex_page_${String(RUN_RENAME_PAGE_SIZE).padStart(4, "0")}`;
    expect(count(db, "resources", "agent_run")).toBe(RUN_RENAME_PAGE_SIZE + 1);
    expect(row(db, "agent_run", last)?.data).toEqual(agentRunBytes(last, "ses_1", NEW_RUN_NAMES));
  });

  it("a run that does not decode fails the step, names the row, and leaves the database at v17", () => {
    const { dbPath, db: setup } = v17Database();
    insertPlain(setup, "agent_execution", "aex_good", agentRunBytes("aex_good", "ses_1", OLD_RUN_NAMES));
    insertPlain(setup, "agent_execution", "aex_bad", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_18)).toThrow(/agent_execution row aex_bad/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);
    expect(row(db, "agent_execution", "aex_good")?.data).toEqual(
      agentRunBytes("aex_good", "ses_1", OLD_RUN_NAMES),
    );
  });

  it("a grant that does not decode fails the step, names the row, and leaves the database at v17", () => {
    const { dbPath, db: setup } = v17Database();
    insertPlain(setup, "iam_policy", runGrant.id, policyRow(runGrant));
    insertPlain(setup, "iam_policy", "iamp_bad", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_18)).toThrow(
      /the iam_policy row iamp_bad cannot be read for the rename of executions to runs/,
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);
    expect(row(db, "iam_policy", runGrant.id)?.data).toEqual(policyRow(runGrant));
  });
});

describe("v19: workflows, workflow runs and artifacts leave the store", () => {
  const ORG = "org_01jz0000000000000000000000";
  const HASH = "b".repeat(64);
  const SEEDED_AT = "2026-10-05 00:00:00";
  const TOKEN = new Uint8Array([0x0c, 0x0d]);
  const OWN_LABELS = { team: "support" };
  const metadata = (id: string) => ({ id, org: ORG, slug: id });
  /** Every kind the step removes, with the instance kind v17 removed before it. */
  const GONE_KINDS = [...RETIRED_WORKFLOW_KINDS, "workflow_instance"];

  function insert(
    db: DatabaseSync,
    kind: string,
    id: string,
    data: Uint8Array,
  ): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function listKey(db: DatabaseSync, kind: string, id: string, key: string, value: string): void {
    db.prepare(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, ?, ?, '')`,
    ).run(kind, id, key, value);
  }

  function data(db: DatabaseSync, kind: string, id: string): Uint8Array | undefined {
    return (
      db.prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`).get(kind, id) as
        | { data: Uint8Array }
        | undefined
    )?.data;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as {
        n: number;
      }
    ).n;
  }

  const agent = toBinary(
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id: "agt_1", name: "reviewer", slug: "reviewer", org: ORG },
      spec: { instructions: "a conformant instruction body" },
    }),
  );
  const session = toBinary(
    SessionSchema,
    create(SessionSchema, {
      metadata: { id: "ses_1", org: ORG },
      status: { agentId: "agt_1" },
    }),
  );
  const keptGrant = {
    id: "iam_kept",
    principal: "identity_account:ida_9",
    relation: "viewer",
    resource: "agent:agt_1",
  };

  /** The agent, its session and their name, which every arm keeps. */
  function seedAgents(db: DatabaseSync): void {
    insert(db, "agent", "agt_1", agent);
    insert(db, "session", "ses_1", session);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('agent', ?, 'reviewer', 'agt_1', 'current', ?)`,
    ).run(ORG, SEEDED_AT);
    insert(db, "iam_policy", keptGrant.id, policyRow(keptGrant));
    listKey(db, "iam_policy", keptGrant.id, "principal", "ida_9");
  }

  /** A workflow head, an archived version and the name it held. */
  function seedWorkflow(db: DatabaseSync, id: string): void {
    const workflow = retiredWorkflowRow({ metadata: metadata(id), versionHash: HASH });
    insert(db, "workflow", id, workflow);
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('workflow', ?, ?, ?, 'v1')`,
    ).run(id, workflow, HASH);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('workflow', ?, ?, ?, 'current', ?)`,
    ).run(ORG, id, id, SEEDED_AT);
  }

  /** Grants naming each retired kind; one keeps an archived version. */
  function seedRetiredGrants(db: DatabaseSync, runKind: string): void {
    const grants = [
      { id: "iam_on_workflow", principal: "identity_account:ida_1", relation: "viewer", resource: "workflow:wfl_head" },
      { id: "iam_on_run", principal: "identity_account:ida_2", relation: "viewer", resource: `${runKind}:wex_direct` },
      { id: "iam_run_principal", principal: `${runKind}:wex_direct`, relation: "viewer", resource: "agent:agt_1" },
      { id: "iam_on_artifact", principal: "identity_account:ida_3", relation: "viewer", resource: "artifact:art_wf" },
    ];
    for (const grant of grants) {
      insert(db, "iam_policy", grant.id, policyRow(grant));
      listKey(db, "iam_policy", grant.id, "principal", grant.principal.split(":")[1] ?? "");
    }
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_workflow', ?, '', '')`,
    ).run(policyRow(grants[0]!));
  }

  /** Artifacts a workflow step and an agent run produced, with their list keys. */
  function seedArtifacts(db: DatabaseSync): void {
    insert(
      db,
      "artifact",
      "art_wf",
      retiredArtifactRow({
        metadata: metadata("art_wf"),
        source: { workflowRunId: "wex_direct", taskName: "triage" },
      }),
    );
    listKey(db, "artifact", "art_wf", "workflow_execution", "wex_direct");
    insert(
      db,
      "artifact",
      "art_agent",
      retiredArtifactRow({
        metadata: metadata("art_agent"),
        source: { agentRunId: "aex_plain" },
      }),
    );
    listKey(db, "artifact", "art_agent", "agent_run", "aex_plain");
  }

  /** The workflow event log and the signal ledger, each with a row. */
  function seedWorkflowTables(db: DatabaseSync): void {
    db.prepare(
      `INSERT INTO workflow_execution_events (execution_id, sequence_number, event_type, task_name, data) VALUES ('wex_direct', 1, 'run_started', '', ?)`,
    ).run(new Uint8Array([0x01]));
    db.prepare(
      `INSERT INTO signal_dedupe (id, org, idempotency_key, execution_id, signal_name, status, created_at, expires_at)
       VALUES (?, ?, 'key-1', 'wex_direct', 'resume', 'DELIVERED', ?, ?)`,
    ).run(`${ORG}:key-1`, ORG, "2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z");
  }

  /** A plain agent run and one a workflow step started, under the kind string given. */
  function seedAgentRuns(
    db: DatabaseSync,
    kind: "agent_execution" | "agent_run",
    kindString: "AgentExecution" | "AgentRun",
  ): void {
    insert(db, kind, "aex_plain", agentRunRow({ id: "aex_plain", kindString, org: ORG, sessionId: "ses_1" }));
    insert(
      db,
      kind,
      "aex_parented",
      agentRunRow({
        id: "aex_parented",
        kindString,
        org: ORG,
        sessionId: "ses_1",
        labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
        parent: "wex_direct",
        callbackToken: TOKEN,
      }),
    );
  }

  /**
   * The state every arm reaches at head: no row of a retired kind in any
   * table keyed by kind, no grant naming one (their history kept), both
   * workflow tables gone, and the agent, its session and both runs read
   * back unchanged, the parented run without what the workflow left on it.
   */
  async function expectRetired(dbPath: string): Promise<DatabaseSync> {
    const store = SqliteStore.open(dbPath, undefined, {
      listIndexes: [CONTRACT_SESSION_INDEX, agentExecutionListIndex, iamPolicyListIndex],
    });
    cleanups.push(() => store.close());
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_19);
    for (const table of RUN_KIND_TABLES) {
      for (const kind of GONE_KINDS) {
        expect(count(db, table, kind), `${kind} in ${table}`).toBe(0);
      }
    }
    const policies = db
      .prepare(`SELECT id, data FROM resources WHERE kind = 'iam_policy' ORDER BY id`)
      .all() as Array<{ id: string; data: Uint8Array }>;
    expect(policies.map((p) => p.id)).toEqual([keptGrant.id]);
    for (const policy of policies) {
      const spec = fromBinary(IamPolicySchema, policy.data).spec;
      expect(GONE_KINDS).not.toContain(spec?.resource?.kind);
      expect(GONE_KINDS).not.toContain(spec?.principal?.kind);
    }
    expect(
      db
        .prepare(`SELECT DISTINCT id FROM resource_list_keys WHERE kind = 'iam_policy' ORDER BY id`)
        .all(),
    ).toEqual([{ id: keptGrant.id }]);
    expect(
      db
        .prepare(`SELECT resource_id FROM resource_audit WHERE kind = 'iam_policy'`)
        .all(),
      "a deleted grant's history is kept",
    ).toEqual([{ resource_id: "iam_on_workflow" }]);
    const tables = tableNames(db);
    expect(tables).not.toContain("workflow_execution_events");
    expect(tables).not.toContain("signal_dedupe");

    expect(data(db, "agent", "agt_1")).toEqual(agent);
    expect(data(db, "session", "ses_1")).toEqual(session);
    expect(
      db.prepare(`SELECT kind, name FROM resource_names WHERE id = 'agt_1'`).all(),
    ).toEqual([{ kind: "agent", name: "reviewer" }]);
    const plain = agentRunRow({ id: "aex_plain", org: ORG, sessionId: "ses_1" });
    const parented = agentRunRow({
      id: "aex_parented",
      org: ORG,
      sessionId: "ses_1",
      labels: OWN_LABELS,
    });
    expect(data(db, "agent_run", "aex_plain")).toEqual(plain);
    expect(data(db, "agent_run", "aex_parented")).toEqual(parented);
    expect(
      await store.getResource(ApiResourceKind.agent_run, "aex_parented", AgentRunSchema),
    ).toEqual(fromBinary(AgentRunSchema, parented));
    expect(
      await store.getResource(ApiResourceKind.agent_run, "aex_plain", AgentRunSchema),
    ).toEqual(fromBinary(AgentRunSchema, plain));
    expect(
      (
        await store.queryResources(agentExecutionListIndex, {
          anyKey: [{ name: "session", value: "ses_1" }],
        })
      )
        .map((r) => r.id)
        .sort(),
    ).toEqual(["aex_parented", "aex_plain"]);
    return db;
  }

  it("removes every row of the retired kinds and every grant naming one, drops the workflow tables, and keeps every agent resource, from a store at v9 through v16", async () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_10 - 1);
    // Before the frozen steps: a public workflow, and a workflow naming an
    // organization the store no longer holds.
    const publicAt = (visibility: ApiResourceVisibility) =>
      retiredWorkflowRow({
        metadata: { ...metadata("wfl_public"), visibility },
        versionHash: HASH,
        defaultInstanceId: "win_1",
      });
    insert(setup, "workflow", "wfl_public", publicAt(ApiResourceVisibility.visibility_public));
    insert(
      setup,
      "workflow",
      "wfl_dead_org",
      retiredWorkflowRow({
        metadata: { id: "wfl_dead_org", org: "dead-org", slug: "nightly" },
        versionHash: HASH,
      }),
    );
    insert(setup, "organization", ORG, new Uint8Array([0x00]));
    runMigrations(setup, SCHEMA_VERSION_17 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_17 - 1);
    // The frozen steps read the workflows through their envelope: v10 moved
    // the public one to org, every other byte kept, and v12 recorded the
    // dead organization's slug, which v13 keeps as a previous name.
    expect(data(setup, "workflow", "wfl_public")).toEqual(
      publicAt(ApiResourceVisibility.visibility_org),
    );
    const deadSlug = {
      kind: "organization",
      org: "",
      name: "dead-org",
      id: "dead-org",
      state: "previous",
    };
    expect(
      setup
        .prepare(`SELECT kind, org, name, id, state FROM resource_names WHERE name = 'dead-org'`)
        .all(),
    ).toEqual([deadSlug]);

    // At v16: every retired kind's rows, and what an agent keeps.
    seedAgents(setup);
    seedWorkflow(setup, "wfl_head");
    setup
      .prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('workflow_instance', 'win_1', ?, ?)`)
      .run(
        retiredWorkflowInstanceRow({ metadata: metadata("win_1"), workflowId: "wfl_head" }),
        SEEDED_AT,
      );
    insert(
      setup,
      "workflow_execution",
      "wex_through_instance",
      retiredWorkflowRunRow({
        metadata: metadata("wex_through_instance"),
        kindString: "WorkflowExecution",
        instanceId: "win_1",
        callbackToken: TOKEN,
      }),
    );
    listKey(setup, "workflow_execution", "wex_through_instance", "workflow_instance", "win_1");
    insert(
      setup,
      "workflow_execution",
      "wex_direct",
      retiredWorkflowRunRow({
        metadata: metadata("wex_direct"),
        kindString: "WorkflowExecution",
        workflowId: "wfl_head",
      }),
    );
    listKey(setup, "workflow_execution", "wex_direct", "workflow", "wfl_head");
    seedRetiredGrants(setup, "workflow_execution");
    insert(
      setup,
      "iam_policy",
      "iam_on_instance",
      policyRow({
        id: "iam_on_instance",
        principal: "identity_account:ida_4",
        relation: "viewer",
        resource: "workflow_instance:win_1",
      }),
    );
    seedArtifacts(setup);
    seedWorkflowTables(setup);
    seedAgentRuns(setup, "agent_execution", "AgentExecution");
    setup.close();

    const db = await expectRetired(dbPath);
    expect(
      db
        .prepare(`SELECT kind, org, name, id, state FROM resource_names WHERE name = 'dead-org'`)
        .all(),
    ).toEqual([deadSlug]);
  });

  it("removes every row of the retired kinds and every grant naming one, drops the workflow tables, and keeps every agent resource, from a store at v18", async () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_19 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_18);
    seedAgents(setup);
    seedWorkflow(setup, "wfl_head");
    insert(
      setup,
      "workflow_run",
      "wex_direct",
      retiredWorkflowRunRow({
        metadata: metadata("wex_direct"),
        kindString: "WorkflowRun",
        workflowId: "wfl_head",
      }),
    );
    listKey(setup, "workflow_run", "wex_direct", "workflow", "wfl_head");
    seedRetiredGrants(setup, "workflow_run");
    seedArtifacts(setup);
    seedWorkflowTables(setup);
    seedAgentRuns(setup, "agent_run", "AgentRun");
    setup.close();

    await expectRetired(dbPath);
  });

  it("reads agent runs and grants across keyset pages, missing none past the first page", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_19 - 1);
    const runs = AGENT_RUN_RETIRED_PAGE_SIZE + 3;
    const runId = (i: number) =>
      // Mixed case and punctuation: the keyset holds in byte order.
      `${i % 2 === 0 ? "aex_" : "AEX-"}${String(i).padStart(4, "0")}`;
    const grantId = (i: number) => `iam_page_${String(i).padStart(4, "0")}`;
    setup.exec("BEGIN");
    for (let i = 0; i < runs; i++) {
      insert(
        setup,
        "agent_run",
        runId(i),
        agentRunRow({ id: runId(i), org: ORG, sessionId: "ses_1", parent: "wex_1" }),
      );
    }
    for (let i = 0; i <= WORKFLOW_RETIRED_PAGE_SIZE; i++) {
      // The last grant, past the first page, is the only one naming a
      // workflow.
      insert(
        setup,
        "iam_policy",
        grantId(i),
        policyRow({
          id: grantId(i),
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: i === WORKFLOW_RETIRED_PAGE_SIZE ? "workflow:wfl_1" : "agent:agt_1",
        }),
      );
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db);
    for (let i = 0; i < runs; i++) {
      expect(data(db, "agent_run", runId(i)), runId(i)).toEqual(
        agentRunRow({ id: runId(i), org: ORG, sessionId: "ses_1" }),
      );
    }
    expect(count(db, "resources", "iam_policy")).toBe(WORKFLOW_RETIRED_PAGE_SIZE);
    expect(data(db, "iam_policy", grantId(WORKFLOW_RETIRED_PAGE_SIZE))).toBeUndefined();
  });

  it.each([
    { kind: "agent_run", id: "aex_z_broken" },
    { kind: "iam_policy", id: "iam_z_broken" },
  ])(
    "a $kind row that does not decode fails the step, names the row, rolls back, and leaves the database at v18",
    (broken) => {
      const dbPath = tempDbPath();
      const setup = new DatabaseSync(dbPath);
      runMigrations(setup, SCHEMA_VERSION_19 - 1);
      seedWorkflow(setup, "wfl_head");
      seedWorkflowTables(setup);
      // A readable run and a retired grant ahead of the broken row in id
      // order are rewritten and deleted first; the failure must take both
      // back.
      const good = agentRunRow({ id: "aex_a_good", org: ORG, sessionId: "ses_1", parent: "wex_1" });
      insert(setup, "agent_run", "aex_a_good", good);
      const retired = policyRow({
        id: "iam_a_retired",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "workflow:wfl_head",
      });
      insert(setup, "iam_policy", "iam_a_retired", retired);
      insert(setup, broken.kind, broken.id, new Uint8Array([0x22, 0xff]));
      setup.close();

      const db = new DatabaseSync(dbPath);
      cleanups.push(() => db.close());
      expect(() => runMigrations(db)).toThrow(
        `${broken.kind} '${broken.id}' cannot be read to retire the workflow kinds`,
      );
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_18);
      expect(data(db, "agent_run", "aex_a_good")).toEqual(good);
      expect(data(db, "iam_policy", "iam_a_retired")).toEqual(retired);
      expect(count(db, "resources", "workflow")).toBe(1);
      const tables = tableNames(db);
      expect(tables).toContain("workflow_execution_events");
      expect(tables).toContain("signal_dedupe");
    },
  );
});
