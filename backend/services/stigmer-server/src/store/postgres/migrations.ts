/**
 * Versioned schema migrations for the Postgres driver — an INDEPENDENT
 * chain starting at its own v1. It deliberately does NOT
 * mirror sqlite's chain: that chain's value is Go-DDL fidelity for adopted
 * laptop databases, a concern Postgres cannot have (no Postgres database
 * predates this driver). Same runner discipline as sqlite/migrations.ts —
 * deliberate, versioned, each step in its own transaction, `schema_version`
 * = MAX(version).
 * A schema newer than this server supports is refused before migrations:
 * an older release must not serve a database it does not understand.
 *
 * Physical-layout choices and their rationale:
 *
 * - Resource/audit/event payloads are BYTEA holding the marshaled proto
 *   bytes — NEVER JSONB. Audit hashes are content-addressed over these
 *   exact bytes and proto→JSON→proto round-trips drop unknown fields, so a
 *   JSON-shaped source of truth would corrupt the audit hash chain.
 * - Ledger time columns that cross the Store interface (recorded_at,
 *   completed_at, expires_at, …) are TEXT holding the exact strings the
 *   contracts carry: markLatestScheduleFireTerminal picks "newest" by
 *   lexicographic RFC-3339 comparison, and timestamptz would silently
 *   reformat values. Driver-internal bookkeeping columns (updated_at,
 *   archived_at ordering) use native types freely.
 * - Real indexes from day one — every named query method has a supporting
 *   index (every query pattern has an index; the sqlite driver
 *   deliberately deferred physical indexing, this driver does not).
 * - search_index is an ordinary table with a STORED generated tsvector
 *   (engine syntax and ranking live inside the driver). Weight
 *   classes: name=A, tags=B, description=C — see tsquery.ts for why the
 *   sqlite bm25 vector cannot map one-to-one.
 *
 * The whole chain runs under pg_advisory_lock: unlike sqlite's single-file
 * lock, nothing else stops two server instances booting against one
 * database from racing the chain (compose scale-out, a second `docker
 * run`). The lock is session-scoped and released in a finally.
 *
 * Proven by __tests__/migrations.postgres.test.ts (fresh replay, idempotent reopen,
 * version tracking) against a real Postgres.
 */
import type { PoolClient } from "pg";

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
  SESSION_VALUES_KIND,
  SESSION_VALUES_PAGE_SIZE,
  migrateSessionValuesRow,
  unreadableSessionValuesError,
} from "../session-values-retired.js";
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
  RUN_KIND_TABLES,
  RUN_RENAME_PAGE_SIZE,
  RUN_RENAME_POLICY_KIND,
  RUN_RENAME_V18,
  RUN_RENAME_V21,
  rekeyedRunPolicy,
  renamedRunRow,
  unreadableRunRenameRowError,
} from "../run-rename.js";
import type { RekeyedPolicy, RunRename } from "../run-rename.js";
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
import {
  IDENTITY_ACCOUNT_KIND,
  repairedAccountSlugRow,
} from "../account-slugs-repaired.js";
import {
  ENVIRONMENT_RETIRED_PAGE_SIZE,
  ENVIRONMENT_RETIRED_POLICY_KIND,
  RETIRED_ENVIRONMENT_KIND,
  RETIRED_ENVIRONMENT_TABLES,
  policyNamesRetiredEnvironment,
  unreadableRetiredEnvironmentRowError,
} from "../environment-retired.js";
import { RETIRED_EXECUTION_CONTEXT_KIND } from "../execution-context-retired.js";

export const SCHEMA_VERSION_1 = 1;
export const SCHEMA_VERSION_2 = 2;
export const SCHEMA_VERSION_3 = 3;
/** v4: the rows of the removed Project kind deleted. */
export const SCHEMA_VERSION_4 = 4;
/** v5: every row holding the retired public visibility level moved to org. */
export const SCHEMA_VERSION_5 = 5;
/** v6: the list index's columns, key table and indexes (DDL only). */
export const SCHEMA_VERSION_6 = 6;
/** v7: the organization-slug ledger, filled with every slug taken before it. */
export const SCHEMA_VERSION_7 = 7;
/** v8: the resource-name table replaces the organization-slug ledger. */
export const SCHEMA_VERSION_8 = 8;
/** v9: sessions name their agent directly; the agent instance rows removed. */
export const SCHEMA_VERSION_9 = 9;
/** v10: every turn's settings move out of the retired execution_config. */
export const SCHEMA_VERSION_10 = 10;
/** v11: the organization deletion table (DDL only). */
export const SCHEMA_VERSION_11 = 11;
/** v12: the workflow instance rows removed. */
export const SCHEMA_VERSION_12 = 12;
/** v13: agent executions are runs. */
export const SCHEMA_VERSION_13 = 13;
/** v14: the workflow, workflow run and artifact rows removed, with the tables only workflows wrote. */
export const SCHEMA_VERSION_14 = 14;
/** v15: every identity account's slug and name held to their rules. */
export const SCHEMA_VERSION_15 = 15;
/** v16: the agent run is a run. */
export const SCHEMA_VERSION_16 = 16;
/** v17: the environment rows removed, with the sign-in grant table; a pending sign-in names its vault. */
export const SCHEMA_VERSION_17 = 17;
/** v18: a conversation's retired own secrets and connections dropped from every session row. */
export const SCHEMA_VERSION_18 = 18;
/** v19: a sign-in starts from an address: its pending state reshaped, registered clients kept, Connect links. */
export const SCHEMA_VERSION_19 = 19;

/** v20: the execution context rows removed; a tool connect in flight is a connect attempt row. */
export const SCHEMA_VERSION_20 = 20;

/** Target version for new databases. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_20;

/**
 * Advisory lock key for the migration chain. Arbitrary but stable 64-bit
 * value, derived from ASCII "STGMR1" — collisions with other advisory-lock
 * users of the same database are the only concern, and this application
 * takes no other advisory locks.
 */
export const MIGRATION_LOCK_KEY = 0x5354474d5231n;

/**
 * Applies every pending migration up to `targetVersion` in order — all of
 * them unless a test builds the database a given step starts from —
 * serialized across instances by the advisory lock. Runs on a dedicated
 * client (locks are session-scoped; a pool query could release on a
 * different session).
 */
export async function runMigrations(
  client: PoolClient,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const currentVersion = await getSchemaVersion(client);
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION}). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
      );
    }

    const chain: ReadonlyArray<
      readonly [number, (client: PoolClient) => Promise<void>]
    > = [
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
      [SCHEMA_VERSION_20, migrateToV20],
    ];

    for (const [version, migrate] of chain) {
      if (currentVersion < version && version <= targetVersion) {
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
      -- tie-break the search contract requires (list mode orders by
      -- created_at, which is whole seconds — same-second writes need a
      -- stable second key).
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

/**
 * v2: the retention sweep's scan on workflow_execution_events.
 *
 * The cloud composition's retention sweep (a port of the Java
 * platform.retention engine) deletes events older than the policy window
 * with `created_at < cutoff` range scans; without this index every hourly
 * pass would seq-scan the largest table in the schema. The Java edition
 * built the identical index for the identical reason (V7's
 * idx_wfee_occurred_at — "The retention sweep's scan"), and schedule_runs
 * shipped v1 with idx_schedule_runs_prune under the same doctrine: a table
 * whose rows expire carries the index its reaper needs (every query
 * pattern has an index — the pattern's owner being a cloud extension does
 * not exempt it). The OSS server itself runs no sweep;
 * the index is inert weight locally and load-bearing for the composition.
 */
async function migrateToV2(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE INDEX idx_wfee_created_at ON workflow_execution_events (created_at);
  `);
}

/**
 * v3: the by-resource grant sweep's index.
 *
 * OAuthGrantStore.deleteByResourceId (the cloud channel teardown's arm)
 * deletes every oauth_grant row for a resource regardless of granting
 * identity; the primary key leads with identity_account_id, so the sweep
 * would otherwise seq-scan a table that holds every accumulated grant.
 * The Java edition carries the identical index
 * (idx_oauth_grant_resource) for the identical delete cascade — the same
 * v2 doctrine: a query pattern owned by a cloud extension does not exempt
 * the index.
 */
async function migrateToV3(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE INDEX idx_oauth_grant_resource ON oauth_grant (resource_id, org_id);
  `);
}

/**
 * v4: the Project kind (kind 60, id prefix "prj") was removed from the
 * contract, so a database seeded by an earlier release may hold rows no
 * code can read, list or delete any more. The chain's first data
 * migration, and the same shape as the sqlite driver's v9: rows deleted,
 * not archived (the audit table is the version history of kinds the
 * server serves), keyed on the enum NAME the kind column holds
 * (proto-fields.ts apiResourceKindName), the search index left to boot's
 * RebuildIndex. Member rows the Project once listed are ordinary
 * resources of their own kinds and stay.
 */
async function migrateToV4(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM resources WHERE kind = 'project'`);
  await client.query(`DELETE FROM resource_audit WHERE kind = 'project'`);
}

/**
 * v5: the public visibility level is retired, so every row that still
 * holds it is moved to org visibility — the same step as the sqlite
 * driver's v10 (public-visibility-retired.ts says why a migration, why the
 * kind table is frozen there, and why an undecodable row fails the step).
 * The rows are read FOR UPDATE inside applyInTransaction's transaction,
 * under the chain's advisory lock, so a second instance booting against
 * the same database waits rather than moving a row twice; `updated_at` is
 * bumped the way saveResource bumps it; rows that hold any other level are
 * left byte-for-byte as they are. On the hosted edition every such row was
 * moved through the API before this release deployed, so this step finds
 * none and records its version.
 */
async function migrateToV5(client: PoolClient): Promise<void> {
  for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
    const result = await client.query<{ id: string; data: Buffer }>(
      `SELECT id, data FROM resources WHERE kind = $1 FOR UPDATE`,
      [entry.kind],
    );
    for (const row of result.rows) {
      let moved: Uint8Array | undefined;
      try {
        moved = movePublicRowToOrg(entry, new Uint8Array(row.data));
      } catch (error) {
        throw new Error(
          `${entry.kind} '${row.id}' cannot be moved off the retired public level: ${String(error)}`,
          { cause: error },
        );
      }
      if (moved !== undefined) {
        await client.query(
          `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
          [Buffer.from(moved), entry.kind, row.id],
        );
      }
    }
  }
}

/**
 * v6: the list index (../list-index.ts) — schema only. Every existing row
 * arrives with its stamp NULL, which makes it unproven, so the store's
 * reconciliation at open derives its facts with the code that runs and
 * reads stay exact until it has; a migration that decoded rows here would
 * freeze today's declarations into the chain (the v5 step freezes its
 * kind table for the same reason, public-visibility-retired.ts).
 *
 * - `list_org` and `list_created_at` are the order's inputs, byte-collated
 *   (`COLLATE "C"`) so the database sorts them the way list-index.ts
 *   compares them when it merges unproven rows in; `id` is compared under
 *   the same collation in the index expressions and the queries.
 * - `list_index_revision` is the declaration revision the facts were
 *   derived under; `list_indexed_at` is the `updated_at` they were derived
 *   from. A writer that does not know these columns leaves them behind as
 *   it bumps `updated_at`, which is exactly what marks its row unproven.
 * - `resource_list_keys` holds one row per (resource, key) with the
 *   creation instant copied in, so a parent's rows are one range of one
 *   index. It carries no foreign key: every indexed read joins
 *   `resources`, so a key row whose resource is gone matches nothing.
 * - The partial index holds only unproven rows (none in steady state), so
 *   finding them is never a scan of the kind.
 */
async function migrateToV6(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE resources
      ADD COLUMN list_org TEXT COLLATE "C",
      ADD COLUMN list_created_at TEXT COLLATE "C",
      ADD COLUMN list_index_revision INTEGER,
      ADD COLUMN list_indexed_at timestamptz;

    CREATE INDEX idx_resources_list_org
      ON resources (kind, list_org, list_created_at, (id COLLATE "C"));
    CREATE INDEX idx_resources_list_created
      ON resources (kind, list_created_at, (id COLLATE "C"));
    CREATE INDEX idx_resources_list_revision
      ON resources (kind, list_index_revision);
    CREATE INDEX idx_resources_list_unproven
      ON resources (kind, id) WHERE list_indexed_at IS DISTINCT FROM updated_at;

    CREATE TABLE resource_list_keys (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT COLLATE "C" NOT NULL,
      PRIMARY KEY (kind, id, key)
    );

    CREATE INDEX idx_resource_list_keys_lookup
      ON resource_list_keys (kind, key, value, created_at, (id COLLATE "C"));
  `);
}

/**
 * v7: the organization-slug ledger (replaced by v8's resource-name table),
 * created and filled in one step so
 * it is complete before the first request. organization-slug-history.ts
 * says what the fill records, why it is a migration, why its kind table is
 * frozen, and why an undecodable row fails the step; this step owns the SQL.
 *
 * - `claimed_at` and `retired_at` are ledger time crossing the Store
 *   interface, so TEXT holding the exact RFC-3339 strings (the header's
 *   convention); `retired_at` is NULL while the slug is held.
 * - Every query is by the primary key, so the table needs no other index.
 * - Live organizations are copied by id (an organization's id is its slug)
 *   with no decode. Each organization-scoped kind is then read in keyset
 *   pages on `(kind, id)`, the primary key's order, so no kind is ever held
 *   in memory whole; the organizations its rows name with no live
 *   organization are recorded retired. ON CONFLICT DO NOTHING keeps a live
 *   organization's entry unretired whatever its rows say.
 * - The rows are only read, so nothing takes a row lock; the chain's
 *   advisory lock already keeps a second instance's boot out of the step.
 */
async function migrateToV7(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE organization_slugs (
      slug TEXT PRIMARY KEY,
      claimed_at TEXT NOT NULL,
      retired_at TEXT
    )
  `);
  const recordedAt = new Date().toISOString();
  await client.query(
    `INSERT INTO organization_slugs (slug, claimed_at)
     SELECT id, $1 FROM resources WHERE kind = 'organization'
     ON CONFLICT (slug) DO NOTHING`,
    [recordedAt],
  );

  const named = new Set<string>();
  for (const entry of ORGANIZATION_SCOPED_KINDS_AT_LEDGER) {
    let after = "";
    for (;;) {
      const page = await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [entry.kind, after, HISTORY_PAGE_SIZE],
      );
      for (const row of page.rows) {
        let org: string;
        try {
          org = organizationNamedBy(entry, new Uint8Array(row.data));
        } catch (error) {
          throw undecodableRowError(entry, row.id, error);
        }
        if (org !== "") {
          named.add(org);
        }
      }
      if (page.rows.length < HISTORY_PAGE_SIZE) {
        break;
      }
      after = page.rows[page.rows.length - 1]!.id;
    }
  }
  for (const slug of named) {
    await client.query(
      `INSERT INTO organization_slugs (slug, claimed_at, retired_at)
       VALUES ($1, $2, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, recordedAt],
    );
  }
}

/**
 * v8: the resource-name table (the Store's `resourceNames`, interface.ts
 * says what it guarantees) replaces the organization-slug ledger.
 *
 * - An organization is filed under a minted id from this version on, and
 *   its slug is a name it answers to, so the table maps a name to an id
 *   and lets a name go. The ledger only knew which slugs were ever taken.
 * - Every live organization's slug is recorded as its current name. Before
 *   this version an organization's id was its slug, so the fill copies the
 *   id into both columns with no decode, the way v7 did. Such a name equals
 *   its id, which is what keeps it held for good (interface.ts).
 * - Every other slug the ledger held (a deleted organization's, retired
 *   for good) is carried as a reserved name: a previous name equal to its
 *   id that never expires. That organization was filed under the slug, and
 *   whatever it left behind still carries it, so it is never taken again.
 * - `claimed_at` and `expires_at` are ledger time crossing the Store
 *   interface, TEXT holding exact RFC-3339 strings, byte-collated so the
 *   expiry comparison is the strings' order whatever the database locale.
 * - The by-id index serves the release of every name one resource holds.
 */
async function migrateToV8(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE resource_names (
      kind TEXT NOT NULL,
      org TEXT NOT NULL,
      name TEXT NOT NULL,
      id TEXT NOT NULL,
      state TEXT NOT NULL,
      claimed_at TEXT COLLATE "C" NOT NULL,
      expires_at TEXT COLLATE "C" NOT NULL DEFAULT '',
      PRIMARY KEY (kind, org, name)
    );

    CREATE INDEX idx_resource_names_id ON resource_names (kind, org, id);
  `);
  await client.query(
    `INSERT INTO resource_names (kind, org, name, id, state, claimed_at)
     SELECT 'organization', '', id, id, 'current', $1
     FROM resources WHERE kind = 'organization'`,
    [new Date().toISOString()],
  );
  await client.query(
    `INSERT INTO resource_names (kind, org, name, id, state, claimed_at)
     SELECT 'organization', '', slug, slug, 'previous', claimed_at
     FROM organization_slugs
     ON CONFLICT (kind, org, name) DO NOTHING`,
  );
  await client.query(`DROP TABLE organization_slugs`);
}

/**
 * v9: the agent instance kind is removed (agent-instance-retired.ts says
 * what each session becomes and why an unreadable row fails the step).
 *
 * - Every instance row is read in keyset pages on `(kind, id)` for the
 *   agent it names, and each named agent once by primary key; the map of
 *   instance to agent is ids only, so it stays small beside the rows.
 * - Every session is read in keyset pages and rewritten when it names an
 *   instance, with `updated_at` bumped the way the store's writes bump it,
 *   so the list index re-derives the row (its key changed with the
 *   session's revision) the way it re-derives any unproven row.
 * - Every IamPolicy row is read in keyset pages, and the ones naming an
 *   instance as resource or principal are deleted with their list keys,
 *   their history kept, as the store deletes a policy.
 * - The instance rows, their history and their list keys are then
 *   deleted; the search index is left to boot's RebuildIndex, which
 *   re-indexes only the registered kinds (the v4 precedent). The chain's advisory lock keeps a second
 *   instance's boot out of the step, and the transaction makes it whole or
 *   nothing.
 */
async function migrateToV9(client: PoolClient): Promise<void> {
  const pageOf = async (
    kind: string,
    after: string,
  ): Promise<Array<{ id: string; data: Buffer }>> =>
    (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [kind, after, RETIREMENT_PAGE_SIZE],
      )
    ).rows;
  /** Every row of a kind, in keyset pages, in id order. */
  const forEachRow = async (
    kind: string,
    visit: (row: { id: string; data: Buffer }) => Promise<void> | void,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = await pageOf(kind, after);
      for (const row of rows) {
        await visit(row);
      }
      if (rows.length < RETIREMENT_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const instanceAgents = new Map<string, string>();
  await forEachRow(RETIRED_INSTANCE_KIND, (row) => {
    try {
      instanceAgents.set(row.id, instanceAgentIdOf(new Uint8Array(row.data)));
    } catch (error) {
      throw unreadableRowError(RETIRED_INSTANCE_KIND, row.id, error);
    }
  });

  const agents = new Map<string, InstanceAgent>();
  for (const agentId of new Set(instanceAgents.values())) {
    if (agentId === "") {
      continue;
    }
    const found = await client.query<{ data: Buffer }>(
      `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
      [AGENT_KIND, agentId],
    );
    const row = found.rows[0];
    try {
      agents.set(
        agentId,
        row === undefined
          ? { kind: "agent-gone", agentId }
          : agentFactsOf(new Uint8Array(row.data)),
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

  await forEachRow(SESSION_KIND, async (row) => {
    let migrated: Uint8Array | undefined;
    try {
      migrated = migrateSessionRow(new Uint8Array(row.data), agentOf);
    } catch (error) {
      throw unreadableRowError(SESSION_KIND, row.id, error);
    }
    if (migrated !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
        [Buffer.from(migrated), SESSION_KIND, row.id],
      );
    }
  });

  const retiredPolicies: string[] = [];
  await forEachRow(POLICY_KIND, (row) => {
    try {
      if (policyNamesRetiredInstance(new Uint8Array(row.data))) {
        retiredPolicies.push(row.id);
      }
    } catch (error) {
      throw unreadableRowError(POLICY_KIND, row.id, error);
    }
  });
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [POLICY_KIND, retiredPolicies],
    );
  }

  await client.query(`DELETE FROM resource_audit WHERE kind = $1`, [
    RETIRED_INSTANCE_KIND,
  ]);
  await client.query(`DELETE FROM resource_list_keys WHERE kind = $1`, [
    RETIRED_INSTANCE_KIND,
  ]);
  await client.query(`DELETE FROM resources WHERE kind = $1`, [
    RETIRED_INSTANCE_KIND,
  ]);
}

/**
 * v10: a turn's settings leave the retired execution_config
 * (execution-config-retired.ts says what each row becomes and why an
 * unreadable row fails the step). Every execution row is read in keyset
 * pages on `(kind, id)` and rewritten unless it is already in the current
 * shape, its `updated_at` left alone (the list keys it feeds are
 * unchanged). The chain's advisory lock keeps a second instance's boot out
 * of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV10(client: PoolClient): Promise<void> {
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [EXECUTION_KIND, after, EXECUTION_CONFIG_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let migrated: Uint8Array | undefined;
      try {
        migrated = migrateExecutionRow(new Uint8Array(row.data));
      } catch (error) {
        throw unreadableExecutionError(row.id, error);
      }
      if (migrated !== undefined) {
        await client.query(
          `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
          [Buffer.from(migrated), EXECUTION_KIND, row.id],
        );
      }
    }
    if (rows.length < EXECUTION_CONFIG_PAGE_SIZE) {
      return;
    }
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * v11: the organizations being deleted, one row each (interface.ts,
 * OrganizationDeletionStore, says why the state is not on the
 * organization's row). DDL only: no database before this version holds an
 * organization being deleted. The times are RFC-3339 TEXT, byte-collated so
 * the purge's age comparisons are the strings' order whatever the locale
 * (the v8 precedent).
 */
async function migrateToV11(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE organization_deletions (
      org TEXT NOT NULL PRIMARY KEY,
      phase TEXT NOT NULL,
      marked_at TEXT COLLATE "C" NOT NULL,
      accepted_at TEXT COLLATE "C" NOT NULL DEFAULT '',
      heartbeat_at TEXT COLLATE "C" NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT ''
    );
  `);
}

/**
 * v12: the workflow instance kind is removed (workflow-instance-retired.ts
 * says what leaves and why an unreadable row fails the step).
 *
 * - Every IamPolicy row is read in keyset pages, and the ones naming an
 *   instance as resource or principal are deleted with their list keys,
 *   their history kept, as the store deletes a policy.
 * - The instance rows, their history and their list keys are then
 *   deleted; the search index is left to boot's RebuildIndex, which
 *   re-indexes only the registered kinds (the v9 precedent).
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale and the primary
 * key serves it. The chain's advisory lock keeps a second instance's boot
 * out of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV12(client: PoolClient): Promise<void> {
  const retiredPolicies: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [WORKFLOW_RETIREMENT_POLICY_KIND, after, WORKFLOW_RETIREMENT_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (policyNamesRetiredWorkflowInstance(new Uint8Array(row.data))) {
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
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [WORKFLOW_RETIREMENT_POLICY_KIND, retiredPolicies],
    );
  }

  for (const table of ["resource_audit", "resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [
      RETIRED_WORKFLOW_INSTANCE_KIND,
    ]);
  }
}

/**
 * v13: agent executions are runs. run-rename.ts says what each row becomes
 * and why an unreadable row fails the step; `renameRunKind` applies it.
 */
async function migrateToV13(client: PoolClient): Promise<void> {
  await renameRunKind(client, RUN_RENAME_V18);
}

/**
 * One rename of the run kind (run-rename.ts), shared by v13 and v16.
 *
 * - Every run row is read in keyset pages under its old kind and rewritten
 *   when its bytes spell the kind the old way; then every table keyed by
 *   kind renames the run kind.
 * - Every IamPolicy row is read in keyset pages, and the ones naming the
 *   old kind are re-keyed: the old row leaves with its list keys, its
 *   history kept, and the new row is written unproven with `updated_at`
 *   stamped, so the list index derives its keys the way it derives any
 *   unproven row.
 * - The search index is left to boot's RebuildIndex (the v9 precedent).
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale and the primary
 * key serves it. The chain's advisory lock keeps a second instance's boot
 * out of the step, and the transaction makes it whole or nothing.
 */
async function renameRunKind(client: PoolClient, rename: RunRename): Promise<void> {
  const [fromKind, toKind] = rename.kind;
  const forEachRow = async (
    kind: string,
    visit: (row: { id: string; data: Buffer }) => Promise<void> | void,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, RUN_RENAME_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        await visit(row);
      }
      if (rows.length < RUN_RENAME_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  await forEachRow(fromKind, async (row) => {
    let data: Uint8Array | undefined;
    try {
      data = renamedRunRow(rename, new Uint8Array(row.data));
    } catch (error) {
      throw unreadableRunRenameRowError(rename, fromKind, row.id, error);
    }
    if (data !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
        [Buffer.from(data), fromKind, row.id],
      );
    }
  });
  for (const table of RUN_KIND_TABLES) {
    await client.query(`UPDATE ${table} SET kind = $1 WHERE kind = $2`, [
      toKind,
      fromKind,
    ]);
  }

  const rekeyed: Array<{ from: string; policy: RekeyedPolicy }> = [];
  await forEachRow(RUN_RENAME_POLICY_KIND, (row) => {
    try {
      const policy = rekeyedRunPolicy(rename, new Uint8Array(row.data));
      if (policy !== undefined) {
        rekeyed.push({ from: row.id, policy });
      }
    } catch (error) {
      throw unreadableRunRenameRowError(rename, RUN_RENAME_POLICY_KIND, row.id, error);
    }
  });
  for (const { from, policy } of rekeyed) {
    for (const table of ["resource_list_keys", "resources"]) {
      await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = $2`, [
        RUN_RENAME_POLICY_KIND,
        from,
      ]);
    }
    await client.query(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`,
      [RUN_RENAME_POLICY_KIND, policy.id, Buffer.from(policy.data)],
    );
  }
}

/**
 * v14: workflows, workflow runs and the artifact kind are removed
 * (workflow-retired.ts says what leaves, what each agent run becomes and
 * why an unreadable row fails the step).
 *
 * - Every IamPolicy row is read in keyset pages, and the ones naming a
 *   retired kind as resource or principal are deleted with their list
 *   keys, their history kept, as the store deletes a policy.
 * - Every agent run is read in keyset pages and rewritten when it carries
 *   a workflow parent, a workflow step's task token or a workflow lineage
 *   label, its `updated_at` left alone (no list key of a run reads them).
 * - Every row of a retired kind is then deleted from every table keyed by
 *   kind, and the two tables only workflows wrote are dropped; the search
 *   index is left to boot's RebuildIndex, which re-indexes only the
 *   registered kinds (the v9 precedent).
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale and the primary
 * key serves it. The chain's advisory lock keeps a second instance's boot
 * out of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV14(client: PoolClient): Promise<void> {
  // The time an unfinished run a workflow step started ends at.
  const endedAt = new Date().toISOString();
  const forEachRow = async (
    kind: string,
    size: number,
    visit: (row: { id: string; data: Buffer }) => Promise<void> | void,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, size],
        )
      ).rows;
      for (const row of rows) {
        await visit(row);
      }
      if (rows.length < size) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const retiredPolicies: string[] = [];
  await forEachRow(
    WORKFLOW_RETIRED_POLICY_KIND,
    WORKFLOW_RETIRED_PAGE_SIZE,
    (row) => {
      try {
        if (policyNamesRetiredWorkflowKind(new Uint8Array(row.data))) {
          retiredPolicies.push(row.id);
        }
      } catch (error) {
        throw unreadableRetiredWorkflowRowError(
          WORKFLOW_RETIRED_POLICY_KIND,
          row.id,
          error,
        );
      }
    },
  );
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [WORKFLOW_RETIRED_POLICY_KIND, retiredPolicies],
    );
  }

  await forEachRow(AGENT_RUN_KIND, AGENT_RUN_RETIRED_PAGE_SIZE, async (row) => {
    let migrated: Uint8Array | undefined;
    try {
      migrated = migrateAgentRunRow(new Uint8Array(row.data), endedAt);
    } catch (error) {
      throw unreadableRetiredWorkflowRowError(AGENT_RUN_KIND, row.id, error);
    }
    if (migrated !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
        [Buffer.from(migrated), AGENT_RUN_KIND, row.id],
      );
    }
  });

  for (const table of RUN_KIND_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE kind = ANY($1::text[])`, [
      RETIRED_WORKFLOW_KINDS,
    ]);
  }
  for (const table of RETIRED_WORKFLOW_TABLES) {
    await client.query(`DROP TABLE ${table}`);
  }
}

/**
 * v15: identity-account slugs repaired (../account-slugs-repaired.ts says
 * what changes, why the rule is frozen there, and why an undecodable row
 * fails the step). This step owns the SQL: the kind's rows read under
 * FOR UPDATE, one UPDATE per repaired row with `updated_at` bumped, every
 * other row left byte for byte. Runs inside the chain's transaction, so a
 * throw rolls the step back and the boot stops on the row it names.
 */
async function migrateToV15(client: PoolClient): Promise<void> {
  const result = await client.query<{ id: string; data: Buffer }>(
    `SELECT id, data FROM resources WHERE kind = $1 FOR UPDATE`,
    [IDENTITY_ACCOUNT_KIND],
  );
  for (const row of result.rows) {
    let repaired: Uint8Array | undefined;
    try {
      repaired = repairedAccountSlugRow(new Uint8Array(row.data));
    } catch (error) {
      throw new Error(
        `${IDENTITY_ACCOUNT_KIND} '${row.id}' cannot have its slug repaired: ${String(error)}`,
        { cause: error },
      );
    }
    if (repaired !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
        [Buffer.from(repaired), IDENTITY_ACCOUNT_KIND, row.id],
      );
    }
  }
}

/**
 * v16: the agent run is a run. The kind `agent_run` and its kind string
 * `AgentRun` become `run` and `Run` by the same transformation as v13
 * (`renameRunKind`), with this step's frozen names (run-rename.ts
 * `RUN_RENAME_V21`, the SQLite step's number). Runs keep their ids, the
 * `aex_` ones included.
 */
async function migrateToV16(client: PoolClient): Promise<void> {
  await renameRunKind(client, RUN_RENAME_V21);
}

/**
 * v17: vaults replace the Environment kind (../environment-retired.ts says
 * what leaves and why nothing is carried). Every IamPolicy row is read in
 * keyset pages, and the ones naming an environment as resource or principal
 * are deleted with their list keys, their history kept, as the store
 * deletes a policy. Every environment row is then deleted from every table
 * keyed by kind, and the sign-in grant table is dropped; the search index
 * is left to boot's RebuildIndex (the v14 precedent). The pending sign-in
 * table gains `vault_id`, the vault a sign-in saves into, and
 * `tool_address`, the address it saves at, recorded when it starts. Each
 * page compares and orders `id` under the column's own collation; the
 * chain's advisory lock and transaction make the step whole or nothing.
 */
async function migrateToV17(client: PoolClient): Promise<void> {
  const retiredPolicies: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [ENVIRONMENT_RETIRED_POLICY_KIND, after, ENVIRONMENT_RETIRED_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (policyNamesRetiredEnvironment(new Uint8Array(row.data))) {
          retiredPolicies.push(row.id);
        }
      } catch (error) {
        throw unreadableRetiredEnvironmentRowError(
          ENVIRONMENT_RETIRED_POLICY_KIND,
          row.id,
          error,
        );
      }
    }
    if (rows.length < ENVIRONMENT_RETIRED_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [ENVIRONMENT_RETIRED_POLICY_KIND, retiredPolicies],
    );
  }

  for (const table of RUN_KIND_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [
      RETIRED_ENVIRONMENT_KIND,
    ]);
  }
  for (const table of RETIRED_ENVIRONMENT_TABLES) {
    await client.query(`DROP TABLE ${table}`);
  }
  // A sign-in now names the vault it saves into; "" is the signer's My
  // vault, which every pending row from before this step meant.
  await client.query(
    `ALTER TABLE pending_oauth_state ADD COLUMN vault_id TEXT NOT NULL DEFAULT ''`,
  );
  // The address a sign-in saves at, recorded when it starts; "" on a
  // pending row from before this step matches no address, so completing
  // one asks the signer to start again.
  await client.query(
    `ALTER TABLE pending_oauth_state ADD COLUMN tool_address TEXT NOT NULL DEFAULT ''`,
  );
}

/**
 * v18: a conversation's own secrets and connections leave the contract
 * (../session-values-retired.ts says what each row becomes and why nothing
 * is carried). Every session row is read in keyset pages on `(kind, id)`
 * and rewritten only when it holds a retired field, its `updated_at` left
 * alone (the list keys it feeds are unchanged). The chain's advisory lock
 * keeps a second instance's boot out of the step, and the transaction
 * makes it whole or nothing.
 */
async function migrateToV18(client: PoolClient): Promise<void> {
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [SESSION_VALUES_KIND, after, SESSION_VALUES_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let migrated: Uint8Array | undefined;
      try {
        migrated = migrateSessionValuesRow(new Uint8Array(row.data));
      } catch (error) {
        throw unreadableSessionValuesError(row.id, error);
      }
      if (migrated !== undefined) {
        await client.query(
          `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
          [Buffer.from(migrated), SESSION_VALUES_KIND, row.id],
        );
      }
    }
    if (rows.length < SESSION_VALUES_PAGE_SIZE) {
      return;
    }
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * v19: a sign-in starts from an address and saves into a vault, so its
 * pending state no longer names an MCP server; Stigmer keeps the clients it
 * registered with a login server; and a Connect link is a row. The pending
 * table holds ten-minute rows only, so it is dropped and created in its new
 * shape rather than altered: a sign-in in flight across the upgrade is
 * started again. The chain's advisory lock keeps a second instance's boot
 * out of the step.
 */
async function migrateToV19(client: PoolClient): Promise<void> {
  await client.query(`
    DROP TABLE pending_oauth_state;

    CREATE TABLE pending_oauth_state (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      token_endpoint TEXT NOT NULL DEFAULT '',
      identity_account_id TEXT NOT NULL DEFAULT '',
      auth_method TEXT NOT NULL DEFAULT '',
      token_auth_method TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      vault_id TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      login_app TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT '',
      client_registration TEXT NOT NULL DEFAULT '',
      connect_link TEXT NOT NULL DEFAULT '',
      provider_name TEXT NOT NULL DEFAULT '',
      userinfo_url TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE INDEX idx_pending_oauth_state_created ON pending_oauth_state (created_at);

    CREATE TABLE oauth_client_registration (
      login_server TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (login_server, redirect_uri)
    );

    CREATE TABLE connect_link (
      token_hash TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      vault_id TEXT NOT NULL,
      address TEXT NOT NULL,
      return_url TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_class TEXT NOT NULL,
      created_by_bound_org TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      used_at BIGINT NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_oauth_client_registration_client ON oauth_client_registration (client_id);
    CREATE INDEX idx_connect_link_vault ON connect_link (vault_id);
    CREATE INDEX idx_connect_link_org ON connect_link (org);
    CREATE INDEX idx_connect_link_expires ON connect_link (expires_at);
  `);
}

/**
 * v20: a run's values are fetched from their vaults, never copied
 * (../execution-context-retired.ts says what leaves and why nothing is
 * carried). Every execution context row is deleted from every table keyed
 * by kind, and the connect attempt table is created. The SQLite driver's
 * v25 in this engine's terms. The chain's advisory lock keeps a second
 * instance's boot out of the step.
 */
async function migrateToV20(client: PoolClient): Promise<void> {
  for (const table of RUN_KIND_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [
      RETIRED_EXECUTION_CONTEXT_KIND,
    ]);
  }
  await client.query(`
    CREATE TABLE connect_attempt (
      id TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      created_by TEXT NOT NULL,
      person TEXT NOT NULL DEFAULT '',
      mcp_server_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX idx_connect_attempt_org ON connect_attempt (org);
    CREATE INDEX idx_connect_attempt_expires ON connect_attempt (expires_at);
  `);
}
