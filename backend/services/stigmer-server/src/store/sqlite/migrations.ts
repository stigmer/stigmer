/**
 * Versioned schema migrations — ports the inline chain in
 * backend/libs/go/store/sqlite/store.go (v1–v6, DDL character-faithful),
 * adds v7, the OD-3 consolidation (D2 §3), and v8, the by-resource
 * oauth_grant index (the channel teardown's query pattern, C3 Stage 6).
 *
 * Schema continuity across cutover is the design point: a database the Go
 * server created at any version migrates forward through the SAME steps Go
 * would have applied, and a fresh database replays the whole chain — one
 * code path, no adoption special-casing. Each migration runs in its own
 * transaction and records its version row; `schema_version` is
 * MAX(version), exactly as Go computes it.
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
 * Rollback safety (DD-006 cutover switch): a database at v7 re-opened by
 * the Go server passes Go's `currentVersion < 6` checks untouched, and
 * Go's consumer stores find their tables already present.
 *
 * Proven by __tests__/migrations.test.ts: fresh replay, Go-v6 fixture
 * adoption (sub-project DD-002), pre-ALTER pending_oauth_state shape, and
 * v7 data preservation.
 */
import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION_1 = 1;
export const SCHEMA_VERSION_2 = 2;
export const SCHEMA_VERSION_3 = 3;
export const SCHEMA_VERSION_4 = 4;
export const SCHEMA_VERSION_5 = 5;
export const SCHEMA_VERSION_6 = 6;
/** v7: OD-3 consolidation of the out-of-chain tables (this port's addition). */
export const SCHEMA_VERSION_7 = 7;
/** v8: the by-resource grant-teardown index (the C3 channel installer). */
export const SCHEMA_VERSION_8 = 8;

/** Target version for new databases. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_8;

/** Applies all pending migrations in order. */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion = getSchemaVersion(db);

  const chain: ReadonlyArray<readonly [number, (db: DatabaseSync) => void]> = [
    [SCHEMA_VERSION_1, migrateToV1],
    [SCHEMA_VERSION_2, migrateToV2],
    [SCHEMA_VERSION_3, migrateToV3],
    [SCHEMA_VERSION_4, migrateToV4],
    [SCHEMA_VERSION_5, migrateToV5],
    [SCHEMA_VERSION_6, migrateToV6],
    [SCHEMA_VERSION_7, migrateToV7],
    [SCHEMA_VERSION_8, migrateToV8],
  ];

  for (const [version, migrate] of chain) {
    if (currentVersion < version) {
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
 * node:sqlite is spike SP-C, pinned permanently by the driver tests.
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

/** v6: schedule_runs fire ledger (Go migrateToV6; stigmer-cloud DD-017 D-7). */
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
 * v7: OD-3 consolidation. DDL copied verbatim from the Go consumer stores
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
 * postgres chain's v2 ratified the doctrine: a query pattern owned by a
 * cloud extension does not exempt the index.
 */
function migrateToV8(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_grant_resource ON oauth_grant(resource_id, org_id);
  `);
}
