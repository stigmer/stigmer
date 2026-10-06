/**
 * Versioned schema migrations — ports the inline chain in
 * backend/libs/go/store/sqlite/store.go (v1–v6, DDL character-faithful),
 * adds v7, the consolidation of the out-of-chain tables, v8, the
 * by-resource oauth_grant index (the channel teardown's query pattern),
 * and the later steps each named at its constant below.
 *
 * Schema continuity across cutover is the design point: a database the Go
 * server created at any version migrates forward through the SAME steps Go
 * would have applied, and a fresh database replays the whole chain — one
 * code path, no adoption special-casing. Each migration runs in its own
 * transaction and records its version row; `schema_version` is
 * MAX(version), exactly as Go computes it.
 * A schema newer than this server supports is refused before migrations:
 * an older release must not serve a database it does not understand.
 *
 * v7 brings the three tables Go's consumer stores create lazily OUTSIDE
 * the chain (signal_dedupe — workflowexecution/dedupe; oauth_grant and
 * pending_oauth_state — mcpserver/oauth) under version control. Its DDL is
 * copied from those constructors verbatim, IF NOT EXISTS, so a live
 * database that already has the tables (any database the Go server ever
 * served signals/OAuth on) is adopted with its data untouched. It also
 * replays the constructors' idempotent ALTER TABLE ADD COLUMN calls for
 * pending_oauth_state (`org`, `token_auth_method`): a user's table may
 * predate those columns, and Go reconciled them at every boot — v7 is the
 * last writer that must do the same.
 *
 * Rollback safety: a database at v7 re-opened by
 * the Go server passes Go's `currentVersion < 6` checks untouched, and
 * Go's consumer stores find their tables already present.
 *
 * Proven by __tests__/migrations.test.ts: fresh replay, Go-v6 fixture
 * adoption, pre-ALTER pending_oauth_state shape, and
 * v7 data preservation.
 */
import type { DatabaseSync } from "node:sqlite";

import {
  AGENT_KIND,
  POLICY_KIND,
  RETIRED_INSTANCE_KIND,
  RETIREMENT_PAGE_SIZE,
  SESSION_KIND,
  agentFactsOf,
  instanceAgentIdOf,
  migrateSessionRow,
  policyNamesRetiredInstance,
  unreadableRowError,
} from "../agent-instance-retired.js";
import type { InstanceAgent } from "../agent-instance-retired.js";
import {
  EXECUTION_CONFIG_PAGE_SIZE,
  EXECUTION_KIND,
  migrateExecutionRow,
  unreadableExecutionError,
} from "../execution-config-retired.js";
import {
  HISTORY_PAGE_SIZE,
  ORGANIZATION_SCOPED_KINDS_AT_LEDGER,
  organizationNamedBy,
  undecodableRowError,
} from "../organization-slug-history.js";
import {
  PUBLIC_ROW_KINDS_AT_RETIREMENT,
  movePublicRowToOrg,
} from "../public-visibility-retired.js";
import {
  RETIRED_WORKFLOW_INSTANCE_KIND,
  WORKFLOW_RETIREMENT_PAGE_SIZE,
  WORKFLOW_RETIREMENT_POLICY_KIND,
  policyNamesRetiredWorkflowInstance,
  unreadableWorkflowRowError,
} from "../workflow-instance-retired.js";
import {
  RETIRED_AGENT_RUN_KIND,
  RUN_KIND_RENAMES,
  RUN_KIND_TABLES,
  RUN_RENAME_PAGE_SIZE,
  RUN_RENAME_POLICY_KIND,
  rekeyedRunPolicy,
  renamedAgentRunRow,
  unreadableRunRenameRowError,
} from "../run-rename.js";
import type { RekeyedPolicy } from "../run-rename.js";
import {
  AGENT_RUN_KIND,
  AGENT_RUN_RETIRED_PAGE_SIZE,
  RETIRED_WORKFLOW_KINDS,
  RETIRED_WORKFLOW_TABLES,
  WORKFLOW_RETIRED_PAGE_SIZE,
  WORKFLOW_RETIRED_POLICY_KIND,
  migrateAgentRunRow,
  policyNamesRetiredWorkflowKind,
  unreadableRetiredWorkflowRowError,
} from "../workflow-retired.js";

export const SCHEMA_VERSION_1 = 1;
export const SCHEMA_VERSION_2 = 2;
export const SCHEMA_VERSION_3 = 3;
export const SCHEMA_VERSION_4 = 4;
export const SCHEMA_VERSION_5 = 5;
export const SCHEMA_VERSION_6 = 6;
/** v7: consolidation of the out-of-chain tables (this port's addition). */
export const SCHEMA_VERSION_7 = 7;
/** v8: the by-resource grant-teardown index (the channel installer's teardown). */
export const SCHEMA_VERSION_8 = 8;
/** v9: the rows of the removed Project kind deleted. */
export const SCHEMA_VERSION_9 = 9;
/** v10: every row holding the retired public visibility level moved to org. */
export const SCHEMA_VERSION_10 = 10;
/** v11: the list index's columns, key table and indexes (DDL only). */
export const SCHEMA_VERSION_11 = 11;
/** v12: the organization-slug ledger, filled with every slug taken before it. */
export const SCHEMA_VERSION_12 = 12;
/** v13: the resource-name table replaces the organization-slug ledger. */
export const SCHEMA_VERSION_13 = 13;
/** v14: sessions name their agent directly; the agent instance rows removed. */
export const SCHEMA_VERSION_14 = 14;
/** v15: every turn's settings move out of the retired execution_config. */
export const SCHEMA_VERSION_15 = 15;
/** v16: the organization deletion table (DDL only). */
export const SCHEMA_VERSION_16 = 16;
/** v17: the workflow instance rows removed. */
export const SCHEMA_VERSION_17 = 17;
/** v18: agent executions are runs. */
export const SCHEMA_VERSION_18 = 18;
/** v19: the workflow, workflow run and artifact rows removed, with the tables only workflows wrote. */
export const SCHEMA_VERSION_19 = 19;

/** Target version for new databases. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_19;

/**
 * Applies every pending migration up to `targetVersion` in order — all of
 * them unless a test builds the database a given step starts from.
 */
export function runMigrations(
  db: DatabaseSync,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion = getSchemaVersion(db);
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION}). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
    );
  }

  const chain: ReadonlyArray<readonly [number, (db: DatabaseSync) => void]> = [
    [SCHEMA_VERSION_1, migrateToV1],
    [SCHEMA_VERSION_2, migrateToV2],
    [SCHEMA_VERSION_3, migrateToV3],
    [SCHEMA_VERSION_4, migrateToV4],
    [SCHEMA_VERSION_5, migrateToV5],
    [SCHEMA_VERSION_6, migrateToV6],
    [SCHEMA_VERSION_7, migrateToV7],
    [SCHEMA_VERSION_8, migrateToV8],
    [SCHEMA_VERSION_9, migrateToV9],
    [SCHEMA_VERSION_10, migrateToV10],
    [SCHEMA_VERSION_11, migrateToV11],
    [SCHEMA_VERSION_12, migrateToV12],
    [SCHEMA_VERSION_13, migrateToV13],
    [SCHEMA_VERSION_14, migrateToV14],
    [SCHEMA_VERSION_15, migrateToV15],
    [SCHEMA_VERSION_16, migrateToV16],
    [SCHEMA_VERSION_17, migrateToV17],
    [SCHEMA_VERSION_18, migrateToV18],
    [SCHEMA_VERSION_19, migrateToV19],
  ];

  for (const [version, migrate] of chain) {
    if (currentVersion < version && version <= targetVersion) {
      applyInTransaction(db, version, migrate);
    }
  }
}

/** Current schema version; 0 when none has been recorded yet. */
export function getSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function applyInTransaction(
  db: DatabaseSync,
  version: number,
  migrate: (db: DatabaseSync) => void,
): void {
  db.exec("BEGIN");
  try {
    migrate(db);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(version);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`migrate to v${version}: ${String(error)}`, {
      cause: error,
    });
  }
}

/** v1: the initial resources table (Go migrateToV1). */
function migrateToV1(db: DatabaseSync): void {
  // WITHOUT ROWID creates a clustered index on (kind, id) for optimal lookups.
  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_resources_kind_id ON resources(kind, id);
  `);
}

/**
 * v2: the dedicated audit table + legacy-record migration (Go migrateToV2).
 * NOTE: despite Go's comment about CASCADE, no foreign key is declared —
 * audit cleanup is explicit via deleteAuditByResourceId. The absence ports
 * as-is (schema parity beats comment accuracy).
 */
function migrateToV2(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      data BLOB NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      version_hash TEXT,
      tag TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_resource ON resource_audit(kind, resource_id);

    CREATE INDEX IF NOT EXISTS idx_audit_hash ON resource_audit(kind, resource_id, version_hash);

    CREATE INDEX IF NOT EXISTS idx_audit_tag ON resource_audit(kind, resource_id, tag, archived_at DESC);
  `);

  migrateLegacyAuditRecords(db);
}

/**
 * Moves legacy prefix-based audit rows ("<type>_audit/<resource_id>/<ts>",
 * stored in `resources`) into resource_audit — Go migrateAuditRecords.
 * version_hash and tag stay empty for migrated rows (the concrete proto
 * type is unknown here); hash/tag lookups skip them by design, the full
 * snapshot is preserved.
 */
function migrateLegacyAuditRecords(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT kind, id, data, updated_at FROM resources WHERE id LIKE '%_audit/%'`,
    )
    .all() as Array<{
    kind: string;
    id: string;
    data: Uint8Array;
    updated_at: string;
  }>;

  if (rows.length === 0) {
    return;
  }

  const insert = db.prepare(
    `INSERT INTO resource_audit (kind, resource_id, data, archived_at, version_hash, tag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const idsToDelete: string[] = [];

  for (const row of rows) {
    // Legacy id format: "<type>_audit/<resource_id>/<timestamp>".
    const parts = row.id.split("/");
    if (parts.length < 2 || parts[1] === undefined || parts[1] === "") {
      continue; // skip malformed records, as Go does
    }
    insert.run(row.kind, parts[1], row.data, row.updated_at, "", "");
    idsToDelete.push(row.id);
  }

  if (idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => "?").join(",");
    db.prepare(`DELETE FROM resources WHERE id IN (${placeholders})`).run(
      ...idsToDelete,
    );
  }
}

/**
 * v3: the FTS5 full-text search index (Go migrateToV3). porter unicode61 =
 * English stemming + Unicode normalization; UNINDEXED columns are stored
 * for filtering/sorting but not searchable. Availability of FTS5 in
 * node:sqlite is pinned permanently by the driver tests.
 */
function migrateToV3(db: DatabaseSync): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      kind,
      resource_id UNINDEXED,
      name,
      description,
      tags,
      org UNINDEXED,
      visibility UNINDEXED,
      created_at UNINDEXED,
      tokenize='porter unicode61'
    );
  `);
}

/** v4: bootstrap_state key-value table (Go migrateToV4). */
function migrateToV4(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) WITHOUT ROWID;
  `);
}

/** v5: workflow_execution_events append-only event log (Go migrateToV5). */
function migrateToV5(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_execution_events (
      execution_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      task_name TEXT NOT NULL DEFAULT '',
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (execution_id, sequence_number)
    );

    CREATE INDEX IF NOT EXISTS idx_wfee_execution_type
      ON workflow_execution_events(execution_id, event_type);

    CREATE INDEX IF NOT EXISTS idx_wfee_execution_task
      ON workflow_execution_events(execution_id, task_name);
  `);
}

/** v6: schedule_runs fire ledger (Go migrateToV6). */
function migrateToV6(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_runs (
      schedule_id TEXT NOT NULL,
      org TEXT NOT NULL DEFAULT '',
      nominal_fire_time TEXT NOT NULL,
      origin TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      execution_id TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      completed_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (schedule_id, nominal_fire_time, origin)
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_runs_recency
      ON schedule_runs(schedule_id, recorded_at DESC);
  `);
}

/**
 * v7: the consolidation. DDL copied verbatim from the Go consumer stores
 * (signal_dedupe_store.go createTable; grant_store.go /
 * pending_state_store.go ensureTable) — IF NOT EXISTS adopts a live
 * database's existing tables and data untouched.
 */
function migrateToV7(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_dedupe (
      id TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CLAIMED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signal_dedupe_org ON signal_dedupe(org);

    CREATE INDEX IF NOT EXISTS idx_signal_dedupe_expires ON signal_dedupe(expires_at);

    CREATE TABLE IF NOT EXISTS oauth_grant (
      identity_account_id    TEXT NOT NULL,
      resource_id            TEXT NOT NULL,
      resource_kind          TEXT NOT NULL DEFAULT '',
      org_id                 TEXT NOT NULL DEFAULT '',
      access_token_expires_at INTEGER NOT NULL DEFAULT 0,
      client_id              TEXT NOT NULL DEFAULT '',
      auth_method            TEXT NOT NULL DEFAULT '',
      token_endpoint         TEXT NOT NULL DEFAULT '',
      access_token_env_var   TEXT NOT NULL DEFAULT '',
      refresh_token_env_var  TEXT NOT NULL DEFAULT '',
      environment_id         TEXT NOT NULL DEFAULT '',
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL,
      PRIMARY KEY (identity_account_id, resource_id, org_id)
    );

    CREATE TABLE IF NOT EXISTS pending_oauth_state (
      state               TEXT PRIMARY KEY,
      code_verifier       TEXT NOT NULL,
      client_id           TEXT NOT NULL DEFAULT '',
      client_secret       TEXT NOT NULL DEFAULT '',
      token_endpoint      TEXT NOT NULL DEFAULT '',
      mcp_server_id       TEXT NOT NULL,
      identity_account_id TEXT NOT NULL,
      target_env_var      TEXT NOT NULL DEFAULT '',
      auth_method         TEXT NOT NULL DEFAULT '',
      token_auth_method   TEXT NOT NULL DEFAULT '',
      redirect_uri        TEXT NOT NULL DEFAULT '',
      org                 TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL
    );
  `);

  // Go's pending_oauth_state store gained `org` and `token_auth_method`
  // through idempotent ALTERs at constructor time (errors deliberately
  // swallowed), so a live table may predate the columns. v7 replays the
  // reconciliation once; the swallow mirrors Go's `_, _ =` discard.
  for (const alter of [
    `ALTER TABLE pending_oauth_state ADD COLUMN org TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE pending_oauth_state ADD COLUMN token_auth_method TEXT NOT NULL DEFAULT ''`,
  ]) {
    try {
      db.exec(alter);
    } catch {
      // Column already exists — the CREATE above or a prior Go boot added it.
    }
  }
}

/**
 * v8: the by-resource grant sweep's index.
 *
 * OAuthGrantStore.deleteByResourceId (the cloud channel teardown's arm)
 * deletes every grant for a resource regardless of granting identity; the
 * primary key leads with identity_account_id, so without this index the
 * sweep scans. The Java edition carries the identical index
 * (idx_oauth_grant_resource) for the identical delete cascade, and the
 * postgres chain's v2 set the doctrine: a query pattern owned by a
 * cloud extension does not exempt the index.
 */
function migrateToV8(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_grant_resource ON oauth_grant(resource_id, org_id);
  `);
}

/**
 * v9: the Project kind (kind 60, id prefix "prj") was removed from the
 * contract, so a database seeded by an earlier release may hold rows no
 * code can read, list or delete any more. Rows are deleted, not archived:
 * the audit table is the version history of kinds the server serves, and
 * bytes of a kind nothing will ever decode are not history. The kind
 * column holds the enum NAME (proto-fields.ts apiResourceKindName), which
 * is why the literal string works after the enum value is gone. The search
 * index is not touched here: boot's RebuildIndex clears it and re-indexes
 * only the registered kinds. Member rows the Project once listed are
 * ordinary resources of their own kinds and stay.
 */
function migrateToV9(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM resources WHERE kind = 'project';
    DELETE FROM resource_audit WHERE kind = 'project';
  `);
}

/**
 * v10: the public visibility level is retired, so every row that still
 * holds it is moved to org visibility — the chain's first migration that
 * decodes a row (public-visibility-retired.ts says why a migration, why
 * the kind table is frozen there, and why an undecodable row fails the
 * step). This step owns the SQL: one read per kind in the frozen table,
 * one UPDATE per moved row with `updated_at` bumped the way saveResource
 * bumps it, rows that hold any other level left byte-for-byte as they
 * are. Runs inside applyInTransaction's BEGIN, so a throw from the mover
 * rolls the whole step back and the boot stops on the row it names.
 */
function migrateToV10(db: DatabaseSync): void {
  const update = db.prepare(
    `UPDATE resources SET data = ?, updated_at = datetime('now') WHERE kind = ? AND id = ?`,
  );
  for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
    const rows = db
      .prepare(`SELECT id, data FROM resources WHERE kind = ?`)
      .all(entry.kind) as Array<{ id: string; data: Uint8Array }>;
    for (const row of rows) {
      let moved: Uint8Array | undefined;
      try {
        moved = movePublicRowToOrg(entry, row.data);
      } catch (error) {
        throw new Error(
          `${entry.kind} '${row.id}' cannot be moved off the retired public level: ${String(error)}`,
          { cause: error },
        );
      }
      if (moved !== undefined) {
        update.run(moved, entry.kind, row.id);
      }
    }
  }
}

/**
 * v11: the list index (../list-index.ts) — schema only, the Postgres
 * driver's v6 in this engine's terms (postgres/migrations.ts gives the
 * reasons for every column and index). Existing rows, a Go-era database's
 * included, arrive unproven and are derived by the store's reconciliation
 * at open. sqlite compares text as bytes (BINARY) by default, the order
 * list-index.ts merges in, so no collation is spelled here. The store now
 * writes `updated_at` to the millisecond and the stamp from the same
 * expression in the same statement; a writer that does not know the index
 * writes `datetime('now')`, whole seconds, which can never equal a stamp.
 */
function migrateToV11(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE resources ADD COLUMN list_org TEXT;
    ALTER TABLE resources ADD COLUMN list_created_at TEXT;
    ALTER TABLE resources ADD COLUMN list_index_revision INTEGER;
    ALTER TABLE resources ADD COLUMN list_indexed_at TEXT;

    CREATE INDEX idx_resources_list_org
      ON resources (kind, list_org, list_created_at, id);
    CREATE INDEX idx_resources_list_created
      ON resources (kind, list_created_at, id);
    CREATE INDEX idx_resources_list_revision
      ON resources (kind, list_index_revision);
    CREATE INDEX idx_resources_list_unproven
      ON resources (kind, id) WHERE list_indexed_at IS NOT updated_at;

    CREATE TABLE resource_list_keys (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (kind, id, key)
    ) WITHOUT ROWID;

    CREATE INDEX idx_resource_list_keys_lookup
      ON resource_list_keys (kind, key, value, created_at, id);
  `);
}

/**
 * v12: the organization-slug ledger, the Postgres driver's v7 in this
 * engine's terms (postgres/migrations.ts gives the reasons for the table's
 * shape and the fill's order; organization-slug-history.ts what the fill
 * records and why an undecodable row fails the step). Runs inside
 * applyInTransaction's BEGIN, so a throw rolls the whole step back and the
 * boot stops on the row it names. INSERT OR IGNORE keeps a live
 * organization's entry unretired whatever its rows say.
 */
function migrateToV12(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE organization_slugs (
      slug TEXT PRIMARY KEY,
      claimed_at TEXT NOT NULL,
      retired_at TEXT
    ) WITHOUT ROWID;
  `);
  const recordedAt = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO organization_slugs (slug, claimed_at)
     SELECT id, ? FROM resources WHERE kind = 'organization'`,
  ).run(recordedAt);

  const page = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const named = new Set<string>();
  for (const entry of ORGANIZATION_SCOPED_KINDS_AT_LEDGER) {
    let after = "";
    for (;;) {
      const rows = page.all(entry.kind, after, HISTORY_PAGE_SIZE) as Array<{
        id: string;
        data: Uint8Array;
      }>;
      for (const row of rows) {
        let org: string;
        try {
          org = organizationNamedBy(entry, row.data);
        } catch (error) {
          throw undecodableRowError(entry, row.id, error);
        }
        if (org !== "") {
          named.add(org);
        }
      }
      if (rows.length < HISTORY_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
  }
  const retire = db.prepare(
    `INSERT OR IGNORE INTO organization_slugs (slug, claimed_at, retired_at) VALUES (?, ?, ?)`,
  );
  for (const slug of named) {
    retire.run(slug, recordedAt, recordedAt);
  }
}

/**
 * v13: the resource-name table, the Postgres driver's v8 in this engine's
 * terms (postgres/migrations.ts gives the reasons for the table and the
 * fill). Runs inside applyInTransaction's BEGIN, so the table, its fill and
 * the ledger's drop land together or not at all.
 */
function migrateToV13(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE resource_names (
      kind TEXT NOT NULL,
      org TEXT NOT NULL,
      name TEXT NOT NULL,
      id TEXT NOT NULL,
      state TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (kind, org, name)
    ) WITHOUT ROWID;

    CREATE INDEX idx_resource_names_id ON resource_names (kind, org, id);
  `);
  db.prepare(
    `INSERT INTO resource_names (kind, org, name, id, state, claimed_at)
     SELECT 'organization', '', id, id, 'current', ?
     FROM resources WHERE kind = 'organization'`,
  ).run(new Date().toISOString());
  // Every other slug the ledger held (a deleted organization's) stays
  // reserved: a previous name equal to its id that never expires.
  db.exec(`
    INSERT OR IGNORE INTO resource_names (kind, org, name, id, state, claimed_at)
    SELECT 'organization', '', slug, slug, 'previous', claimed_at
    FROM organization_slugs
  `);
  db.exec(`DROP TABLE organization_slugs`);
}

/**
 * v14: the agent instance kind is removed — the Postgres driver's v9 in
 * this engine's terms (agent-instance-retired.ts says what each session
 * becomes and why an unreadable row fails the step). Every instance row is
 * read in keyset pages for the agent it names, each named agent once by
 * point read, then every session in keyset pages, rewritten when it names
 * an instance with `updated_at` bumped (the list index re-derives a row
 * whose stamp no longer matches, at open). Every IamPolicy row naming an
 * instance as resource or principal is found in keyset pages and deleted
 * with its list keys, its history kept, as the store deletes a policy. The
 * instance rows, their history and their list keys are then deleted; the
 * search index is left
 * to boot's RebuildIndex, which re-indexes only the registered kinds (the
 * v9 precedent).
 * Runs inside applyInTransaction's BEGIN, so a throw rolls the whole step
 * back and the boot stops on the row it names.
 */
function migrateToV14(db: DatabaseSync): void {
  const page = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const pages = function* (
    kind: string,
  ): Generator<{ id: string; data: Uint8Array }> {
    let after = "";
    for (;;) {
      const rows = page.all(kind, after, RETIREMENT_PAGE_SIZE) as Array<{
        id: string;
        data: Uint8Array;
      }>;
      yield* rows;
      if (rows.length < RETIREMENT_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const instanceAgents = new Map<string, string>();
  for (const row of pages(RETIRED_INSTANCE_KIND)) {
    try {
      instanceAgents.set(row.id, instanceAgentIdOf(row.data));
    } catch (error) {
      throw unreadableRowError(RETIRED_INSTANCE_KIND, row.id, error);
    }
  }
  const readAgent = db.prepare(
    `SELECT data FROM resources WHERE kind = ? AND id = ?`,
  );
  const agents = new Map<string, InstanceAgent>();
  for (const agentId of new Set(instanceAgents.values())) {
    if (agentId === "") {
      continue;
    }
    const row = readAgent.get(AGENT_KIND, agentId) as
      | { data: Uint8Array }
      | undefined;
    try {
      agents.set(
        agentId,
        row === undefined
          ? { kind: "agent-gone", agentId }
          : agentFactsOf(row.data),
      );
    } catch (error) {
      throw unreadableRowError(AGENT_KIND, agentId, error);
    }
  }
  const agentOf = (instanceId: string): InstanceAgent | undefined => {
    const agentId = instanceAgents.get(instanceId);
    return agentId === undefined || agentId === ""
      ? undefined
      : agents.get(agentId);
  };

  const update = db.prepare(
    `UPDATE resources SET data = ?, updated_at = datetime('now') WHERE kind = ? AND id = ?`,
  );
  for (const row of pages(SESSION_KIND)) {
    let migrated: Uint8Array | undefined;
    try {
      migrated = migrateSessionRow(row.data, agentOf);
    } catch (error) {
      throw unreadableRowError(SESSION_KIND, row.id, error);
    }
    if (migrated !== undefined) {
      update.run(migrated, SESSION_KIND, row.id);
    }
  }

  const retiredPolicies: string[] = [];
  for (const row of pages(POLICY_KIND)) {
    try {
      if (policyNamesRetiredInstance(row.data)) {
        retiredPolicies.push(row.id);
      }
    } catch (error) {
      throw unreadableRowError(POLICY_KIND, row.id, error);
    }
  }
  const deletePolicy = ["resource_list_keys", "resources"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`),
  );
  for (const id of retiredPolicies) {
    for (const statement of deletePolicy) {
      statement.run(POLICY_KIND, id);
    }
  }

  for (const table of ["resource_audit", "resource_list_keys", "resources"]) {
    db.prepare(`DELETE FROM ${table} WHERE kind = ?`).run(
      RETIRED_INSTANCE_KIND,
    );
  }
}

/**
 * v15: a turn's settings leave the retired execution_config — the Postgres
 * driver's v10 in this engine's terms (execution-config-retired.ts says what
 * each row becomes and why an unreadable row fails the step). Every
 * execution row is read in keyset pages and rewritten unless it is already
 * in the current shape, its `updated_at` left alone (the list keys it feeds
 * are unchanged). Runs inside applyInTransaction's BEGIN, so a throw rolls
 * the whole step back and the boot stops on the row it names.
 */
function migrateToV15(db: DatabaseSync): void {
  const page = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const update = db.prepare(
    `UPDATE resources SET data = ? WHERE kind = ? AND id = ?`,
  );
  for (let after = ""; ; ) {
    const rows = page.all(EXECUTION_KIND, after, EXECUTION_CONFIG_PAGE_SIZE) as Array<{
      id: string;
      data: Uint8Array;
    }>;
    for (const row of rows) {
      let migrated: Uint8Array | undefined;
      try {
        migrated = migrateExecutionRow(row.data);
      } catch (error) {
        throw unreadableExecutionError(row.id, error);
      }
      if (migrated !== undefined) {
        update.run(migrated, EXECUTION_KIND, row.id);
      }
    }
    if (rows.length < EXECUTION_CONFIG_PAGE_SIZE) {
      return;
    }
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * v16: the organizations being deleted, one row each (interface.ts,
 * OrganizationDeletionStore, says why the state is not on the
 * organization's row). DDL only: no database before this version holds an
 * organization being deleted, because a delete removed everything it
 * removed in its own request.
 */
function migrateToV16(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE organization_deletions (
      org TEXT NOT NULL PRIMARY KEY,
      phase TEXT NOT NULL,
      marked_at TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT '',
      heartbeat_at TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT ''
    ) WITHOUT ROWID;
  `);
}

/**
 * v17: the workflow instance kind is removed — the Postgres driver's v12 in
 * this engine's terms (workflow-instance-retired.ts says what leaves and
 * why an unreadable row fails the step). Every IamPolicy row naming an
 * instance as resource or principal is found in keyset pages and deleted
 * with its list keys, its history kept, as the store deletes a policy. The
 * instance rows, their history and their list keys are then deleted; the
 * search index is left to boot's RebuildIndex, which re-indexes only the
 * registered kinds (the v14 precedent). Runs inside applyInTransaction's
 * BEGIN, so a throw rolls the whole step back and the boot stops on the row
 * it names.
 */
function migrateToV17(db: DatabaseSync): void {
  const page = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const retiredPolicies: string[] = [];
  for (let after = ""; ; ) {
    const rows = page.all(
      WORKFLOW_RETIREMENT_POLICY_KIND,
      after,
      WORKFLOW_RETIREMENT_PAGE_SIZE,
    ) as Array<{ id: string; data: Uint8Array }>;
    for (const row of rows) {
      try {
        if (policyNamesRetiredWorkflowInstance(row.data)) {
          retiredPolicies.push(row.id);
        }
      } catch (error) {
        throw unreadableWorkflowRowError(
          WORKFLOW_RETIREMENT_POLICY_KIND,
          row.id,
          error,
        );
      }
    }
    if (rows.length < WORKFLOW_RETIREMENT_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  const deletePolicy = ["resource_list_keys", "resources"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`),
  );
  for (const id of retiredPolicies) {
    for (const statement of deletePolicy) {
      statement.run(WORKFLOW_RETIREMENT_POLICY_KIND, id);
    }
  }

  for (const table of ["resource_audit", "resource_list_keys", "resources"]) {
    db.prepare(`DELETE FROM ${table} WHERE kind = ?`).run(
      RETIRED_WORKFLOW_INSTANCE_KIND,
    );
  }
}

/**
 * v18: agent executions are runs — the Postgres driver's v13 in this
 * engine's terms (run-rename.ts says what each row becomes and why an
 * unreadable row fails the step). Every run row is read in keyset pages
 * under its old kind and rewritten when its bytes spell the kind the old
 * way; then every table keyed by kind renames the run kind. Every IamPolicy
 * row is read in keyset pages, and the ones naming a run kind are re-keyed:
 * the old row leaves with its list keys, its history kept, and the new row
 * is written unproven with `updated_at` stamped, so the list index derives
 * its keys at open. The search index is left to boot's RebuildIndex (the
 * v14 precedent). Runs inside applyInTransaction's BEGIN, so a throw rolls
 * the whole step back and the boot stops on the row it names.
 */
function migrateToV18(db: DatabaseSync): void {
  const resourcePage = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const resources = function* (
    kind: string,
  ): Generator<{ id: string; data: Uint8Array }> {
    let after = "";
    for (;;) {
      const rows = resourcePage.all(kind, after, RUN_RENAME_PAGE_SIZE) as Array<{
        id: string;
        data: Uint8Array;
      }>;
      yield* rows;
      if (rows.length < RUN_RENAME_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };
  const rewrite = db.prepare(
    `UPDATE resources SET data = ? WHERE kind = ? AND id = ?`,
  );
  for (const row of resources(RETIRED_AGENT_RUN_KIND)) {
    let data: Uint8Array | undefined;
    try {
      data = renamedAgentRunRow(row.data);
    } catch (error) {
      throw unreadableRunRenameRowError(RETIRED_AGENT_RUN_KIND, row.id, error);
    }
    if (data !== undefined) {
      rewrite.run(data, RETIRED_AGENT_RUN_KIND, row.id);
    }
  }
  for (const [from, to] of RUN_KIND_RENAMES) {
    for (const table of RUN_KIND_TABLES) {
      db.prepare(`UPDATE ${table} SET kind = ? WHERE kind = ?`).run(to, from);
    }
  }

  const rekeyed: Array<{ from: string; policy: RekeyedPolicy }> = [];
  for (const row of resources(RUN_RENAME_POLICY_KIND)) {
    try {
      const policy = rekeyedRunPolicy(row.data);
      if (policy !== undefined) {
        rekeyed.push({ from: row.id, policy });
      }
    } catch (error) {
      throw unreadableRunRenameRowError(RUN_RENAME_POLICY_KIND, row.id, error);
    }
  }
  const deletePolicy = ["resource_list_keys", "resources"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`),
  );
  const insertPolicy = db.prepare(
    `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
  );
  for (const { from, policy } of rekeyed) {
    for (const statement of deletePolicy) {
      statement.run(RUN_RENAME_POLICY_KIND, from);
    }
    insertPolicy.run(RUN_RENAME_POLICY_KIND, policy.id, policy.data);
  }
}

/**
 * v19: workflows, workflow runs and the artifact kind are removed — the
 * Postgres driver's v14 in this engine's terms (workflow-retired.ts says
 * what leaves, what each agent run becomes and why an unreadable row fails
 * the step). Every IamPolicy row is read in keyset pages, and the ones
 * naming a retired kind as resource or principal are deleted with their
 * list keys, their history kept, as the store deletes a policy. Every
 * agent run is read in keyset pages and rewritten when it carries a
 * workflow parent, a workflow step's task token or a workflow lineage
 * label, its `updated_at` left alone (no list key of a run reads them).
 * Every row of a retired kind is then deleted from every table keyed by
 * kind, and the two tables only workflows wrote are dropped; the search
 * index is left to boot's RebuildIndex, which re-indexes only the
 * registered kinds (the v14 precedent). Runs inside applyInTransaction's
 * BEGIN, so a throw rolls the whole step back and the boot stops on the row
 * it names.
 */
function migrateToV19(db: DatabaseSync): void {
  const page = db.prepare(
    `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const pages = function* (
    kind: string,
    size: number,
  ): Generator<{ id: string; data: Uint8Array }> {
    let after = "";
    for (;;) {
      const rows = page.all(kind, after, size) as Array<{
        id: string;
        data: Uint8Array;
      }>;
      yield* rows;
      if (rows.length < size) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const retiredPolicies: string[] = [];
  for (const row of pages(
    WORKFLOW_RETIRED_POLICY_KIND,
    WORKFLOW_RETIRED_PAGE_SIZE,
  )) {
    try {
      if (policyNamesRetiredWorkflowKind(row.data)) {
        retiredPolicies.push(row.id);
      }
    } catch (error) {
      throw unreadableRetiredWorkflowRowError(
        WORKFLOW_RETIRED_POLICY_KIND,
        row.id,
        error,
      );
    }
  }
  const deletePolicy = ["resource_list_keys", "resources"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE kind = ? AND id = ?`),
  );
  for (const id of retiredPolicies) {
    for (const statement of deletePolicy) {
      statement.run(WORKFLOW_RETIRED_POLICY_KIND, id);
    }
  }

  const rewrite = db.prepare(
    `UPDATE resources SET data = ? WHERE kind = ? AND id = ?`,
  );
  for (const row of pages(AGENT_RUN_KIND, AGENT_RUN_RETIRED_PAGE_SIZE)) {
    let migrated: Uint8Array | undefined;
    try {
      migrated = migrateAgentRunRow(row.data);
    } catch (error) {
      throw unreadableRetiredWorkflowRowError(AGENT_RUN_KIND, row.id, error);
    }
    if (migrated !== undefined) {
      rewrite.run(migrated, AGENT_RUN_KIND, row.id);
    }
  }

  for (const table of RUN_KIND_TABLES) {
    const remove = db.prepare(`DELETE FROM ${table} WHERE kind = ?`);
    for (const kind of RETIRED_WORKFLOW_KINDS) {
      remove.run(kind);
    }
  }
  for (const table of RETIRED_WORKFLOW_TABLES) {
    db.exec(`DROP TABLE ${table}`);
  }
}
