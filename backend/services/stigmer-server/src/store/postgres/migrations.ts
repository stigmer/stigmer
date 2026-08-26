/**
 * Versioned schema migrations for the Postgres driver — an INDEPENDENT
 * chain starting at its own v1 (DD-010 §3). It deliberately does NOT
 * mirror sqlite's v1–v7: that chain's value is Go-DDL fidelity for adopted
 * laptop databases, a concern Postgres cannot have (no Postgres database
 * predates this driver). Same runner discipline as sqlite/migrations.ts —
 * deliberate, versioned, each step in its own transaction, `schema_version`
 * = MAX(version).
 *
 * Physical-layout choices and their rationale:
 *
 * - Resource/audit/event payloads are BYTEA holding the marshaled proto
 *   bytes — NEVER JSONB. Audit hashes are content-addressed over these
 *   exact bytes and proto→JSON→proto round-trips drop unknown fields, so a
 *   JSON-shaped source of truth would corrupt the audit hash chain
 *   (sub-project T01 gate decision D-1, refining DD-010's sketch).
 * - Ledger time columns that cross the Store interface (recorded_at,
 *   completed_at, expires_at, …) are TEXT holding the exact strings the
 *   contracts carry: markLatestScheduleRunTerminal picks "newest" by
 *   lexicographic RFC-3339 comparison, and timestamptz would silently
 *   reformat values. Driver-internal bookkeeping columns (updated_at,
 *   archived_at ordering) use native types freely.
 * - Real indexes from day one — every named query method has a supporting
 *   index (DD-003 "every query pattern has an index"; the sqlite driver
 *   deliberately deferred physical indexing, this driver does not).
 * - search_index is an ordinary table with a STORED generated tsvector
 *   (DD-009: engine syntax and ranking live inside the driver). Weight
 *   classes: name=A, tags=B, description=C — see tsquery.ts for why the
 *   sqlite bm25 vector cannot map one-to-one.
 *
 * The whole chain runs under pg_advisory_lock: unlike sqlite's single-file
 * lock, nothing else stops two server instances booting against one
 * database from racing the chain (compose scale-out, a second `docker
 * run`). The lock is session-scoped and released in a finally.
 *
 * Proven by __tests__/migrations.test.ts (fresh replay, idempotent reopen,
 * version tracking) against a real Postgres.
 */
import type { PoolClient } from "pg";

export const SCHEMA_VERSION_1 = 1;

/** Target version for new databases. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_1;

/**
 * Advisory lock key for the migration chain. Arbitrary but stable 64-bit
 * value, derived from ASCII "STGMR1" — collisions with other advisory-lock
 * users of the same database are the only concern, and this application
 * takes no other advisory locks.
 */
export const MIGRATION_LOCK_KEY = 0x5354474d5231n;

/**
 * Applies all pending migrations in order, serialized across instances by
 * the advisory lock. Runs on a dedicated client (locks are session-scoped;
 * a pool query could release on a different session).
 */
export async function runMigrations(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const currentVersion = await getSchemaVersion(client);

    const chain: ReadonlyArray<
      readonly [number, (client: PoolClient) => Promise<void>]
    > = [[SCHEMA_VERSION_1, migrateToV1]];

    for (const [version, migrate] of chain) {
      if (currentVersion < version) {
        await applyInTransaction(client, version, migrate);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
}

/** Current schema version; 0 when none has been recorded yet. */
export async function getSchemaVersion(client: PoolClient): Promise<number> {
  const result = await client.query(
    `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
  );
  return Number(result.rows[0].version);
}

async function applyInTransaction(
  client: PoolClient,
  version: number,
  migrate: (client: PoolClient) => Promise<void>,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await migrate(client);
    await client.query(`INSERT INTO schema_version (version) VALUES ($1)`, [
      version,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`migrate to v${version}: ${String(error)}`, {
      cause: error,
    });
  }
}

/** v1: the complete schema — all nine tables the Store contract needs. */
async function migrateToV1(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE resources (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      data BYTEA NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, id)
    );

    CREATE TABLE resource_audit (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      data BYTEA NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now(),
      version_hash TEXT,
      tag TEXT
    );

    CREATE INDEX idx_audit_resource ON resource_audit (kind, resource_id);
    CREATE INDEX idx_audit_hash ON resource_audit (kind, resource_id, version_hash);
    CREATE INDEX idx_audit_tag ON resource_audit (kind, resource_id, tag, archived_at DESC);

    CREATE TABLE search_index (
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      -- Monotonic per-write sequence: the deterministic within-driver
      -- tie-break DD-009 requires (list mode orders by created_at, which
      -- is whole seconds — same-second writes need a stable second key).
      seq BIGINT GENERATED ALWAYS AS IDENTITY,
      -- The searchable document. to_tsvector with an explicit config is
      -- immutable, so it can be STORED; weights per tsquery.ts (name=A
      -- highest, per the interface's cross-driver requirement).
      search tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(tags, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
      ) STORED,
      PRIMARY KEY (kind, resource_id)
    );

    CREATE INDEX idx_search_index_tsv ON search_index USING GIN (search);
    CREATE INDEX idx_search_index_list ON search_index (created_at DESC, seq DESC);

    CREATE TABLE bootstrap_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE workflow_execution_events (
      execution_id TEXT NOT NULL,
      sequence_number BIGINT NOT NULL,
      event_type TEXT NOT NULL,
      task_name TEXT NOT NULL DEFAULT '',
      data BYTEA NOT NULL,
      -- ISO-8601 UTC with milliseconds — the exact shape sqlite's
      -- strftime('%Y-%m-%dT%H:%M:%fZ') produces; the record contract
      -- carries this as a string.
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      PRIMARY KEY (execution_id, sequence_number)
    );

    CREATE INDEX idx_wfee_execution_type ON workflow_execution_events (execution_id, event_type);
    CREATE INDEX idx_wfee_execution_task ON workflow_execution_events (execution_id, task_name);

    CREATE TABLE schedule_runs (
      schedule_id TEXT NOT NULL,
      org TEXT NOT NULL DEFAULT '',
      nominal_fire_time TEXT NOT NULL,
      origin TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      execution_id TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (schedule_id, nominal_fire_time, origin)
    );

    CREATE INDEX idx_schedule_runs_recency ON schedule_runs (schedule_id, recorded_at DESC);
    CREATE INDEX idx_schedule_runs_prune ON schedule_runs (recorded_at);

    CREATE TABLE signal_dedupe (
      id TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CLAIMED',
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX idx_signal_dedupe_org ON signal_dedupe (org);
    CREATE INDEX idx_signal_dedupe_expires ON signal_dedupe (expires_at);

    CREATE TABLE oauth_grant (
      identity_account_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      access_token_expires_at BIGINT NOT NULL DEFAULT 0,
      client_id TEXT NOT NULL DEFAULT '',
      auth_method TEXT NOT NULL DEFAULT '',
      token_endpoint TEXT NOT NULL DEFAULT '',
      access_token_env_var TEXT NOT NULL DEFAULT '',
      refresh_token_env_var TEXT NOT NULL DEFAULT '',
      environment_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (identity_account_id, resource_id, org_id)
    );

    CREATE TABLE pending_oauth_state (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      token_endpoint TEXT NOT NULL DEFAULT '',
      mcp_server_id TEXT NOT NULL,
      identity_account_id TEXT NOT NULL,
      target_env_var TEXT NOT NULL DEFAULT '',
      auth_method TEXT NOT NULL DEFAULT '',
      token_auth_method TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE INDEX idx_pending_oauth_state_created ON pending_oauth_state (created_at);
  `);
}
