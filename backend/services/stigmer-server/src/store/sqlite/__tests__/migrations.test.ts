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
 * listByAgent reads; every grant row naming an instance as resource
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
 * database at v18. v21 renames the agent run kind again, to run, by v18's
 * transformation: from a store at v20 every table keyed by kind names run,
 * every run reads the contract's kind string `Run` with its `aex_` id and
 * its stamp kept, its history keeps its bytes, and every grant on a run is
 * re-keyed (history kept under the old id); the store opened at the head
 * reads each run by its `aex_` id, finds it through its session and each
 * re-keyed grant through its principal; a chain from v17 (before v18)
 * reaches the same rows; across keyset pages; a run or grant it cannot
 * decode fails the step, naming the row, and leaves the database at v20.
 * v22 removes every environment row from every table keyed by kind and
 * every grant naming an environment with its list keys (its history kept),
 * across keyset pages, drops oauth_grant, adds pending_oauth_state's
 * vault_id and tool_address ("" on a row from before them) and keeps every other kind's rows
 * byte for byte; a grant it cannot decode fails the
 * step, naming the row, and leaves the database at v21.
 * v23 drops a conversation's retired own secrets and connections (session
 * spec fields 16 and 17) from every session row, its stamp and every other
 * field kept, across keyset pages; a session without them, and every other
 * kind's row, keeps its bytes; a session it cannot decode fails the step,
 * naming the row, and leaves the database at v22.
 * v36 reports the stored labels, tags and annotations the new rules
 * refuse, one warning per kind with its counts and the first ten ids,
 * across keyset pages, and writes nothing.
 * v38 renames the IAM policy kind to grant, the Postgres driver's v34 in
 * this engine's terms: every grant takes the kind's names and its grt_ id
 * with its list keys and history; the history's tables, column and time
 * index take the kind's name; the store then finds each grant by its
 * triple, refuses a second row for it, revokes it and lists its history; a
 * grant whose id is not its triple's fails the step, naming it, and leaves
 * the database at v37. A grant held before v34 reaches the head carrying
 * its etag.
 * v40 renames the evaluator kind to scoring rule, the Postgres driver's v36
 * in this engine's terms: its row, audit, list key and name take the
 * kind's new name, its bytes the new kind string with its id, settings and
 * spend kept, and every other kind's row keeps its bytes; a row it cannot
 * decode fails the step, naming it, and leaves the database at v39.
 * v41 merges the agent share and agent channel kinds into the channel kind
 * (../../channel-kinds-merged.ts): every row converted under its old id
 * across keyset pages, a slug two rows held kept by the older, the names
 * claimed under channel, every grant re-keyed and its history moved across
 * keyset pages, a guest conversation relabelled; a row, grant, history
 * entry or conversation it cannot read, an archived version or a previous
 * name fails the step, naming it, and leaves the database at v40.
 * v42 renames the schedule kind to the routine kind
 * (../../schedules-become-routines.ts): its rows, list keys and names
 * current and previous moved with their sch_ id and bytes but the kind
 * string, its grants re-keyed (Owner made Participant) with their history,
 * the fire ledger rebuilt keyed by fire id (a manual fire sharing its second
 * suffixed), the runs it started relabelled; a grant it cannot read fails
 * the step, naming it, and leaves the database at v41.
 * A schema written by a newer release is refused before any migration or
 * list-index reconciliation, with the failed store's connection closed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ApprovalMode,
  InteractionMode,
  RunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ScoreSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

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
  SCHEMA_VERSION_20,
  SCHEMA_VERSION_21,
  SCHEMA_VERSION_22,
  SCHEMA_VERSION_23,
  SCHEMA_VERSION_24,
  SCHEMA_VERSION_25,
  SCHEMA_VERSION_32,
  SCHEMA_VERSION_33,
  SCHEMA_VERSION_34,
  SCHEMA_VERSION_35,
  SCHEMA_VERSION_36,
  SCHEMA_VERSION_37,
  SCHEMA_VERSION_38,
  SCHEMA_VERSION_39,
  SCHEMA_VERSION_40,
  SCHEMA_VERSION_41,
  SCHEMA_VERSION_42,
  SCHEMA_VERSION_7,
  getSchemaVersion,
  runMigrations,
} from "../migrations.js";
import { RETIREMENT_PAGE_SIZE } from "../../agent-instance-retired.js";
import { ENVIRONMENT_RETIRED_PAGE_SIZE } from "../../environment-retired.js";
import {
  grantBeforeV34,
  grantIdAfterV34,
  grantIdBeforeV34,
  grantRow,
  grantRowAfterV34,
  retiredInstanceRow,
  retiredSessionRow,
  sessionBytes,
} from "../../__tests__/retired-instance-rows.js";
import {
  executionBytes,
  retiredExecutionRow,
} from "../../__tests__/retired-execution-rows.js";
import { EXECUTION_CONFIG_PAGE_SIZE } from "../../execution-config-retired.js";
import { SESSION_VALUES_PAGE_SIZE } from "../../session-values-retired.js";
import { SESSION_HARNESS_PAGE_SIZE } from "../../session-harness-state-moved.js";
import { ETAG_STAMP_PAGE_SIZE } from "../../resource-etags-stamped.js";
import { LABEL_TAG_REPORT_PAGE_SIZE } from "../../label-tag-report.js";
import { etagOf, stampEtag, storedEtagOf } from "../../etag.js";
import { currentSessionRow, sessionRowWithValues } from "../../__tests__/retired-session-rows.js";
import { HISTORY_PAGE_SIZE } from "../../organization-slug-history.js";
import { PUBLIC_ROW_KINDS_AT_RETIREMENT } from "../../public-visibility-retired.js";
import { WORKFLOW_RETIREMENT_PAGE_SIZE } from "../../workflow-instance-retired.js";
import { PLATFORM_CLIENT_RETIRED_PAGE_SIZE } from "../../platform-client-retired.js";
import { EVAL_KINDS_RETIRED_PAGE_SIZE } from "../../eval-kinds-retired.js";
import { retiredPlatformClientRow } from "../../__tests__/retired-platform-client-rows.js";
import {
  AGENT_RUN_RETIRED_PAGE_SIZE,
  RETIRED_WORKFLOW_KINDS,
  WORKFLOW_CHILD_ENDED_ERROR,
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
import { agentExecutionListIndex } from "../../../domain/run/list-index.js";
import { grantListIndex } from "../../../domain/grant/list-index.js";
import { newResourceGrantStore } from "../../../domain/grant/resource-store.js";
import { DuplicateGrantError } from "../../../domain/grant/store.js";
import { KIND_TABLES, KIND_RENAME_PAGE_SIZE } from "../../kind-rename.js";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { CHANNEL_MERGE_PAGE_SIZE } from "../../channel-kinds-merged.js";
import { MERGE_ORG, agentChannelRowBytes, shareRowBytes } from "../../__tests__/channel-merge-rows.js";
import { channelListIndex } from "../../../domain/channel/list-index.js";
import { buildChannelAgentProfile, loadLinkedChannel } from "../../../domain/channel/steps.js";
import {
  AGENT_RUN_NAMES,
  EXECUTION_NAMES,
  RUN_NAMES,
  RUN_RENAME_ORG,
  runBytes,
} from "../../__tests__/run-rename-rows.js";

const cleanups: Array<() => void | Promise<void>> = [];

/** `resource` as the head's store answers it: stamped with its etag (v34). */
function withEtag<Desc extends DescMessage>(schema: Desc, resource: MessageShape<Desc>): MessageShape<Desc> {
  stampEtag(schema, resource);
  return resource;
}

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
      "routine_fires",
      "pending_oauth_state",
      "resource_names",
      "organization_deletions",
      "grant_history",
      "grant_history_heads",
    ]) {
      expect(tables, `table ${expected} should exist`).toContain(expected);
    }
    expect(tables, "v13 replaced the slug ledger").not.toContain(
      "organization_slugs",
    );
    for (const dropped of ["workflow_execution_events", "signal_dedupe"]) {
      expect(tables, `v19 dropped ${dropped}`).not.toContain(dropped);
    }
    expect(tables, "v22 dropped oauth_grant").not.toContain("oauth_grant");
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42,
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
    // gone with the workflows (v19), and the sign-in grant table with the
    // environments (v22); the pending sign-in state, ten-minute rows, is
    // recreated empty in its address shape (v24).
    expect(tableNames(db)).not.toContain("workflow_execution_events");
    expect(tableNames(db)).not.toContain("signal_dedupe");
    expect(tableNames(db)).not.toContain("oauth_grant");

    const pending = db
      .prepare(`SELECT count(*) AS n FROM pending_oauth_state`)
      .get() as { n: number };
    expect(pending.n).toBe(0);

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
      await import("@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb");
    const { ApiResourceKind } =
      await import("@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb");
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
    runMigrations(migrating, SCHEMA_VERSION_7);
    migrating.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    const row = db
      .prepare(
        `SELECT state, org, token_auth_method FROM pending_oauth_state WHERE state = 'old-state'`,
      )
      .get() as { state: string; org: string; token_auth_method: string };
    expect(row).toEqual({ state: "old-state", org: "", token_auth_method: "" });
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_7);
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
      .run(
        "organization",
        "acme",
        toBinary(OrganizationSchema, create(OrganizationSchema, { metadata: { id: "acme", slug: "acme" } })),
      );
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
      insert(setup, "iam_policy", policy.id, grantRow(policy));
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
    expect(data(db, "iam_policy", "iam_on_agent")).toEqual(grantRow(onAgent));
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
      insert(db, "iam_policy", grant.id, grantRow(grant));
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
    const grantIds = (table: string) =>
      (
        db
          .prepare(`SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`)
          .all() as Array<{ id: string }>
      ).map((r) => r.id);
    expect(grantIds("resources")).toEqual([keptGrant.id]);
    expect(grantIds("resource_list_keys")).toEqual([keptGrant.id]);
    expect(row(db, "iam_policy", keptGrant.id)).toEqual({
      data: grantRow(keptGrant),
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
        grantRow({
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
    insert(setup, "iam_policy", "iam_a_retired", grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }));
    insert(setup, "iam_policy", "iam_z_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_17)).toThrow(
      "iam_policy 'iam_z_broken' cannot be read to retire the workflow instance kind",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17 - 1);
    expect(row(db, "iam_policy", "iam_a_retired").data).toEqual(
      grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }),
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
      grantRow({
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
  const keptGrant = grantBeforeV34({
    principal: "identity_account:ida_3",
    relation: "viewer",
    resource: "agent:agt_1",
  });

  it("renames the run kind in every table, rewrites the rows that spell it and re-keys grants on runs", async () => {
    const { dbPath, db: setup } = v17Database();
    insertIndexed(setup, "agent_execution", "aex_1", runBytes("aex_1", "ses_1", EXECUTION_NAMES), {
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
      insertPlain(setup, "iam_policy", grant.id, grantRow(grant));
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
      .run(runGrant.id, grantRow(runGrant));
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
      data: runBytes("aex_1", "ses_1", AGENT_RUN_NAMES),
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

    // The grant on the run moves to the id its renamed triple derived at
    // the step's time (iamp_); its history stays under the old id. The
    // grant on the agent is untouched.
    const rekeyedId = grantIdBeforeV34({ ...runGrant, resource: "agent_run:aex_1" });
    expect(row(db, "iam_policy", runGrant.id)).toBeUndefined();
    const rekeyed = fromBinary(GrantSchema, row(db, "iam_policy", rekeyedId)!.data);
    expect(rekeyed.metadata?.id).toBe(rekeyedId);
    expect(rekeyed.spec?.resource).toMatchObject({ kind: "agent_run", id: "aex_1" });
    expect(row(db, "iam_policy", keptGrant.id)?.data).toEqual(grantRow(keptGrant));
    expect(
      db
        .prepare(`SELECT resource_id FROM resource_audit WHERE kind = 'iam_policy'`)
        .all(),
    ).toEqual([{ resource_id: runGrant.id }]);

    // The store the server opens (at the head, past v21 and v38) finds
    // the run through the key its list reads, and the grant through its
    // principal under the id v21 derived for it in turn, which v38 moved
    // to grt_.
    const headId = grantIdAfterV34({ ...runGrant, resource: "run:aex_1" });
    const store = SqliteStore.open(dbPath, undefined, {
      listIndexes: [agentExecutionListIndex, grantListIndex],
    });
    cleanups.push(() => store.close());
    const ids = async (
      index: Parameters<typeof store.queryResources>[0],
      name: string,
      value: string,
    ): Promise<string[]> =>
      (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
    expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
    expect(await ids(grantListIndex, "principal", "ida_2")).toEqual([headId]);
    expect(await ids(grantListIndex, "principal", "ida_3")).toEqual([grantIdAfterV34(keptGrant)]);
  });

  it("reads runs across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = v17Database();
    for (let i = 0; i <= KIND_RENAME_PAGE_SIZE; i++) {
      const id = `aex_page_${String(i).padStart(4, "0")}`;
      insertPlain(setup, "agent_execution", id, runBytes(id, "ses_1", EXECUTION_NAMES));
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_18);
    const last = `aex_page_${String(KIND_RENAME_PAGE_SIZE).padStart(4, "0")}`;
    expect(count(db, "resources", "agent_run")).toBe(KIND_RENAME_PAGE_SIZE + 1);
    expect(row(db, "agent_run", last)?.data).toEqual(runBytes(last, "ses_1", AGENT_RUN_NAMES));
  });

  it("a run that does not decode fails the step, names the row, and leaves the database at v17", () => {
    const { dbPath, db: setup } = v17Database();
    insertPlain(setup, "agent_execution", "aex_good", runBytes("aex_good", "ses_1", EXECUTION_NAMES));
    insertPlain(setup, "agent_execution", "aex_bad", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_18)).toThrow(/agent_execution row aex_bad/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);
    expect(row(db, "agent_execution", "aex_good")?.data).toEqual(
      runBytes("aex_good", "ses_1", EXECUTION_NAMES),
    );
  });

  it("a grant that does not decode fails the step, names the row, and leaves the database at v17", () => {
    const { dbPath, db: setup } = v17Database();
    insertPlain(setup, "iam_policy", runGrant.id, grantRow(runGrant));
    insertPlain(setup, "iam_policy", "iamp_bad", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_18)).toThrow(
      /the iam_policy row iamp_bad cannot be read for the rename of executions to runs/,
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_17);
    expect(row(db, "iam_policy", runGrant.id)?.data).toEqual(grantRow(runGrant));
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
  const keptGrant = grantBeforeV34({
    principal: "identity_account:ida_9",
    relation: "viewer",
    resource: "agent:agt_1",
  });

  /** The agent, its session and their name, which every arm keeps. */
  function seedAgents(db: DatabaseSync): void {
    insert(db, "agent", "agt_1", agent);
    insert(db, "session", "ses_1", session);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('agent', ?, 'reviewer', 'agt_1', 'current', ?)`,
    ).run(ORG, SEEDED_AT);
    insert(db, "iam_policy", keptGrant.id, grantRow(keptGrant));
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
      insert(db, "iam_policy", grant.id, grantRow(grant));
      listKey(db, "iam_policy", grant.id, "principal", grant.principal.split(":")[1] ?? "");
    }
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_workflow', ?, '', '')`,
    ).run(grantRow(grants[0]!));
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

  /**
   * A plain agent run, one a workflow step started, one a workflow step
   * started that was still waiting on an approval, and one still running
   * that carries the link as every release through 3.41 wrote it, under the
   * kind string given.
   */
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
    insert(
      db,
      kind,
      "aex_waiting",
      agentRunRow({
        id: "aex_waiting",
        kindString,
        org: ORG,
        sessionId: "ses_1",
        parent: "wex_direct",
        phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
      }),
    );
    insert(
      db,
      kind,
      "aex_released",
      agentRunRow({
        id: "aex_released",
        kindString,
        org: ORG,
        sessionId: "ses_1",
        labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
        released: { callbackToken: TOKEN, parentWorkflowId: "wex_direct", activityTaskQueue: "wfexec:wex_direct" },
        phase: RunPhase.RUN_IN_PROGRESS,
      }),
    );
  }

  /**
   * The state every arm reaches at head: no row of a retired kind in any
   * table keyed by kind, no grant naming one (their history kept), both
   * workflow tables gone, and the agent, its session and both runs read
   * back unchanged, the parented run without what the workflow left on it,
   * and the unfinished parented run ended FAILED with the reason.
   */
  async function expectRetired(dbPath: string): Promise<DatabaseSync> {
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_19);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_19);
    for (const table of KIND_TABLES) {
      for (const kind of GONE_KINDS) {
        expect(count(db, table, kind), `${kind} in ${table}`).toBe(0);
      }
    }
    const policies = db
      .prepare(`SELECT id, data FROM resources WHERE kind = 'iam_policy' ORDER BY id`)
      .all() as Array<{ id: string; data: Uint8Array }>;
    expect(policies.map((p) => p.id)).toEqual([keptGrant.id]);
    for (const policy of policies) {
      const spec = fromBinary(GrantSchema, policy.data).spec;
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
    const waitingBytes = data(db, "agent_run", "aex_waiting");
    expect(waitingBytes, "the unfinished parented run is kept").toBeDefined();
    const waiting = fromBinary(RunSchema, waitingBytes!);
    expect(waiting.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(waiting.status?.error).toBe(WORKFLOW_CHILD_ENDED_ERROR);
    expect(Number.isNaN(Date.parse(waiting.status?.completedAt ?? ""))).toBe(false);
    expect(waiting.spec?.$unknown).toBeUndefined();
    expect(data(db, "agent_run", "aex_released"), "the released link is stripped and the run ended").toEqual(
      agentRunRow({
        id: "aex_released",
        org: ORG,
        sessionId: "ses_1",
        labels: OWN_LABELS,
        phase: RunPhase.RUN_FAILED,
        error: WORKFLOW_CHILD_ENDED_ERROR,
        completedAt: waiting.status?.completedAt,
      }),
    );

    // The store the server opens migrates on to the head (v21 renames the
    // kind) and reads every kept run as a run.
    const store = SqliteStore.open(dbPath, undefined, {
      listIndexes: [CONTRACT_SESSION_INDEX, agentExecutionListIndex, grantListIndex],
    });
    cleanups.push(() => store.close());
    // v34 stamps each kept run with its etag.
    expect(
      await store.getResource(ApiResourceKind.run, "aex_parented", RunSchema),
    ).toEqual(
      withEtag(
        RunSchema,
        fromBinary(
          RunSchema,
          agentRunRow({ id: "aex_parented", kindString: "Run", org: ORG, sessionId: "ses_1", labels: OWN_LABELS }),
        ),
      ),
    );
    expect(
      await store.getResource(ApiResourceKind.run, "aex_plain", RunSchema),
    ).toEqual(
      withEtag(RunSchema, fromBinary(RunSchema, agentRunRow({ id: "aex_plain", kindString: "Run", org: ORG, sessionId: "ses_1" }))),
    );
    expect(
      (
        await store.queryResources(agentExecutionListIndex, {
          anyKey: [{ name: "session", value: "ses_1" }],
        })
      )
        .map((r) => r.id)
        .sort(),
    ).toEqual(["aex_parented", "aex_plain", "aex_released", "aex_waiting"]);
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
      grantRow({
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
        grantRow({
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
    runMigrations(db, SCHEMA_VERSION_19);
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
      const retired = grantRow({
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

describe("v20: every identity account's slug and name held to their rules", () => {
  function accountBytes(id: string, name: string, slug: string): Uint8Array {
    return toBinary(
      IdentityAccountSchema,
      create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id, name, slug, org: "acme" },
        spec: { idpId: `auth0|${id}`, email: name },
      }),
    );
  }

  function slugOf(db: DatabaseSync, id: string): string {
    const row = db
      .prepare(`SELECT data FROM resources WHERE kind = 'identity_account' AND id = ?`)
      .get(id) as { data: Uint8Array };
    return fromBinary(IdentityAccountSchema, row.data).metadata?.slug ?? "";
  }

  it("repairs a slug too long, one starting with a digit, and an empty one, and leaves a valid one byte for byte", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_19);
    const insert = setup.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', ?, ?, '2026-09-01 00:00:00')`,
    );
    const valid = accountBytes("ida_valid", "pat@example.com", "patexample-com");
    insert.run("ida_valid", valid);
    insert.run("ida_long", accountBytes("ida_long", `${"x".repeat(70)}@example.com`, `${"x".repeat(70)}example-com`));
    insert.run("ida_digit", accountBytes("ida_digit", "2024intern@acme.com", "2024internacme-com"));
    insert.run("ida_empty", accountBytes("ida_empty", "李明", ""));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_20);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_20);
    expect(slugOf(db, "ida_long")).toMatch(/^x{54}-[0-9a-f]{8}$/);
    expect(slugOf(db, "ida_digit")).toBe("a-2024internacme-com");
    expect(slugOf(db, "ida_empty")).toBe("auth0idaempty");
    expect(
      db.prepare(`SELECT data, updated_at FROM resources WHERE id = 'ida_valid'`).get(),
    ).toEqual({ data: valid, updated_at: "2026-09-01 00:00:00" });
  });

  it("cuts a name longer than 200 characters to 200 and keeps the slug it already had", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_19);
    const longName = `${"n".repeat(230)}@example.com`;
    setup
      .prepare(
        `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', 'ida_name', ?, '2026-09-01 00:00:00')`,
      )
      .run(accountBytes("ida_name", longName, "long-name-person"));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_20);

    const row = db
      .prepare(`SELECT data FROM resources WHERE kind = 'identity_account' AND id = 'ida_name'`)
      .get() as { data: Uint8Array };
    const repaired = fromBinary(IdentityAccountSchema, row.data);
    expect(repaired.metadata?.name).toBe(longName.slice(0, 200));
    expect(repaired.metadata?.slug).toBe("long-name-person");
    expect(repaired.spec?.email).toBe(longName);
  });

  it("stops at a row it cannot decode, naming the row, and leaves the database at v19", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_19);
    // Field 1, length-delimited, claims 5 bytes and carries 1.
    setup
      .prepare(
        `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', 'ida_corrupt', ?, '2026-09-01 00:00:00')`,
      )
      .run(new Uint8Array([0x0a, 0x05, 0x01]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_20)).toThrow(
      "identity_account 'ida_corrupt' cannot have its slug repaired",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_19);
  });
});

describe("v21: the agent run is a run", () => {
  const SEEDED_AT = "2026-10-07 00:00:00";

  /** A database at `version`: the chain replayed up to it. */
  function databaseAt(version: number): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, version);
    expect(getSchemaVersion(setup)).toBe(version);
    return { dbPath, db: setup };
  }

  function insertRow(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at, list_org, list_created_at, list_index_revision, list_indexed_at)
       VALUES (?, ?, ?, ?, ?, '', 1, ?)`,
    ).run(kind, id, data, SEEDED_AT, RUN_RENAME_ORG, SEEDED_AT);
  }

  function row(db: DatabaseSync, kind: string, id: string): { data: Uint8Array; updated_at: string } | undefined {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string } | undefined;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  const runGrant = (kind: string) => ({
    id: "iamp_on_run",
    principal: "identity_account:ida_2",
    relation: "viewer",
    resource: `${kind}:aex_1`,
  });
  const ownerGrant = (kind: string) => ({
    id: "iamp_run_principal",
    principal: `${kind}:aex_1`,
    relation: "viewer",
    resource: "session:ses_1",
  });
  const keptGrant = grantBeforeV34({
    principal: "identity_account:ida_3",
    relation: "viewer",
    resource: "agent:agt_1",
  });
  // The id v21 re-keys a grant to: its triple's, under the prefix of the step's time.
  const stepId = (grant: { principal: string; relation: string; resource: string }) =>
    grantIdBeforeV34(grant);

  /** Seeds one run of `kind` the way that release stored it, with its audit, list key, name and grants. */
  function seedRun(db: DatabaseSync, kind: string, names: typeof AGENT_RUN_NAMES): Uint8Array {
    insertRow(db, kind, "aex_1", runBytes("aex_1", "ses_1", names));
    const audit = new Uint8Array([0x0a, 0x01, 0x62]);
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES (?, 'aex_1', ?, '', '')`,
    ).run(kind, audit);
    db.prepare(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, 'aex_1', 'session', 'ses_1', '')`,
    ).run(kind);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, 'aex_1', 'aex_1', 'current', ?)`,
    ).run(kind, RUN_RENAME_ORG, SEEDED_AT);
    for (const grant of [runGrant(kind), ownerGrant(kind), keptGrant]) {
      db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', ?, ?, ?)`).run(
        grant.id,
        grantRow(grant),
        SEEDED_AT,
      );
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
      ).run(grant.id, grant.principal.split(":")[1] ?? "");
    }
    return audit;
  }

  /** What every store reaching the head from before v21 holds, read raw and through the store. */
  async function expectRuns(dbPath: string, audit: Uint8Array): Promise<void> {
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_21);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_21);
    for (const table of KIND_TABLES) {
      expect(count(db, table, "agent_run"), table).toBe(0);
      expect(count(db, table, "agent_execution"), table).toBe(0);
    }
    expect(row(db, "run", "aex_1")).toEqual({ data: runBytes("aex_1", "ses_1", RUN_NAMES), updated_at: SEEDED_AT });
    expect(db.prepare(`SELECT kind, data FROM resource_audit WHERE resource_id = 'aex_1'`).all()).toEqual([
      { kind: "run", data: audit },
    ]);
    expect(db.prepare(`SELECT kind, name FROM resource_names WHERE id = 'aex_1'`).all()).toEqual([
      { kind: "run", name: "aex_1" },
    ]);
    const onRun = stepId(runGrant("run"));
    const ofRun = stepId(ownerGrant("run"));
    const policies = (db.prepare(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id`).all() as Array<{
      id: string;
    }>).map((p) => p.id);
    expect(policies).toEqual([keptGrant.id, ofRun, onRun].sort());
    expect(fromBinary(GrantSchema, row(db, "iam_policy", onRun)!.data).spec?.resource).toMatchObject({
      kind: "run",
      id: "aex_1",
    });
    expect(fromBinary(GrantSchema, row(db, "iam_policy", ofRun)!.data).spec?.principal).toMatchObject({
      kind: "run",
      id: "aex_1",
    });
    expect(row(db, "iam_policy", keptGrant.id)?.data).toEqual(grantRow(keptGrant));

    const store = SqliteStore.open(dbPath, undefined, { listIndexes: [agentExecutionListIndex, grantListIndex] });
    cleanups.push(() => store.close());
    const run = await store.getResource(ApiResourceKind.run, "aex_1", RunSchema);
    expect(run?.kind).toBe("Run");
    expect(run?.metadata?.id).toBe("aex_1");
    const ids = async (index: Parameters<typeof store.queryResources>[0], name: string, value: string) =>
      (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
    expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
    // The head (v38) moves both to their grt_ ids.
    expect(await ids(grantListIndex, "principal", "ida_2")).toEqual([grantIdAfterV34(runGrant("run"))]);
    expect(await ids(grantListIndex, "principal", "ida_3")).toEqual([grantIdAfterV34(keptGrant)]);
  }

  it("renames the run kind in every table, rewrites the rows that spell it and re-keys grants on runs, from a store at v20", async () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_20);
    const audit = seedRun(setup, "agent_run", AGENT_RUN_NAMES);
    setup.close();
    await expectRuns(dbPath, audit);
  });

  it("reaches the same rows from a store at v17, before the run kind's first rename", async () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_18 - 1);
    const audit = seedRun(setup, "agent_execution", EXECUTION_NAMES);
    setup.close();
    await expectRuns(dbPath, audit);
  });

  it("reads runs across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_20);
    setup.exec("BEGIN");
    for (let i = 0; i <= KIND_RENAME_PAGE_SIZE; i++) {
      // Mixed case and punctuation: the keyset holds in byte order.
      const id = `${i % 2 === 0 ? "aex_" : "AEX-"}${String(i).padStart(4, "0")}`;
      insertRow(setup, "agent_run", id, runBytes(id, "ses_1", AGENT_RUN_NAMES));
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_21);
    expect(count(db, "resources", "run")).toBe(KIND_RENAME_PAGE_SIZE + 1);
    for (let i = 0; i <= KIND_RENAME_PAGE_SIZE; i++) {
      const id = `${i % 2 === 0 ? "aex_" : "AEX-"}${String(i).padStart(4, "0")}`;
      expect(row(db, "run", id)?.data, id).toEqual(runBytes(id, "ses_1", RUN_NAMES));
    }
  });

  it.each([
    ["agent_run", "aex_bad"],
    ["iam_policy", "iamp_bad"],
  ])("the %s row %s does not decode: the step fails, names the row, and leaves the database at v20", (kind, id) => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_20);
    insertRow(setup, "agent_run", "aex_good", runBytes("aex_good", "ses_1", AGENT_RUN_NAMES));
    insertRow(setup, kind, id, new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_21)).toThrow(
      new RegExp(`the ${kind} row ${id} cannot be read for the rename of the agent run to a run`),
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_20);
    expect(row(db, "agent_run", "aex_good")?.data).toEqual(runBytes("aex_good", "ses_1", AGENT_RUN_NAMES));
  });
});

describe("v22: environments and the sign-in grant table leave the store", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-08 00:00:00";

  function databaseAt(version: number): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, version);
    expect(getSchemaVersion(setup)).toBe(version);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  /** An environment row's bytes: the step never decodes them, so any envelope serves. */
  const environmentBytes = new Uint8Array([0x12, 0x0b, ...new TextEncoder().encode("Environment")]);
  const agent = toBinary(
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id: "agt_1", name: "reviewer", slug: "reviewer", org: ORG },
      spec: { instructions: "a conformant instruction body" },
    }),
  );
  const keptGrant = { id: "iamp_kept", principal: "identity_account:ida_9", relation: "viewer", resource: "agent:agt_1" };
  const retiredGrants = [
    { id: "iamp_on_env", principal: "identity_account:ida_1", relation: "viewer", resource: "environment:env_shared" },
    { id: "iamp_env_principal", principal: "environment:env_shared", relation: "viewer", resource: "agent:agt_1" },
  ];

  function seed(db: DatabaseSync): void {
    insert(db, "agent", "agt_1", agent);
    for (const id of ["env_personal", "env_shared"]) {
      insert(db, "environment", id, environmentBytes);
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('environment', ?, 'org', ?, '')`,
      ).run(id, ORG);
      db.prepare(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('environment', ?, ?, '', '')`,
      ).run(id, environmentBytes);
      db.prepare(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('environment', ?, ?, ?, 'current', ?)`,
      ).run(ORG, id, id, SEEDED_AT);
    }
    for (const grant of [keptGrant, ...retiredGrants]) {
      insert(db, "iam_policy", grant.id, grantRow(grant));
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
      ).run(grant.id, grant.principal.split(":")[1] ?? "");
    }
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iamp_on_env', ?, '', '')`,
    ).run(grantRow(retiredGrants[0]!));
    db.prepare(
      `INSERT INTO oauth_grant (identity_account_id, resource_id, org_id, environment_id, created_at, updated_at)
       VALUES ('', 'mcp_1', ?, 'env_managed', 1, 1)`,
    ).run(ORG);
    db.prepare(
      `INSERT INTO pending_oauth_state (state, code_verifier, mcp_server_id, identity_account_id, created_at)
       VALUES ('state-1', 'verifier', 'mcp_1', 'ida_1', 1)`,
    ).run();
  }

  it("removes every environment row and grant, drops oauth_grant, keeps the rest", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_21);
    seed(setup);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_22);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_22);
    for (const table of KIND_TABLES) {
      expect(count(db, table, "environment"), `environment in ${table}`).toBe(0);
    }
    const policies = db
      .prepare(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(policies.map((p) => p.id)).toEqual([keptGrant.id]);
    const grantKeys = db
      .prepare(`SELECT id FROM resource_list_keys WHERE kind = 'iam_policy' ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(grantKeys.map((k) => k.id)).toEqual([keptGrant.id]);
    // A removed grant keeps its history, as the store deletes a policy.
    expect(count(db, "resource_audit", "iam_policy")).toBe(1);
    const kept = db.prepare(`SELECT data FROM resources WHERE kind = 'agent' AND id = 'agt_1'`).get() as {
      data: Uint8Array;
    };
    expect(Buffer.from(kept.data).equals(Buffer.from(agent))).toBe(true);
    expect(tableNames(db)).not.toContain("oauth_grant");
    expect(tableNames(db)).toContain("pending_oauth_state");
    expect(
      db.prepare(`SELECT state, vault_id, tool_address FROM pending_oauth_state`).all(),
      "a pending sign-in from before the step saves into the signer's My vault, at no recorded address",
    ).toEqual([{ state: "state-1", vault_id: "", tool_address: "" }]);
  });

  it("reads grants across keyset pages", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_21);
    const total = ENVIRONMENT_RETIRED_PAGE_SIZE + 3;
    for (let i = 0; i < total; i++) {
      const id = `iamp_${String(i).padStart(4, "0")}`;
      const resource = i % 2 === 0 ? `environment:env_${i}` : "agent:agt_1";
      insert(setup, "iam_policy", id, grantRow({ id, principal: "identity_account:ida_1", relation: "viewer", resource }));
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_22);

    expect(count(db, "resources", "iam_policy")).toBe(Math.floor(total / 2));
  });

  it("fails on a grant it cannot decode, naming it, and leaves the database at v21", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_21);
    insert(setup, "environment", "env_1", environmentBytes);
    insert(setup, "iam_policy", "iamp_bad", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_22)).toThrow(/iam_policy 'iamp_bad'/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_21);
    expect(count(db, "resources", "environment")).toBe(1);
    expect(tableNames(db)).toContain("oauth_grant");
  });
});

describe("v23: a conversation's retired own secrets and connections leave every session row", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-09 00:00:00";

  function databaseAt(version: number): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, version);
    expect(getSchemaVersion(setup)).toBe(version);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function row(db: DatabaseSync, kind: string, id: string): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string };
  }

  /** A conversation as the current release writes it: a repository token, vaults and My vault. */
  const conversation = (id: string) => ({
    metadata: { id, org: ORG, slug: id },
    spec: {
      vaults: [{ kind: ApiResourceKind.vault, org: ORG, slug: "team" }],
      includeMyVault: true,
      workspaceEntries: [
        {
          name: "app",
          source: {
            source: {
              case: "gitRepo" as const,
              value: { url: "https://github.com/acme/app", token: "enc:v1:repo" },
            },
          },
        },
      ],
    },
    status: { vaultAttachers: { vlt_team: "ida_ana" } },
  });
  const retired = {
    secrets: { API_KEY: "enc:v1:secret" },
    connections: { "https://mcp.example.com/mcp": "enc:v1:login" },
  };

  it("drops the retired fields from every session, keeps its stamp and every other field, and leaves the rest byte for byte", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_22);
    insert(setup, "session", "ses_held", sessionRowWithValues(conversation("ses_held"), retired));
    const untouched = currentSessionRow(conversation("ses_clean"));
    insert(setup, "session", "ses_clean", untouched);
    const agent = toBinary(
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", name: "reviewer", slug: "reviewer", org: ORG },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    insert(setup, "agent", "agt_1", agent);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_23);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_23);
    const held = row(db, "session", "ses_held");
    expect(held.data).toEqual(currentSessionRow(conversation("ses_held")));
    expect(held.updated_at).toBe(SEEDED_AT);
    expect(Buffer.from(row(db, "session", "ses_clean").data).equals(Buffer.from(untouched))).toBe(true);
    expect(Buffer.from(row(db, "agent", "agt_1").data).equals(Buffer.from(agent))).toBe(true);
  });

  it("reads every page of sessions", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_22);
    for (let i = 0; i <= SESSION_VALUES_PAGE_SIZE; i++) {
      const id = `ses_${String(i).padStart(4, "0")}`;
      insert(setup, "session", id, sessionRowWithValues(conversation(id), retired));
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_23);
    const last = `ses_${String(SESSION_VALUES_PAGE_SIZE).padStart(4, "0")}`;
    expect(row(db, "session", last).data).toEqual(currentSessionRow(conversation(last)));
  });

  it("an unreadable session fails the step, rolls back the sessions it rewrote, and leaves the database at v22", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_22);
    // A readable session ahead of the unreadable one in id order is
    // rewritten first; the failure must take that rewrite back.
    const good = sessionRowWithValues(conversation("ses_a_good"), retired);
    insert(setup, "session", "ses_a_good", good);
    insert(setup, "session", "ses_b_bad", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_23)).toThrow("session 'ses_b_bad'");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_22);
    expect(row(db, "session", "ses_a_good").data).toEqual(good);
  });
});

describe("v24: a sign-in starts from an address", () => {
  it("recreates the pending sign-in state empty in its new shape, and adds the client registrations and Connect links", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_23);
    setup
      .prepare(
        `INSERT INTO pending_oauth_state (state, code_verifier, mcp_server_id, identity_account_id, created_at)
         VALUES ('in-flight', 'enc:v1:v', 'mcp_1', 'ida_1', 1700000000)`,
      )
      .run();
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_24);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_24);

    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(db.prepare(`SELECT count(*) AS n FROM pending_oauth_state`).get()).toEqual({ n: 0 });
    expect(columns("pending_oauth_state")).toEqual(
      expect.arrayContaining(["address", "login_app", "resource", "client_registration", "connect_link"]),
    );
    expect(columns("pending_oauth_state")).not.toContain("mcp_server_id");
    expect(columns("oauth_client_registration")).toEqual(["login_server", "redirect_uri", "client_id", "created_at"]);
    expect(columns("connect_link")).toEqual([
      "token_hash",
      "org",
      "vault_id",
      "address",
      "return_url",
      "created_by",
      "created_by_class",
      "created_by_bound_org",
      "created_at",
      "expires_at",
      "used_at",
    ]);
    // Every new link sweeps expired ones by expiry.
    const indexes = (db.prepare(`PRAGMA index_list(connect_link)`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_connect_link_expires", "idx_connect_link_vault", "idx_connect_link_org"]));
  });
});

describe("v25: the execution context rows leave the store; a connect in flight is an attempt row", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-10 00:00:00";
  const contextBytes = new Uint8Array([0x12, 0x10, ...new TextEncoder().encode("ExecutionContext")]);
  const otherBytes = new Uint8Array([0x12, 0x05, ...new TextEncoder().encode("Agent")]);

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  it("deletes every execution context row from every table keyed by kind, leaves other kinds, and creates the attempt table", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_24);
    for (const [kind, id, data] of [
      ["execution_context", "ectx_1", contextBytes],
      ["agent", "agt_1", otherBytes],
    ] as const) {
      setup.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`).run(kind, id, data, SEEDED_AT);
      setup
        .prepare(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, 'org', ?, '')`)
        .run(kind, id, ORG);
      setup
        .prepare(`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES (?, ?, ?, '', '')`)
        .run(kind, id, data);
      setup
        .prepare(`INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, ?, ?, 'current', ?)`)
        .run(kind, ORG, id, id, SEEDED_AT);
    }
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_25);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_25);
    for (const table of ["resources", "resource_list_keys", "resource_audit", "resource_names"]) {
      expect(count(db, table, "execution_context"), table).toBe(0);
      expect(count(db, table, "agent"), table).toBe(1);
    }
    const columns = (db.prepare(`PRAGMA table_info(connect_attempt)`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toEqual([
      "id",
      "org",
      "created_by",
      "person",
      "mcp_server_id",
      "run_id",
      "created_at",
      "expires_at",
    ]);
    // Each new connect sweeps expired attempts by expiry; a purge removes an organization's.
    const indexes = (db.prepare(`PRAGMA index_list(connect_attempt)`).all() as Array<{ name: string }>).map(
      (index) => index.name,
    );
    expect(indexes).toEqual(expect.arrayContaining(["idx_connect_attempt_expires", "idx_connect_attempt_org"]));
  });
});

describe("v33 and v34: a session's harness state moves to its status, and every resource gains its etag", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-13 00:00:00";

  const conversation = (id: string) => ({
    metadata: { id, org: ORG, slug: id },
    spec: { agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "helper" }, subject: "Fix the build" },
  });
  const reviewer = (id: string) =>
    create(AgentSchema, {
      metadata: { id, org: ORG, slug: id, name: "Reviewer" },
      spec: { instructions: "Review every pull request." },
    });

  function databaseAt(version: number): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, version);
    expect(getSchemaVersion(setup)).toBe(version);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function row(db: DatabaseSync, kind: string, id: string): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string };
  }

  function reopen(dbPath: string): DatabaseSync {
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    return db;
  }

  it("v33 moves a Cursor session's harness id and history to its status, keeps its stamp, and leaves the rest byte for byte", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_32);
    insert(
      setup,
      "session",
      "ses_cursor",
      sessionRowWithValues(conversation("ses_cursor"), {
        harnessStateId: "agent-7f3c",
        harnessStateIdHistory: ["agent-1a2b"],
      }),
    );
    const untouched = currentSessionRow(conversation("ses_new"));
    insert(setup, "session", "ses_new", untouched);
    setup.close();

    const db = reopen(dbPath);
    runMigrations(db, SCHEMA_VERSION_33);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_33);
    const moved = row(db, "session", "ses_cursor");
    expect(moved.data).toEqual(
      currentSessionRow({
        ...conversation("ses_cursor"),
        status: { harnessStateId: "agent-7f3c", harnessStateIdHistory: ["agent-1a2b"] },
      }),
    );
    expect(moved.updated_at).toBe(SEEDED_AT);
    expect(Buffer.from(row(db, "session", "ses_new").data).equals(Buffer.from(untouched))).toBe(true);
  });

  it("v33 reads sessions across pages, and an unreadable one rolls the step back", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_32);
    for (let i = 0; i <= SESSION_HARNESS_PAGE_SIZE; i++) {
      const id = `ses_${String(i).padStart(4, "0")}`;
      insert(setup, "session", id, sessionRowWithValues(conversation(id), { harnessStateId: `thread-${i}` }));
    }
    const good = sessionRowWithValues(conversation("ses_a_good"), { harnessStateId: "thread-a" });
    insert(setup, "session", "ses_a_good", good);
    insert(setup, "session", "ses_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));
    setup.close();

    const db = reopen(dbPath);
    expect(() => runMigrations(db, SCHEMA_VERSION_33)).toThrow("session 'ses_zz_bad'");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_32);
    expect(row(db, "session", "ses_a_good").data).toEqual(good);

    db.prepare(`DELETE FROM resources WHERE kind = 'session' AND id = 'ses_zz_bad'`).run();
    runMigrations(db, SCHEMA_VERSION_33);
    const last = `ses_${String(SESSION_HARNESS_PAGE_SIZE).padStart(4, "0")}`;
    expect(fromBinary(SessionSchema, row(db, "session", last).data).status?.harnessStateId).toBe(
      `thread-${SESSION_HARNESS_PAGE_SIZE}`,
    );
  });

  it("v34 stamps every resource of every kind with its etag across pages, keeps its stamp, and leaves an unknown kind's rows alone", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_33);
    for (let i = 0; i <= ETAG_STAMP_PAGE_SIZE; i++) {
      const id = `agt_${String(i).padStart(4, "0")}`;
      insert(setup, "agent", id, toBinary(AgentSchema, reviewer(id)));
    }
    insert(setup, "session", "ses_1", currentSessionRow(conversation("ses_1")));
    const foreign = new Uint8Array([0x0a, 0x01, 0x61]);
    insert(setup, "retired_kind", "rk_1", foreign);
    setup.close();

    const db = reopen(dbPath);
    runMigrations(db, SCHEMA_VERSION_34);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_34);
    const last = `agt_${String(ETAG_STAMP_PAGE_SIZE).padStart(4, "0")}`;
    const agent = row(db, "agent", last);
    expect(fromBinary(AgentSchema, agent.data).metadata?.etag).toBe(etagOf(AgentSchema, reviewer(last)));
    expect(agent.updated_at).toBe(SEEDED_AT);
    expect(fromBinary(SessionSchema, row(db, "session", "ses_1").data).metadata?.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(row(db, "retired_kind", "rk_1").data).equals(Buffer.from(foreign))).toBe(true);
  });

  it("v34 leaves a resource that does not decode as it is, stamps the rest, and reports it once", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_33);
    insert(setup, "agent", "agt_a_good", toBinary(AgentSchema, reviewer("agt_a_good")));
    const bad = new Uint8Array([0xff, 0xff, 0xff]);
    insert(setup, "agent", "agt_b_bad", bad);
    insert(setup, "agent", "agt_c_good", toBinary(AgentSchema, reviewer("agt_c_good")));
    setup.close();

    const db = reopen(dbPath);
    const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    runMigrations(db, SCHEMA_VERSION_34, {
      debug() {},
      info() {},
      warn(message, fields) {
        warned.push({ message, fields });
      },
    });

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_34);
    expect(Buffer.from(row(db, "agent", "agt_b_bad").data).equals(Buffer.from(bad))).toBe(true);
    for (const id of ["agt_a_good", "agt_c_good"]) {
      expect(fromBinary(AgentSchema, row(db, "agent", id).data).metadata?.etag, id).toBe(etagOf(AgentSchema, reviewer(id)));
    }
    expect(warned).toEqual([
      {
        message: "rows that do not decode were left without an etag",
        fields: { kind: "agent", count: 1, ids: ["agt_b_bad"] },
      },
    ]);
  });

  it("v35 indexes the permission history in retention's order and keeps every entry", () => {
    const { dbPath, db: setup } = databaseAt(SCHEMA_VERSION_34);
    setup
      .prepare(
        `INSERT INTO iam_policy_history
           (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
            principal_kind, principal_id, relation, resource_kind, resource_id, data)
         VALUES ('acme', 1, '2026-01-01T00:00:00.000Z', 'granted', 'grant', 'ida_ana', 'user',
                 'iamp_1', 'identity_account', 'ida_ana', 'member', 'organization', 'acme', x'00')`,
      )
      .run();
    setup.close();

    const db = reopen(dbPath);
    runMigrations(db, SCHEMA_VERSION_35);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_35);
    const columns = db.prepare(`PRAGMA index_info('iam_policy_history_by_time')`).all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual(["occurred_at", "org", "sequence"]);
    expect(db.prepare(`SELECT org, sequence FROM iam_policy_history`).all()).toEqual([
      { org: "acme", sequence: 1 },
    ]);
  });
});

describe("v36: the stored labels, tags and annotations the new rules refuse are reported", () => {
  const ORG = "org_01jz0000000000000000000000";
  const reviewer = (id: string, metadata: { labels?: Record<string, string>; tags?: string[] } = {}) =>
    create(AgentSchema, {
      metadata: { id, org: ORG, slug: id, name: "Reviewer", ...metadata },
      spec: { instructions: "Review every pull request." },
    });

  /** An agent's bytes whose metadata also carries field 7, as a row written before annotations were removed. */
  function withStoredAnnotations(id: string): Uint8Array {
    const resource = reviewer(id);
    const entry = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("note")
      .tag(2, WireType.LengthDelimited)
      .string("kept")
      .finish();
    resource.metadata!.$unknown = [
      { no: 7, wireType: WireType.LengthDelimited, data: new BinaryWriter().bytes(entry).finish() },
    ];
    return toBinary(AgentSchema, resource);
  }

  it("names each kind's offenders once, with counts across pages, and leaves every row byte for byte", () => {
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_35);
    const seeded = new Map<string, Uint8Array>();
    const insert = db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent', ?, ?, '2026-10-14 00:00:00')`,
    );
    const plant = (id: string, data: Uint8Array) => {
      seeded.set(id, data);
      insert.run(id, data);
    };
    plant("agt_0_clean", toBinary(AgentSchema, reviewer("agt_0_clean", { labels: { team: "support" }, tags: ["prod"] })));
    plant("agt_1_label", toBinary(AgentSchema, reviewer("agt_1_label", { labels: { "-team": "support" } })));
    plant("agt_2_note", withStoredAnnotations("agt_2_note"));
    plant("agt_2_unreadable", new Uint8Array([0xff, 0xff, 0xff]));
    for (let i = 0; i <= LABEL_TAG_REPORT_PAGE_SIZE; i++) {
      const id = `agt_3_tag_${String(i).padStart(4, "0")}`;
      plant(id, toBinary(AgentSchema, reviewer(id, { tags: ["SEC filings"] })));
    }
    const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    runMigrations(db, SCHEMA_VERSION_36, {
      debug() {},
      info() {},
      warn(message, fields) {
        warned.push({ message, fields });
      },
    });

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_36);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.fields).toEqual({
      kind: "agent",
      labels: 1,
      tags: LABEL_TAG_REPORT_PAGE_SIZE + 1,
      annotations: 1,
      unreadable: 1,
      ids: [
        "agt_1_label",
        "agt_2_note",
        "agt_2_unreadable",
        ...Array.from({ length: 7 }, (_, i) => `agt_3_tag_${String(i).padStart(4, "0")}`),
      ],
    });
    const stored = db.prepare(`SELECT id, data FROM resources WHERE kind = 'agent'`).all() as Array<{
      id: string;
      data: Uint8Array;
    }>;
    expect(stored).toHaveLength(seeded.size);
    for (const row of stored) {
      expect(Buffer.from(seeded.get(row.id)!).equals(Buffer.from(row.data)), row.id).toBe(true);
    }
  });
});

describe("v37: the platform client rows and the grants naming them leave", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-01 00:00:00";

  /** A v36 database: the chain replayed up to the step before v37. */
  function v36Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_37 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_37 - 1);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, id, data, SEEDED_AT);
  }

  function row(db: DatabaseSync, kind: string, id: string): { data: Uint8Array; updated_at: string } {
    return db
      .prepare(`SELECT data, updated_at FROM resources WHERE kind = ? AND id = ?`)
      .get(kind, id) as { data: Uint8Array; updated_at: string };
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  /** A client with its history, a list key and its name. */
  function seedClient(db: DatabaseSync): void {
    insert(
      db,
      "platform_client",
      "pcl_dashboard",
      retiredPlatformClientRow({
        metadata: { id: "pcl_dashboard", org: ORG, slug: "dashboard" },
        clientId: "stgm_cid_dashboard",
        allowedOrigins: ["https://app.example"],
        signInRole: IamRole.member,
        vaults: [{ kind: ApiResourceKind.vault, org: ORG, id: "vlt_keys" }],
        vaultAttachers: { vlt_keys: "ida_admin" },
      }),
    );
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('platform_client', 'pcl_dashboard', ?, '', '')`,
    ).run(new Uint8Array([0x00]));
    db.prepare(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('platform_client', 'pcl_dashboard', 'org', ?, '')`,
    ).run(ORG);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('platform_client', ?, 'dashboard', 'pcl_dashboard', 'current', ?)`,
    ).run(ORG, SEEDED_AT);
  }

  /** An account a client's mint created, which stays. */
  const appUser = toBinary(
    IdentityAccountSchema,
    create(IdentityAccountSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { id: "ida_app_user", org: ORG },
      spec: {
        idpId: `stgm_pc|${ORG}|user-7`,
        provisioningMode: IdentityAccountProvisioningMode.app_user,
      },
    }),
  );

  const keptGrant = {
    id: "iam_on_org",
    principal: "identity_account:ida_app_user",
    relation: "member",
    resource: `organization:${ORG}`,
  };
  const retiredGrants = [
    {
      id: "iam_on_client",
      principal: "identity_account:ida_1",
      relation: "viewer",
      resource: "platform_client:pcl_dashboard",
    },
    {
      id: "iam_client_holds",
      principal: "platform_client:pcl_dashboard",
      relation: "viewer",
      resource: "agent:agt_1",
    },
  ];

  function seedGrants(db: DatabaseSync): void {
    for (const grant of [...retiredGrants, keptGrant]) {
      insert(db, "iam_policy", grant.id, grantRow(grant));
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
      ).run(grant.id, grant.principal.split(":")[1] ?? "");
    }
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_client', ?, '', '')`,
    ).run(new Uint8Array([0x00]));
  }

  it("removes the client rows from every table and every grant naming one, its history kept, and keeps the accounts its mints created and their grants", () => {
    const { dbPath, db: setup } = v36Database();
    seedClient(setup);
    seedGrants(setup);
    insert(setup, "identity_account", "ida_app_user", appUser);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_37);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_37);

    for (const table of KIND_TABLES) {
      expect(count(db, table, "platform_client"), table).toBe(0);
    }
    const grantIds = (table: string) =>
      (
        db.prepare(`SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`).all() as Array<{ id: string }>
      ).map((r) => r.id);
    expect(grantIds("resources")).toEqual([keptGrant.id]);
    expect(grantIds("resource_list_keys")).toEqual([keptGrant.id]);
    expect(row(db, "iam_policy", keptGrant.id)).toEqual({ data: grantRow(keptGrant), updated_at: SEEDED_AT });
    expect(count(db, "resource_audit", "iam_policy")).toBe(1);
    expect(row(db, "identity_account", "ida_app_user")).toEqual({ data: appUser, updated_at: SEEDED_AT });
  });

  it("reads grants across keyset pages, missing none past the first page", () => {
    const { dbPath, db: setup } = v36Database();
    seedClient(setup);
    setup.exec("BEGIN");
    for (let i = 0; i <= PLATFORM_CLIENT_RETIRED_PAGE_SIZE; i++) {
      const id = `iam_page_${String(i).padStart(4, "0")}`;
      insert(
        setup,
        "iam_policy",
        id,
        grantRow({
          id,
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: i === PLATFORM_CLIENT_RETIRED_PAGE_SIZE ? "platform_client:pcl_dashboard" : "agent:agt_1",
        }),
      );
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_37);

    expect(count(db, "resources", "iam_policy")).toBe(PLATFORM_CLIENT_RETIRED_PAGE_SIZE);
    const last = `iam_page_${String(PLATFORM_CLIENT_RETIRED_PAGE_SIZE).padStart(4, "0")}`;
    expect(row(db, "iam_policy", last)).toBeUndefined();
    expect(count(db, "resources", "platform_client")).toBe(0);
  });

  it("a grant that does not decode fails the step, names the row, rolls back, and leaves the database at v36", () => {
    const { dbPath, db: setup } = v36Database();
    seedClient(setup);
    insert(setup, "iam_policy", "iam_a_retired", grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }));
    insert(setup, "iam_policy", "iam_z_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_37)).toThrow(
      "iam_policy 'iam_z_broken' cannot be read to retire the platform client kind",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_37 - 1);
    expect(row(db, "iam_policy", "iam_a_retired").data).toEqual(
      grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }),
    );
    expect(count(db, "resources", "platform_client")).toBe(1);
  });

  it("replays every frozen step over a client from before the slug ledger, then removes it", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_12 - 1);
    insert(
      setup,
      "platform_client",
      "pcl_early",
      retiredPlatformClientRow({
        metadata: { id: "pcl_early", org: "acme", slug: "early" },
        clientId: "stgm_cid_early",
        vaults: [{ kind: ApiResourceKind.vault, org: "acme", slug: "product-keys" }],
      }),
    );
    insert(
      setup,
      "iam_policy",
      "iam_on_early",
      grantRow({
        id: "iam_on_early",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "platform_client:pcl_early",
      }),
    );
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_37 - 1);
    // The name backfill read the retired row through its envelope.
    expect(count(db, "resource_names", "platform_client")).toBe(1);

    runMigrations(db, SCHEMA_VERSION_37);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_37);
    for (const table of KIND_TABLES) {
      expect(count(db, table, "platform_client"), table).toBe(0);
    }
    expect(count(db, "resources", "iam_policy")).toBe(0);
  });
});

describe("v38: the IAM policy is a grant", () => {
  const ORG = "acme";
  const SEEDED_AT = "2026-10-15 00:00:00";
  const orgRole = grantBeforeV34({ principal: "identity_account:ida_alice", relation: "viewer", resource: `organization:${ORG}` });
  const onAgent = grantBeforeV34({ principal: "identity_account:ida_bob", relation: "editor", resource: "agent:agt_1" });
  const held = [orgRole, onAgent];

  function insertGrant(db: DatabaseSync, grant: { id: string; principal: string; relation: string; resource: string }): void {
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', ?, ?, ?)`).run(
      grant.id,
      grantRow(grant),
      SEEDED_AT,
    );
  }

  /** A store at v37 holding both grants as that release wrote them, with their list keys and history. */
  function seededAtV37(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_37);
    for (const [index, grant] of held.entries()) {
      insertGrant(db, grant);
      db.prepare(
        `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', ?, 'principal', ?, '')`,
      ).run(grant.id, grant.principal.split(":")[1] ?? "");
      const [principalKind, principalId] = grant.principal.split(":");
      const [resourceKind, resourceId] = grant.resource.split(":");
      db.prepare(
        `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
           principal_kind, principal_id, relation, resource_kind, resource_id, data)
         VALUES (?, ?, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ORG, index + 1, grant.id, principalKind!, principalId!, grant.relation, resourceKind!, resourceId!, grantRow(grant));
    }
    db.prepare(
      `INSERT INTO iam_policy_history_heads (org, last_sequence, last_occurred_at) VALUES (?, 2, '2026-10-15T00:00:00.000Z')`,
    ).run(ORG);
    return { dbPath, db };
  }

  it("moves every grant, its list keys and its history to the kind's new names and its grt_ id, from a store at v37", () => {
    const { db } = seededAtV37();
    runMigrations(db, SCHEMA_VERSION_38);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_38);

    const moved = [...held].sort((a, b) => (grantIdAfterV34(a) < grantIdAfterV34(b) ? -1 : 1));
    const rows = db
      .prepare(`SELECT kind, id, data, updated_at FROM resources WHERE kind IN ('iam_policy', 'grant') ORDER BY id`)
      .all() as Array<{ kind: string; id: string; data: Uint8Array; updated_at: string }>;
    expect(rows.map((r) => [r.kind, r.id])).toEqual(moved.map((g) => ["grant", grantIdAfterV34(g)]));
    for (const [index, grant] of moved.entries()) {
      expect(new Uint8Array(rows[index]!.data)).toEqual(grantRowAfterV34(grant));
      expect(rows[index]!.updated_at).toBe(SEEDED_AT);
    }
    expect(
      db.prepare(`SELECT kind, id FROM resource_list_keys WHERE kind IN ('iam_policy', 'grant') ORDER BY id`).all(),
    ).toEqual(moved.map((g) => ({ kind: "grant", id: grantIdAfterV34(g) })));

    const tables = tableNames(db).filter((name) => name.startsWith("grant") || name.startsWith("iam_policy"));
    expect(tables).toEqual(["grant_history", "grant_history_heads"]);
    // SQLite renames a table's primary-key autoindex with it; the time index is made again.
    const indexes = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`).all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toContain("grant_history_by_time");
    expect(indexes).toContain("sqlite_autoindex_grant_history_1");
    expect(indexes.filter((name) => name.includes("iam_policy"))).toEqual([]);
    expect(
      (db.prepare(`PRAGMA index_info('grant_history_by_time')`).all() as Array<{ name: string }>).map((c) => c.name),
    ).toEqual(["occurred_at", "org", "sequence"]);

    const entries = db
      .prepare(`SELECT sequence, grant_id, data FROM grant_history WHERE org = ? ORDER BY sequence`)
      .all(ORG) as Array<{ sequence: number; grant_id: string; data: Uint8Array }>;
    expect(entries.map((e) => [e.sequence, e.grant_id, new Uint8Array(e.data)])).toEqual(
      held.map((g, index) => [index + 1, grantIdAfterV34(g), grantRowAfterV34(g)]),
    );
    expect(db.prepare(`SELECT org, last_sequence FROM grant_history_heads`).all()).toEqual([
      { org: ORG, last_sequence: 2 },
    ]);
  });

  it("leaves the store finding each moved grant by its triple: a second row is refused, a revoke removes it, and the history lists all three", async () => {
    const { dbPath } = seededAtV37();
    const store = SqliteStore.open(dbPath, undefined, { listIndexes: [grantListIndex] });
    cleanups.push(() => store.close());
    const grants = newResourceGrantStore(store, { keepsHistory: true });
    const change = (cause: "grant" | "revoke") => ({
      actor: { id: "ida_root", callerClass: "user" },
      cause,
      organizationId: ORG,
    });
    const found = await grants.findByResource("organization", ORG);
    expect(found.map((g) => g.metadata?.id)).toEqual([grantIdAfterV34(orgRole)]);
    await expect(grants.save(fromBinary(GrantSchema, grantRowAfterV34(orgRole)), change("grant"))).rejects.toBeInstanceOf(
      DuplicateGrantError,
    );
    await grants.deleteById(found[0]!.metadata!.id, change("revoke"));
    expect(await grants.findByResource("organization", ORG)).toEqual([]);
    expect((await grants.findByResource("agent", "agt_1")).map((g) => g.metadata?.id)).toEqual([grantIdAfterV34(onAgent)]);
    const history = await grants.listChanges(ORG, { limit: 10, after: 0n });
    expect(history.map((h) => [h.sequence, h.change, h.grant.metadata?.id])).toEqual([
      [1n, "granted", grantIdAfterV34(orgRole)],
      [2n, "granted", grantIdAfterV34(onAgent)],
      [3n, "revoked", grantIdAfterV34(orgRole)],
    ]);
  });

  it("moves the history's entries across its keyset pages", () => {
    const { db } = seededAtV37();
    const insertEntry = db.prepare(
      `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
         principal_kind, principal_id, relation, resource_kind, resource_id, data)
       VALUES (?, ?, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', ?, 'identity_account', 'ida_alice', 'viewer', 'organization', ?, ?)`,
    );
    for (let sequence = 3; sequence <= KIND_RENAME_PAGE_SIZE + 3; sequence++) {
      insertEntry.run(ORG, sequence, orgRole.id, ORG, grantRow(orgRole));
    }
    runMigrations(db, SCHEMA_VERSION_38);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM grant_history WHERE grant_id LIKE 'iamp\_%' ESCAPE '\\'`).get()).toEqual({ n: 0 });
    expect(
      db.prepare(`SELECT grant_id FROM grant_history WHERE org = ? AND sequence = ?`).get(ORG, KIND_RENAME_PAGE_SIZE + 3),
    ).toEqual({ grant_id: grantIdAfterV34(orgRole) });
  });

  it("moves every grant across the keyset pages of the grant rows", () => {
    const { db } = seededAtV37();
    const paged = Array.from({ length: KIND_RENAME_PAGE_SIZE + 1 }, (_, i) =>
      grantBeforeV34({
        principal: `identity_account:ida_page_${String(i).padStart(4, "0")}`,
        relation: "viewer",
        resource: `organization:${ORG}`,
      }),
    );
    for (const grant of paged) {
      insertGrant(db, grant);
    }
    runMigrations(db, SCHEMA_VERSION_38);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM resources WHERE kind = 'grant' AND substr(id, 1, 5) = 'iamp_'`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM resources WHERE kind = 'grant'`).get()).toEqual({ n: paged.length + held.length });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM resources WHERE kind = 'grant' AND id = ?`).get(grantIdAfterV34(paged[paged.length - 1]!)),
    ).toEqual({ n: 1 });
  });

  it("fails on a history entry it cannot decode, naming it, and leaves the database at v37", () => {
    const { db } = seededAtV37();
    db.prepare(
      `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
         principal_kind, principal_id, relation, resource_kind, resource_id, data)
       VALUES (?, 9, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', 'iamp_broken',
         'identity_account', 'ida_alice', 'viewer', 'organization', ?, ?)`,
    ).run(ORG, ORG, new Uint8Array([0xff, 0xff, 0xff]));
    expect(() => runMigrations(db, SCHEMA_VERSION_38)).toThrow(
      `the grant_history row ${ORG}/9 cannot be read for the rename of the IAM policy to a grant`,
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_37);
  });

  it("fails on a grant whose id is not the one its triple derives, naming it, and leaves the database at v37", () => {
    const { db } = seededAtV37();
    const stray = { id: "iamp_01hzzzzzzzzzzzzzzzzzzzzzzz", principal: "identity_account:ida_carol", relation: "viewer", resource: `organization:${ORG}` };
    insertGrant(db, stray);
    expect(() => runMigrations(db, SCHEMA_VERSION_38)).toThrow(
      `the grant row ${stray.id} cannot be read for the rename of the IAM policy to a grant: its id is not the one its triple derives (${grantIdBeforeV34(stray)})`,
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_37);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM resources WHERE kind = 'iam_policy'`).get()).toEqual({ n: 3 });
  });

  it("a grant a store held before v34 reaches the head carrying its etag (v34 reads the kind by its name then)", async () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_33);
    insertGrant(setup, orgRole);
    setup.close();
    const store = SqliteStore.open(dbPath);
    cleanups.push(() => store.close());
    const grant = await store.getResource(ApiResourceKind.grant, grantIdAfterV34(orgRole), GrantSchema);
    expect(grant).toBeDefined();
    expect(storedEtagOf(GrantSchema, grant!)).toBe(etagOf(GrantSchema, grant!));
    expect(storedEtagOf(GrantSchema, grant!)).not.toBe("");
  });
});

describe("v39: the plugin eval and agent eval rows and the grants naming them leave, and their tries are relabelled", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-15 00:00:00";
  const OLD_LABEL = "stigmer.ai/plugin-eval";
  const NEW_LABEL = "stigmer.ai/eval-run";

  /** A v38 database: the chain replayed up to the step before v39. */
  function v38Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_39 - 1);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_39 - 1);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`).run(kind, id, data, SEEDED_AT);
  }

  function dataOf(db: DatabaseSync, kind: string, id: string): Uint8Array | undefined {
    const found = db.prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`).get(kind, id) as
      | { data: Uint8Array }
      | undefined;
    return found?.data;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  /** A retired kind's row, its history, a list key and its name; its bytes no schema reads any more. */
  function seedRetired(db: DatabaseSync, kind: "plugin_eval" | "agent_eval", id: string): void {
    insert(db, kind, id, new Uint8Array([0x0a, 0x05, 0x61, 0x67, 0x65, 0x6e, 0x74]));
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES (?, ?, ?, '', '')`,
    ).run(kind, id, new Uint8Array([0x00]));
    db.prepare(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, 'org', ?, '')`).run(
      kind,
      id,
      ORG,
    );
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, ?, ?, 'current', ?)`,
    ).run(kind, ORG, id, id, SEEDED_AT);
  }

  const trySession = () =>
    create(SessionSchema, {
      metadata: { id: "ses_try", org: ORG, name: "try-1", labels: { [OLD_LABEL]: "pev_old" } },
      spec: { subject: "first-case" },
    });

  it("removes both kinds' rows from every table and every grant naming one, and relabels their tries' session, run and score", () => {
    const { dbPath, db: setup } = v38Database();
    seedRetired(setup, "plugin_eval", "pev_old");
    seedRetired(setup, "agent_eval", "aev_old");
    const kept = { id: "iam_on_org", principal: "identity_account:ida_1", relation: "member", resource: `organization:${ORG}` };
    const retired = { id: "iam_on_eval", principal: "identity_account:ida_1", relation: "viewer", resource: "plugin_eval:pev_old" };
    for (const grant of [kept, retired]) insert(setup, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
    const session = trySession();
    stampEtag(SessionSchema, session);
    insert(setup, "session", "ses_try", toBinary(SessionSchema, session));
    insert(
      setup,
      "run",
      "run_try",
      toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_try", org: ORG, labels: { [OLD_LABEL]: "aev_old" } } })),
    );
    insert(
      setup,
      "score",
      "scr_try",
      toBinary(ScoreSchema, create(ScoreSchema, { metadata: { id: "scr_try", org: ORG, labels: { [OLD_LABEL]: "pev_old" } } })),
    );
    const plain = toBinary(SessionSchema, create(SessionSchema, { metadata: { id: "ses_chat", org: ORG, labels: { team: "a" } } }));
    insert(setup, "session", "ses_chat", plain);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_39);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_39);

    for (const table of KIND_TABLES) {
      expect(count(db, table, "plugin_eval"), table).toBe(0);
      expect(count(db, table, "agent_eval"), table).toBe(0);
    }
    expect(dataOf(db, "grant", grantIdAfterV34(retired))).toBeUndefined();
    expect(dataOf(db, "grant", grantIdAfterV34(kept))).toEqual(grantRowAfterV34(kept));
    const relabelled = fromBinary(SessionSchema, dataOf(db, "session", "ses_try")!);
    expect(relabelled.metadata?.labels).toEqual({ [NEW_LABEL]: "pev_old" });
    expect(relabelled.metadata?.etag, "a stamped row is stamped again").toBe(etagOf(SessionSchema, relabelled));
    expect(fromBinary(RunSchema, dataOf(db, "run", "run_try")!).metadata?.labels).toEqual({ [NEW_LABEL]: "aev_old" });
    expect(fromBinary(ScoreSchema, dataOf(db, "score", "scr_try")!).metadata?.labels).toEqual({ [NEW_LABEL]: "pev_old" });
    expect(dataOf(db, "session", "ses_chat"), "a conversation that is no try keeps its bytes").toEqual(plain);
  });

  it("keys a relabelled try under eval_run once the store derives its list keys at open", async () => {
    const { dbPath, db: setup } = v38Database();
    insert(setup, "session", "ses_try", toBinary(SessionSchema, trySession()));
    setup.close();

    const store = SqliteStore.open(dbPath, undefined, { listIndexes: [sessionListIndex] });
    cleanups.push(() => store.close());
    const found = await store.queryResources(sessionListIndex, { anyKey: [{ name: "eval_run", value: "pev_old" }] });
    expect(found.map((row) => row.id)).toEqual(["ses_try"]);
  });

  it("reads tries across keyset pages, relabelling the one past the first page", () => {
    const { dbPath, db: setup } = v38Database();
    setup.exec("BEGIN");
    for (let i = 0; i <= EVAL_KINDS_RETIRED_PAGE_SIZE; i++) {
      const id = `ses_page_${String(i).padStart(4, "0")}`;
      const labels: Record<string, string> = i === EVAL_KINDS_RETIRED_PAGE_SIZE ? { [OLD_LABEL]: "pev_old" } : {};
      insert(setup, "session", id, toBinary(SessionSchema, create(SessionSchema, { metadata: { id, org: ORG, labels } })));
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_39);
    const last = `ses_page_${String(EVAL_KINDS_RETIRED_PAGE_SIZE).padStart(4, "0")}`;
    expect(fromBinary(SessionSchema, dataOf(db, "session", last)!).metadata?.labels).toEqual({ [NEW_LABEL]: "pev_old" });
  });

  it("reads grants across keyset pages, removing the one past the first page that names a retired kind", () => {
    const { dbPath, db: setup } = v38Database();
    setup.exec("BEGIN");
    const triples = Array.from({ length: EVAL_KINDS_RETIRED_PAGE_SIZE + 1 }, (_, i) => ({
      principal: `identity_account:ida_${i}`,
      relation: "viewer",
      resource: i === EVAL_KINDS_RETIRED_PAGE_SIZE ? "plugin_eval:pev_old" : `organization:${ORG}`,
    }));
    for (const triple of triples) insert(setup, "grant", grantIdAfterV34(triple), grantRowAfterV34(triple));
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_39);
    expect(count(db, "resources", "grant")).toBe(EVAL_KINDS_RETIRED_PAGE_SIZE);
    expect(dataOf(db, "grant", grantIdAfterV34(triples[EVAL_KINDS_RETIRED_PAGE_SIZE]!))).toBeUndefined();
  });

  it("a grant row that does not decode fails the step, names the row, and leaves the database at v38", () => {
    const { dbPath, db: setup } = v38Database();
    insert(setup, "grant", "grt_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_39)).toThrow(
      "grant 'grt_broken' cannot be read to retire the plugin eval and agent eval kinds",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_39 - 1);
  });

  it("a try row that does not decode fails the step, names the row, rolls back, and leaves the database at v38", () => {
    const { dbPath, db: setup } = v38Database();
    seedRetired(setup, "plugin_eval", "pev_old");
    insert(setup, "run", "run_broken", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, SCHEMA_VERSION_39)).toThrow(
      "run 'run_broken' cannot be read to retire the plugin eval and agent eval kinds",
    );
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_39 - 1);
    expect(count(db, "resources", "plugin_eval")).toBe(1);
  });
});

describe("v40: the evaluator is a scoring rule", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-15 00:00:00";

  /** A v39 database: the chain replayed up to the step before v40. */
  function v39Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_39);
    return { dbPath, db };
  }

  /** An evaluator as a release before v40 stored it: its kind string, an evl_ id, its settings and this month's spend. */
  const stored = () =>
    create(ScoringRuleSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Evaluator",
      metadata: { id: "evl_1", org: ORG, name: "evl_1", slug: "evl_1" },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 0.25, monthlyLimitUsd: 12, modelName: "claude-sonnet-4-6" },
      status: { period: "2026-10", spentUsd: 1.5, reservedUsd: 0.25, graded: 7, notGraded: 1, lastNotGradedReason: "spending limit reached" },
    });

  function seed(db: DatabaseSync, id: string, data: Uint8Array): void {
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('evaluator', ?, ?, ?)`).run(id, data, SEEDED_AT);
    db.prepare(`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('evaluator', ?, ?, '', '')`).run(
      id,
      new Uint8Array([0x00]),
    );
    db.prepare(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('evaluator', ?, 'agent', 'agt_1', '')`).run(id);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('evaluator', ?, ?, ?, 'current', ?)`,
    ).run(ORG, id, id, SEEDED_AT);
  }

  it("moves the kind's rows to its new name in every table, its bytes to the new kind string, with its id, settings and spend kept", () => {
    const { db } = v39Database();
    seed(db, "evl_1", toBinary(ScoringRuleSchema, stored()));
    const agent = toBinary(AgentSchema, create(AgentSchema, { kind: "Agent", metadata: { id: "agt_1", org: ORG } }));
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent', 'agt_1', ?, ?)`).run(agent, SEEDED_AT);

    runMigrations(db, SCHEMA_VERSION_40);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);

    for (const [table, column] of [
      ["resources", "id"],
      ["resource_audit", "resource_id"],
      ["resource_list_keys", "id"],
      ["resource_names", "id"],
    ] as const) {
      expect(db.prepare(`SELECT kind FROM ${table} WHERE ${column} = 'evl_1'`).all()).toEqual([{ kind: "scoring_rule" }]);
    }
    const row = db.prepare(`SELECT data, updated_at FROM resources WHERE kind = 'scoring_rule' AND id = 'evl_1'`).get() as {
      data: Uint8Array;
      updated_at: string;
    };
    const expected = stored();
    expected.kind = "ScoringRule";
    expect(fromBinary(ScoringRuleSchema, new Uint8Array(row.data))).toEqual(expected);
    expect(row.updated_at).toBe(SEEDED_AT);
    expect(new Uint8Array((db.prepare(`SELECT data FROM resources WHERE kind = 'agent'`).get() as { data: Uint8Array }).data)).toEqual(agent);
  });

  it("an evaluator that does not decode fails the step, names the row, and leaves the database at v39", () => {
    const { db } = v39Database();
    seed(db, "evl_broken", new Uint8Array([0xff, 0xff, 0xff]));
    expect(() => runMigrations(db, SCHEMA_VERSION_40)).toThrow(/evl_broken/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_39);
    expect(db.prepare(`SELECT kind FROM resources WHERE id = 'evl_broken'`).all()).toEqual([{ kind: "evaluator" }]);
  });
});


describe("v41: the agent share and agent channel kinds merge into the channel kind", () => {
  const MERGE_VERSION = SCHEMA_VERSION_41;
  const SEEDED_AT = "2026-10-15 00:00:00";
  const SHARE_LABEL = "stigmer.ai/share-id";
  const CHANNEL_LABEL = "stigmer.ai/channel-id";
  const CONVERSATION_KEY = "stigmer.ai/channel-conversation-key";
  const AGENT = { kind: ApiResourceKind.agent, org: MERGE_ORG, id: "agt_helper" };
  const VAULT = { kind: ApiResourceKind.vault, org: MERGE_ORG, id: "vlt_tools" };
  const APP = { kind: ApiResourceKind.channel_app, org: MERGE_ORG, id: "chapp_meta" };
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-02-01T00:00:00Z");

  /** A v40 database: the chain replayed up to the step before the merge. */
  function v40Database(): { dbPath: string; db: DatabaseSync } {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_40);
    expect(getSchemaVersion(setup)).toBe(SCHEMA_VERSION_40);
    return { dbPath, db: setup };
  }

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`).run(kind, id, data, SEEDED_AT);
  }

  /** A row of a merged kind with the name the backfill and every create claimed for it, and a list key. */
  function seedMerged(db: DatabaseSync, kind: "agent_share" | "agent_channel", id: string, slug: string, data: Uint8Array): void {
    insert(db, kind, id, data);
    db.prepare(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, 'agent', ?, '')`).run(
      kind,
      id,
      AGENT.id,
    );
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, ?, ?, 'current', '2026-01-01T00:00:00Z')`,
    ).run(kind, MERGE_ORG, slug, id);
  }

  function dataOf(db: DatabaseSync, kind: string, id: string): Uint8Array | undefined {
    const found = db.prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`).get(kind, id) as
      | { data: Uint8Array }
      | undefined;
    return found?.data;
  }

  function count(db: DatabaseSync, table: string, kind: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`).get(kind) as { n: number }).n;
  }

  function channelOf(db: DatabaseSync, id: string) {
    const data = dataOf(db, "channel", id);
    expect(data, id).toBeDefined();
    return fromBinary(ChannelSchema, data!);
  }

  /** Every kind of row the merge reads, as the releases before it wrote them. */
  function seedEveryShape(db: DatabaseSync): void {
    db.exec("BEGIN");
    insert(db, "organization", MERGE_ORG, toBinary(OrganizationSchema, create(OrganizationSchema, { metadata: { id: MERGE_ORG, slug: "acme" } })));
    insert(
      db,
      "agent",
      AGENT.id,
      toBinary(AgentSchema, create(AgentSchema, { metadata: { id: AGENT.id, org: MERGE_ORG, slug: "helper", name: "Helper" }, spec: { description: "Helps." } })),
    );
    seedMerged(
      db,
      "agent_share",
      "ash_public",
      "helper",
      shareRowBytes({
        id: "ash_public",
        slug: "helper",
        createdAt: newer,
        agentRef: AGENT,
        enabled: true,
        audience: 1,
        allowedOrigins: ["https://docs.example.com"],
        messages: { rateLimited: "Slow down." },
        vaults: [VAULT],
        runConfig: { maxToolRounds: 5 },
        vaultAttachers: { [VAULT.id]: "ida_owner" },
        linkToken: "tok_locked",
        agentPin: AGENT.id,
        retiredFieldBytes: true,
      }),
    );
    seedMerged(
      db,
      "agent_share",
      "ash_members",
      "helper-team",
      shareRowBytes({ id: "ash_members", slug: "helper-team", createdAt: older, agentRef: AGENT, enabled: true, audience: 2 }),
    );
    seedMerged(
      db,
      "agent_channel",
      "ach_slack",
      "helper",
      agentChannelRowBytes({
        id: "ach_slack",
        slug: "helper",
        createdAt: older,
        agentRef: AGENT,
        enabled: true,
        provider: "slack",
        proactive: true,
        installState: ChannelInstallState.installed,
        slackInstall: { teamId: "TACMESLACK", teamName: "Acme", botUserId: "U01" },
        retiredFieldBytes: true,
      }),
    );
    seedMerged(
      db,
      "agent_channel",
      "ach_whatsapp",
      "helper-whatsapp-line",
      agentChannelRowBytes({
        id: "ach_whatsapp",
        slug: "helper-whatsapp-line",
        createdAt: older,
        agentRef: AGENT,
        enabled: true,
        provider: "whatsapp",
        phoneNumberId: "106540352242922",
        appRef: APP,
        proactive: true,
        installState: ChannelInstallState.pending_install,
        vaults: [VAULT],
      }),
    );
    const onShare = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "agent_share:ash_public" };
    const onChannel = { principal: "team:tm_support", relation: "participant", resource: "agent_channel:ach_slack" };
    for (const grant of [onShare, onChannel]) {
      insert(db, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
    }
    const occurred = "2026-10-15T00:00:00.000Z";
    db.prepare(
      `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
         principal_kind, principal_id, relation, resource_kind, resource_id, data)
       VALUES (?, 1, ?, 'granted', 'grant', 'ida_owner', 'user', ?, 'identity_account', 'ida_viewer', 'viewer', 'agent_share', 'ash_public', ?)`,
    ).run(MERGE_ORG, occurred, grantIdAfterV34(onShare), grantRowAfterV34(onShare));
    db.prepare(`INSERT INTO grant_history_heads (org, last_sequence, last_occurred_at) VALUES (?, 1, ?)`).run(MERGE_ORG, occurred);
    const guest = create(SessionSchema, { metadata: { id: "ses_guest", org: MERGE_ORG, labels: { [SHARE_LABEL]: "ash_public" } } });
    stampEtag(SessionSchema, guest);
    insert(db, "session", "ses_guest", toBinary(SessionSchema, guest));
    insert(
      db,
      "run",
      "run_guest",
      toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_guest", org: MERGE_ORG, labels: { [SHARE_LABEL]: "ash_public" } } })),
    );
    insert(
      db,
      "session",
      "ses_slack",
      toBinary(
        SessionSchema,
        create(SessionSchema, {
          metadata: { id: "ses_slack", org: MERGE_ORG, labels: { [CHANNEL_LABEL]: "ach_slack", [CONVERSATION_KEY]: "TACMESLACK:C01" } },
        }),
      ),
    );
    db.exec("COMMIT");
  }

  it("converts every share and agent channel to a channel under its old id, keeping every field but the two it drops", () => {
    const { dbPath, db: setup } = v40Database();
    seedEveryShape(setup);
    const slackSession = dataOf(setup, "session", "ses_slack");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);
    expect(getSchemaVersion(db)).toBe(MERGE_VERSION);

    const pub = channelOf(db, "ash_public");
    expect(pub.kind).toBe("Channel");
    expect(pub.spec?.agentRef?.id).toBe(AGENT.id);
    expect(pub.spec?.enabled).toBe(true);
    expect(pub.spec?.vaults.map((v) => v.id)).toEqual([VAULT.id]);
    expect(pub.spec?.runConfig?.maxToolRounds).toBe(5);
    expect(pub.spec?.type.case).toBe("web");
    const web = pub.spec?.type.case === "web" ? pub.spec.type.value : undefined;
    expect(web?.audience).toBe(ChannelAudience.public);
    expect(web?.allowedOrigins).toEqual(["https://docs.example.com"]);
    expect(web?.messages?.rateLimited).toBe("Slow down.");
    expect(pub.status?.typeStatus).toEqual({ case: "web", value: expect.objectContaining({ linkToken: "tok_locked" }) });
    expect(pub.status?.vaultAttachers).toEqual({ [VAULT.id]: "ida_owner" });
    expect(pub.status?.installState).toBe(ChannelInstallState.channel_install_state_unspecified);
    expect(pub.metadata?.etag).toBe(etagOf(ChannelSchema, pub));

    const members = channelOf(db, "ash_members");
    expect(members.spec?.type.case === "web" ? members.spec.type.value.audience : undefined).toBe(ChannelAudience.org);

    const slack = channelOf(db, "ach_slack");
    expect(slack.spec?.type.case).toBe("slack");
    expect(slack.spec?.type.case === "slack" ? slack.spec.type.value.appRef : "unset", "the shared Stigmer app").toBeUndefined();
    expect(slack.status?.installState).toBe(ChannelInstallState.installed);
    expect(slack.status?.typeStatus.case).toBe("slack");
    expect(slack.status?.typeStatus.case === "slack" ? slack.status.typeStatus.value.teamId : "").toBe("TACMESLACK");

    const whatsapp = channelOf(db, "ach_whatsapp");
    expect(whatsapp.spec?.type.case).toBe("whatsapp");
    const arm = whatsapp.spec?.type.case === "whatsapp" ? whatsapp.spec.type.value : undefined;
    expect(arm?.phoneNumberId).toBe("106540352242922");
    expect(arm?.appRef?.id).toBe(APP.id);
    expect(arm?.proactiveMessagingEnabled).toBe(true);
    expect(whatsapp.status?.installState).toBe(ChannelInstallState.pending_install);
    expect(whatsapp.spec?.vaults.map((v) => v.id)).toEqual([VAULT.id]);

    for (const table of KIND_TABLES) {
      expect(count(db, table, "agent_share"), table).toBe(0);
      expect(count(db, table, "agent_channel"), table).toBe(0);
    }
    expect(dataOf(db, "session", "ses_slack"), "a Slack conversation keeps its bytes").toEqual(slackSession);
  });

  it("gives a slug a share and a channel shared to the older row, and the other `<slug>-<type>`, with the names claimed under channel", () => {
    const { dbPath, db: setup } = v40Database();
    seedEveryShape(setup);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);

    expect(channelOf(db, "ach_slack").metadata?.slug, "the older row keeps the slug").toBe("helper");
    expect(channelOf(db, "ash_public").metadata?.slug, "the newer row takes its type").toBe("helper-web");
    expect(channelOf(db, "ash_members").metadata?.slug).toBe("helper-team");
    const names = db
      .prepare(`SELECT name, id, state FROM resource_names WHERE kind = 'channel' ORDER BY name`)
      .all() as Array<{ name: string; id: string; state: string }>;
    expect(names.map((n) => [n.name, n.id, n.state])).toEqual([
      ["helper", "ach_slack", "current"],
      ["helper-team", "ash_members", "current"],
      ["helper-web", "ash_public", "current"],
      ["helper-whatsapp-line", "ach_whatsapp", "current"],
    ]);
  });

  it("re-keys every grant on either kind to the channel's triple, and moves its history", () => {
    const { dbPath, db: setup } = v40Database();
    seedEveryShape(setup);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);

    const onShare = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "channel:ash_public" };
    const onChannel = { principal: "team:tm_support", relation: "participant", resource: "channel:ach_slack" };
    for (const grant of [onShare, onChannel]) {
      const stored = dataOf(db, "grant", grantIdAfterV34(grant));
      expect(stored, grant.resource).toBeDefined();
      const decoded = fromBinary(GrantSchema, stored!);
      expect(decoded.spec?.resource?.kind).toBe("channel");
      expect(decoded.metadata?.id).toBe(grantIdAfterV34(grant));
    }
    expect(count(db, "resources", "grant")).toBe(2);
    expect(
      db.prepare(`SELECT grant_id, resource_kind FROM grant_history WHERE org = ? AND sequence = 1`).get(MERGE_ORG),
    ).toEqual({ grant_id: grantIdAfterV34(onShare), resource_kind: "channel" });
  });

  it("relabels a chat link's guest conversation with the channel id, and the store finds it and the channels by their keys at open", async () => {
    const { dbPath, db: setup } = v40Database();
    seedEveryShape(setup);
    setup.close();

    const migrating = new DatabaseSync(dbPath);
    runMigrations(migrating, MERGE_VERSION);
    const guest = fromBinary(SessionSchema, dataOf(migrating, "session", "ses_guest")!);
    expect(guest.metadata?.labels).toEqual({ [CHANNEL_LABEL]: "ash_public" });
    expect(guest.metadata?.etag).toBe(etagOf(SessionSchema, guest));
    expect(fromBinary(RunSchema, dataOf(migrating, "run", "run_guest")!).metadata?.labels).toEqual({ [CHANNEL_LABEL]: "ash_public" });
    migrating.close();

    const store = SqliteStore.open(dbPath, undefined, { listIndexes: [sessionListIndex, channelListIndex] });
    cleanups.push(() => store.close());
    const conversations = await store.queryResources(sessionListIndex, { anyKey: [{ name: "channel", value: "ash_public" }] });
    expect(conversations.map((row) => row.id)).toEqual(["ses_guest"]);
    const channels = await store.queryResources(channelListIndex, { anyKey: [{ name: "agent", value: AGENT.id }] });
    expect(channels.map((row) => row.id).sort()).toEqual(["ach_slack", "ach_whatsapp", "ash_members", "ash_public"]);
    const profile = await buildChannelAgentProfile(store, await loadLinkedChannel(store, "ash_public"));
    expect(profile.org).toBe(MERGE_ORG);
    expect(profile.slug).toBe("helper-web");
    expect(profile.name).toBe("Helper");
    expect(profile.agentRef?.id).toBe(AGENT.id);
  });

  it("reads rows across keyset pages, converting the share past the first page", () => {
    const { dbPath, db: setup } = v40Database();
    setup.exec("BEGIN");
    for (let i = 0; i <= CHANNEL_MERGE_PAGE_SIZE; i++) {
      const id = `ash_page_${String(i).padStart(4, "0")}`;
      insert(setup, "agent_share", id, shareRowBytes({ id, slug: id.replace(/_/g, "-"), agentRef: AGENT }));
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);
    expect(count(db, "resources", "channel")).toBe(CHANNEL_MERGE_PAGE_SIZE + 1);
    expect(count(db, "resources", "agent_share")).toBe(0);
  });

  it("a row holding a field the merge does not know fails the step, names the row, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    insert(setup, "agent_share", "ash_odd", shareRowBytes({ id: "ash_odd", slug: "odd", agentRef: AGENT, unknownSpecField: 40 }));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow("agent_share 'ash_odd' cannot be read to merge");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
    expect(count(db, "resources", "agent_share")).toBe(1);
  });

  it("moves grant history entries across keyset pages, re-keying the entry past the first page", () => {
    const { dbPath, db: setup } = v40Database();
    const onShare = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "agent_share:ash_public" };
    const entry = setup.prepare(
      `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
         principal_kind, principal_id, relation, resource_kind, resource_id, data)
       VALUES (?, ?, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_owner', 'user', ?, 'identity_account', 'ida_viewer', 'viewer', 'agent_share', 'ash_public', ?)`,
    );
    setup.exec("BEGIN");
    for (let sequence = 1; sequence <= CHANNEL_MERGE_PAGE_SIZE + 1; sequence++) {
      entry.run(MERGE_ORG, sequence, grantIdAfterV34(onShare), grantRowAfterV34(onShare));
    }
    setup.exec("COMMIT");
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);
    const moved = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "channel:ash_public" };
    const kinds = db
      .prepare(`SELECT resource_kind, grant_id, COUNT(*) AS n FROM grant_history GROUP BY resource_kind, grant_id`)
      .all() as Array<{ resource_kind: string; grant_id: string; n: number }>;
    expect(kinds).toEqual([{ resource_kind: "channel", grant_id: grantIdAfterV34(moved), n: CHANNEL_MERGE_PAGE_SIZE + 1 }]);
  });

  it("a grant that does not decode fails the step, names the row, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    insert(setup, "grant", "grt_undecodable", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow("grant 'grt_undecodable' cannot be read to merge");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
  });

  it("a grant history entry on a merged kind that does not decode fails the step, names the entry, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    setup
      .prepare(
        `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
           principal_kind, principal_id, relation, resource_kind, resource_id, data)
         VALUES (?, 7, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_owner', 'user', 'grt_x', 'identity_account', 'ida_viewer', 'viewer', 'agent_channel', 'ach_slack', ?)`,
      )
      .run(MERGE_ORG, new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow(`grant_history '${MERGE_ORG}/7' cannot be read to merge`);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
  });

  it("a conversation that does not decode fails the step, names the row, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    insert(setup, "session", "ses_undecodable", new Uint8Array([0x22, 0xff]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow("session 'ses_undecodable' cannot be read to merge");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
  });

  it("an archived version of a merged kind fails the step, names it, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    insert(setup, "agent_channel", "ach_one", agentChannelRowBytes({ id: "ach_one", slug: "one", agentRef: AGENT, provider: "slack" }));
    setup
      .prepare(`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_channel', 'ach_one', ?, '', '')`)
      .run(new Uint8Array([0x00]));
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow("agent_channel 'ach_one' has an archived version");
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
  });

  it("a previous name of a merged kind fails the step, names it, and leaves the database at v40", () => {
    const { dbPath, db: setup } = v40Database();
    setup
      .prepare(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at, expires_at) VALUES ('agent_share', ?, 'old', 'ash_gone', 'previous', '2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z')`,
      )
      .run(MERGE_ORG);
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    expect(() => runMigrations(db, MERGE_VERSION)).toThrow(`agent_share name '${MERGE_ORG}/old' is a previous name`);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_40);
  });

  it("replays every frozen step over a share from before the slug ledger, its slug-only references rewritten to ids, then converts it", () => {
    const dbPath = tempDbPath();
    const setup = new DatabaseSync(dbPath);
    runMigrations(setup, SCHEMA_VERSION_7 - 1);
    insert(
      setup,
      "agent",
      AGENT.id,
      toBinary(AgentSchema, create(AgentSchema, { metadata: { id: AGENT.id, org: MERGE_ORG, slug: "helper", name: "Helper" } })),
    );
    insert(
      setup,
      "agent_share",
      "ash_early",
      shareRowBytes({ id: "ash_early", slug: "helper", agentRef: { org: MERGE_ORG, slug: "helper" }, createdAt: older }),
    );
    setup.close();

    const db = new DatabaseSync(dbPath);
    cleanups.push(() => db.close());
    runMigrations(db, MERGE_VERSION);
    const early = channelOf(db, "ash_early");
    expect(early.spec?.agentRef?.id, "the reference rewrite read the share's agent_ref through its frozen shape").toBe(AGENT.id);
    expect(early.spec?.agentRef?.kind).toBe(ApiResourceKind.agent);
    expect(count(db, "resource_names", "channel")).toBe(1);
  });
});

describe("v42: the schedule is a routine", () => {
  const ORG = "org_01jz0000000000000000000000";
  const SEEDED_AT = "2026-10-17 00:00:00";
  const SCHEDULE_LABEL = "stigmer.ai/schedule-id";
  const ROUTINE_LABEL = "stigmer.ai/routine-id";
  const ownerGrant = { principal: "identity_account:ida_bea", relation: "owner", resource: "schedule:sch_daily" };
  const viewerGrant = { principal: "identity_account:ida_cal", relation: "viewer", resource: "schedule:sch_daily" };
  const agentGrant = { principal: "identity_account:ida_bea", relation: "owner", resource: "agent:agt_helper" };

  /** A v41 database: the chain replayed up to the step before the rename. */
  function v41Database(): DatabaseSync {
    const db = new DatabaseSync(tempDbPath());
    cleanups.push(() => db.close());
    runMigrations(db, SCHEMA_VERSION_41);
    return db;
  }

  /** A schedule as a release before v42 stored it: its kind string and an sch_ id. */
  const stored = () =>
    create(RoutineSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Schedule",
      metadata: { id: "sch_daily", org: ORG, name: "Daily", slug: "daily" },
      spec: {
        cron: "0 9 * * *",
        timeZone: "Asia/Kolkata",
        enabled: true,
        agent: { agentRef: { org: ORG, id: "agt_helper" }, message: "Send the reminders." },
      },
      status: { consecutiveFailures: 2 },
    });

  function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
    db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, ?)`).run(kind, id, data, SEEDED_AT);
  }

  function ledgerRow(db: DatabaseSync, nominal: string, origin: string, executionId: string): void {
    db.prepare(
      `INSERT INTO schedule_runs (schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at)
       VALUES ('sch_daily', ?, ?, ?, 'completed', '', ?, ?, ?)`,
    ).run(ORG, nominal, origin, executionId, nominal, nominal);
  }

  function seed(db: DatabaseSync): void {
    insert(db, "schedule", "sch_daily", toBinary(RoutineSchema, stored()));
    db.prepare(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('schedule', 'sch_daily', 'agent', 'agt_helper', '')`).run();
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('schedule', ?, 'daily', 'sch_daily', 'current', ?)`,
    ).run(ORG, SEEDED_AT);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('schedule', ?, 'nightly', 'sch_daily', 'previous', ?)`,
    ).run(ORG, SEEDED_AT);
    for (const grant of [ownerGrant, viewerGrant, agentGrant]) {
      insert(db, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
    }
    db.prepare(
      `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
         principal_kind, principal_id, relation, resource_kind, resource_id, data)
       VALUES (?, 1, ?, 'granted', 'grant', 'ida_bea', 'user', ?, 'identity_account', 'ida_bea', 'owner', 'schedule', 'sch_daily', ?)`,
    ).run(ORG, "2026-10-17T00:00:00.000Z", grantIdAfterV34(ownerGrant), grantRowAfterV34(ownerGrant));
    db.prepare(`INSERT INTO grant_history_heads (org, last_sequence, last_occurred_at) VALUES (?, 1, ?)`).run(ORG, "2026-10-17T00:00:00.000Z");
    // A schedule fire and a manual fire of one second shared one run; a
    // manual fire of another second had its own.
    ledgerRow(db, "2026-10-16T09:00:00Z", "cron", "run_shared");
    ledgerRow(db, "2026-10-16T09:00:00Z", "manual", "run_shared");
    ledgerRow(db, "2026-10-16T10:15:30Z", "manual", "run_press");
    const fired = create(RunSchema, { metadata: { id: "run_shared", org: ORG, labels: { [SCHEDULE_LABEL]: "sch_daily" } } });
    stampEtag(RunSchema, fired);
    insert(db, "run", "run_shared", toBinary(RunSchema, fired));
    insert(db, "run", "run_plain", toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_plain", org: ORG } })));
  }

  it("moves the kind, its names current and previous, its sch_ id and its bytes but the kind string", () => {
    const db = v41Database();
    seed(db);
    runMigrations(db, SCHEMA_VERSION_42);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_42);

    for (const [table, column] of [
      ["resources", "id"],
      ["resource_list_keys", "id"],
    ] as const) {
      expect(db.prepare(`SELECT kind FROM ${table} WHERE ${column} = 'sch_daily'`).all()).toEqual([{ kind: "routine" }]);
    }
    expect(
      db.prepare(`SELECT kind, name, state FROM resource_names WHERE id = 'sch_daily' ORDER BY name`).all(),
    ).toEqual([
      { kind: "routine", name: "daily", state: "current" },
      { kind: "routine", name: "nightly", state: "previous" },
    ]);
    const row = db.prepare(`SELECT data FROM resources WHERE kind = 'routine' AND id = 'sch_daily'`).get() as { data: Uint8Array };
    const expected = stored();
    expected.kind = "Routine";
    expect(new Uint8Array(row.data)).toEqual(toBinary(RoutineSchema, expected));
  });

  it("re-keys the grants on the schedule, an Owner grant made Participant, and moves their history with them", () => {
    const db = v41Database();
    seed(db);
    runMigrations(db, SCHEMA_VERSION_42);

    const participant = { ...ownerGrant, relation: "participant", resource: "routine:sch_daily" };
    const viewer = { ...viewerGrant, resource: "routine:sch_daily" };
    const grants = db.prepare(`SELECT id FROM resources WHERE kind = 'grant' ORDER BY id`).all() as Array<{ id: string }>;
    expect(grants.map((grant) => grant.id).sort()).toEqual(
      [grantIdAfterV34(participant), grantIdAfterV34(viewer), grantIdAfterV34(agentGrant)].sort(),
    );
    const moved = fromBinary(
      GrantSchema,
      new Uint8Array(
        (db.prepare(`SELECT data FROM resources WHERE kind = 'grant' AND id = ?`).get(grantIdAfterV34(participant)) as { data: Uint8Array }).data,
      ),
    );
    expect(moved.spec?.relation).toBe("participant");
    expect(moved.spec?.resource?.kind).toBe("routine");
    expect(
      db.prepare(`SELECT grant_id, relation, resource_kind FROM grant_history WHERE org = ?`).all(ORG),
    ).toEqual([{ grant_id: grantIdAfterV34(participant), relation: "participant", resource_kind: "routine" }]);
  });

  it("rebuilds the fire ledger keyed by fire id: a manual fire that shared its second takes the suffix", () => {
    const db = v41Database();
    seed(db);
    runMigrations(db, SCHEMA_VERSION_42);

    expect(tableNames(db)).not.toContain("schedule_runs");
    expect(
      db
        .prepare(`SELECT routine_id, fire_id, origin, run_id, fired_by FROM routine_fires ORDER BY nominal_fire_time, fire_id`)
        .all(),
    ).toEqual([
      { routine_id: "sch_daily", fire_id: "sch-daily-20261016t090000z", origin: "schedule", run_id: "run_shared", fired_by: null },
      { routine_id: "sch_daily", fire_id: "sch-daily-20261016t090000z-manual", origin: "manual", run_id: "run_shared", fired_by: null },
      { routine_id: "sch_daily", fire_id: "sch-daily-20261016t101530z", origin: "manual", run_id: "run_press", fired_by: null },
    ]);
  });

  it("relabels the runs a schedule started, written unproven, and leaves other runs' bytes", () => {
    const db = v41Database();
    seed(db);
    const plain = new Uint8Array((db.prepare(`SELECT data FROM resources WHERE id = 'run_plain'`).get() as { data: Uint8Array }).data);
    runMigrations(db, SCHEMA_VERSION_42);

    const fired = db.prepare(`SELECT data, updated_at FROM resources WHERE kind = 'run' AND id = 'run_shared'`).get() as {
      data: Uint8Array;
      updated_at: string;
    };
    const run = fromBinary(RunSchema, new Uint8Array(fired.data));
    expect(run.metadata?.labels).toEqual({ [ROUTINE_LABEL]: "sch_daily" });
    expect(storedEtagOf(RunSchema, run)).toBe(etagOf(RunSchema, run));
    expect(fired.updated_at).not.toBe(SEEDED_AT);
    expect(new Uint8Array((db.prepare(`SELECT data FROM resources WHERE id = 'run_plain'`).get() as { data: Uint8Array }).data)).toEqual(plain);
  });

  it("a grant that does not decode fails the step, names the row, and leaves the database at v41", () => {
    const db = v41Database();
    seed(db);
    insert(db, "grant", "grt_broken", new Uint8Array([0xff, 0xff, 0xff]));
    expect(() => runMigrations(db, SCHEMA_VERSION_42)).toThrow(/grt_broken/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_41);
    expect(db.prepare(`SELECT kind FROM resources WHERE id = 'sch_daily'`).all()).toEqual([{ kind: "schedule" }]);
    expect(tableNames(db)).toContain("schedule_runs");
  });
});
