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
  KindNameBackfill,
  NAMED_KINDS_AT_BACKFILL,
  RESOURCE_NAMES_BACKFILL_PAGE_SIZE,
} from "../resource-names-backfill.js";
import {
  ARCHIVED_KIND_AT_REWRITE,
  NAMED_KINDS_AT_REWRITE,
  REFERENCES_BY_ID_PAGE_SIZE,
  REFERRING_KINDS_AT_REWRITE,
  ReferenceRewrite,
} from "../references-by-id.js";
import type { NameAtRewrite } from "../references-by-id.js";
import { NOOP_STORE_LOGGER } from "../logger.js";
import type { StoreLogger } from "../logger.js";
import {
  AGENT_KIND as RETIREMENT_AGENT_KIND,
  PLUGIN_KIND,
  GRANT_KIND_AT_STEP as RETIREMENT_GRANT_KIND,
  RETIRED_MCP_SERVER_KIND,
  RETIREMENT_PAGE_SIZE as SERVER_RETIREMENT_PAGE_SIZE,
  RetirementFacts,
  SESSION_KIND as RETIREMENT_SESSION_KIND,
  SKILL_KIND,
  memberSkillFactsOf,
  migrateAgentRow,
  migrateSessionRow as migrateSessionRowForPlugins,
  pluginFactsOf,
  grantNamesRetired,
  serverFactsOf,
  unreadableRowError as unreadableRetiredServerRowError,
} from "../mcp-server-retired.js";
import {
  SUB_AGENT_RETIREMENT_AGENT_KIND,
  SUB_AGENT_RETIREMENT_PAGE_SIZE,
  SUB_AGENT_RETIREMENT_SESSION_KIND,
  repinSessionRow,
  retireSubAgentsInAgentRow,
  unreadableSubAgentRowError,
} from "../sub-agents-retired.js";

import {
  AGENT_KIND,
  GRANT_KIND_AT_STEP,
  RETIRED_INSTANCE_KIND,
  RETIREMENT_PAGE_SIZE,
  SESSION_KIND,
  agentFactsOf,
  instanceAgentIdOf,
  migrateSessionRow,
  grantNamesRetiredInstance,
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
  WORKFLOW_RETIREMENT_GRANT_KIND,
  grantNamesRetiredWorkflowInstance,
  unreadableWorkflowRowError,
} from "../workflow-instance-retired.js";
import {
  PLATFORM_CLIENT_RETIRED_PAGE_SIZE,
  PLATFORM_CLIENT_RETIRED_GRANT_KIND,
  RETIRED_PLATFORM_CLIENT_KIND,
  grantNamesRetiredPlatformClient,
  unreadablePlatformClientRowError,
} from "../platform-client-retired.js";
import {
  EVAL_KINDS_RETIRED_PAGE_SIZE,
  EVAL_KINDS_RETIRED_GRANT_KIND,
  EVAL_TRY_KIND_NAMES,
  RETIRED_EVAL_KINDS,
  grantNamesRetiredEvalKind,
  relabelEvalTryRow,
  unreadableEvalKindRowError,
} from "../eval-kinds-retired.js";
import {
  KIND_TABLES,
  KIND_RENAME_PAGE_SIZE,
  KIND_RENAME_GRANT_KIND,
  FEDERATION_ISSUER_RENAME_V30,
  GRANT_RENAME_V34,
  SCORING_RULE_RENAME_V36,
  RUN_RENAME_V18,
  RUN_RENAME_V21,
  movedGrant,
  rekeyedGrant,
  renamedKindRow,
  unreadableKindRenameRowError,
} from "../kind-rename.js";
import type { KindRename, RekeyedGrant } from "../kind-rename.js";
import {
  CHANNEL_KIND_AT_MERGE,
  CHANNEL_MERGE_GRANT_KIND,
  CHANNEL_MERGE_PAGE_SIZE,
  CHANNEL_MERGE_SESSION_KINDS,
  MERGED_CHANNEL_KINDS,
  assignChannelSlugs,
  channelMergeAuditRowError,
  channelMergePreviousNameError,
  convertToChannel,
  encodeChannel,
  logChannelMerge,
  rekeyedChannelGrant,
  relabelChannelSessionRow,
  unreadableChannelMergeRowError,
} from "../channel-kinds-merged.js";
import type { ConvertedChannel } from "../channel-kinds-merged.js";
import { rfc3339Seconds } from "../rfc3339.js";
import {
  AGENT_RUN_KIND,
  AGENT_RUN_RETIRED_PAGE_SIZE,
  RETIRED_WORKFLOW_KINDS,
  RETIRED_WORKFLOW_TABLES,
  WORKFLOW_RETIRED_PAGE_SIZE,
  WORKFLOW_RETIRED_GRANT_KIND,
  migrateAgentRunRow,
  grantNamesRetiredWorkflowKind,
  unreadableRetiredWorkflowRowError,
} from "../workflow-retired.js";
import {
  IDENTITY_ACCOUNT_KIND,
  repairedAccountSlugRow,
} from "../account-slugs-repaired.js";
import {
  ENVIRONMENT_RETIRED_PAGE_SIZE,
  ENVIRONMENT_RETIRED_GRANT_KIND,
  RETIRED_ENVIRONMENT_KIND,
  RETIRED_ENVIRONMENT_TABLES,
  grantNamesRetiredEnvironment,
  unreadableRetiredEnvironmentRowError,
} from "../environment-retired.js";
import { RETIRED_EXECUTION_CONTEXT_KIND } from "../execution-context-retired.js";
import {
  SESSION_HARNESS_KIND,
  SESSION_HARNESS_PAGE_SIZE,
  migrateSessionHarnessRow,
  unreadableSessionHarnessError,
} from "../session-harness-state-moved.js";
import {
  ETAG_STAMPED_KIND_NAMES,
  ETAG_STAMP_PAGE_SIZE,
  logUnreadableEtagRows,
  stampEtagRow,
} from "../resource-etags-stamped.js";
import {
  LABEL_TAG_REPORT_KIND_NAMES,
  LABEL_TAG_REPORT_PAGE_SIZE,
  LabelTagTally,
} from "../label-tag-report.js";

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

/** v21: the MCP server rows removed; a plugin's parts became its plugins; a connect attempt names a plugin's server. */
export const SCHEMA_VERSION_21 = 21;

/** v22: each session's ordered event log (DDL only). */
export const SCHEMA_VERSION_22 = 22;

/** v23: the sub-agents written inside agents removed, each logged as an agent manifest. */
export const SCHEMA_VERSION_23 = 23;

/** v24: every named kind's slug recorded as its current name in the name table. */
export const SCHEMA_VERSION_24 = 24;

/** v25: every stored reference holds the id of the resource its name held. */
export const SCHEMA_VERSION_25 = 25;

/** v26: each session event's gates (the tool use it opens or closes), derived at open (DDL only). */
export const SCHEMA_VERSION_26 = 26;

/** v27: the permission history and its per-organization heads (DDL only). */
export const SCHEMA_VERSION_27 = 27;

/** v28: a session's harness state moved from its spec to its status. */
export const SCHEMA_VERSION_28 = 28;

/** v29: every stored resource stamped with its etag. */
export const SCHEMA_VERSION_29 = 29;

/** v30: the identity provider is a federation issuer: its names and the grants that name it. */
export const SCHEMA_VERSION_30 = 30;

/** v31: the permission history indexed by time, for retention (DDL only). */
export const SCHEMA_VERSION_31 = 31;

/** v32: the stored labels, tags and annotations the new rules refuse, reported (nothing rewritten). */
export const SCHEMA_VERSION_32 = 32;

/** v33: the platform client rows removed, with every grant naming one. */
export const SCHEMA_VERSION_33 = 33;

/** v34: the IAM policy is a grant: its names, its ids and its history's tables. */
export const SCHEMA_VERSION_34 = 34;

/** v35: the plugin eval and agent eval rows removed, with every grant naming one, and their tries relabelled. */
export const SCHEMA_VERSION_35 = 35;

/** v36: the evaluator is a scoring rule: its names. */
export const SCHEMA_VERSION_36 = 36;

/** v37: the agent share and agent channel kinds merged into the channel kind: rows, names, grants, history, conversations. */
export const SCHEMA_VERSION_37 = 37;

/** Target version for new databases. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_37;

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
  logger: StoreLogger = NOOP_STORE_LOGGER,
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
      [SCHEMA_VERSION_21, (migrating) => migrateToV21(migrating, logger)],
      [SCHEMA_VERSION_22, migrateToV22],
      [SCHEMA_VERSION_23, (migrating) => migrateToV23(migrating, logger)],
      [SCHEMA_VERSION_24, (migrating) => migrateToV24(migrating, logger)],
      [SCHEMA_VERSION_25, (migrating) => migrateToV25(migrating, logger)],
      [SCHEMA_VERSION_26, migrateToV26],
      [SCHEMA_VERSION_27, migrateToV27],
      [SCHEMA_VERSION_28, migrateToV28],
      [SCHEMA_VERSION_29, (migrating) => migrateToV29(migrating, logger)],
      [SCHEMA_VERSION_30, migrateToV30],
      [SCHEMA_VERSION_31, migrateToV31],
      [SCHEMA_VERSION_32, (migrating) => migrateToV32(migrating, logger)],
      [SCHEMA_VERSION_33, migrateToV33],
      [SCHEMA_VERSION_34, migrateToV34],
      [SCHEMA_VERSION_35, migrateToV35],
      [SCHEMA_VERSION_36, migrateToV36],
      [SCHEMA_VERSION_37, (migrating) => migrateToV37(migrating, logger)],
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
 * - Every grant row is read in keyset pages, and the ones naming an
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

  const retiredGrantIds: string[] = [];
  await forEachRow(GRANT_KIND_AT_STEP, (row) => {
    try {
      if (grantNamesRetiredInstance(new Uint8Array(row.data))) {
        retiredGrantIds.push(row.id);
      }
    } catch (error) {
      throw unreadableRowError(GRANT_KIND_AT_STEP, row.id, error);
    }
  });
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [GRANT_KIND_AT_STEP, retiredGrantIds],
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
 * - Every grant row is read in keyset pages, and the ones naming an
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
  const retiredGrantIds: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [WORKFLOW_RETIREMENT_GRANT_KIND, after, WORKFLOW_RETIREMENT_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (grantNamesRetiredWorkflowInstance(new Uint8Array(row.data))) {
          retiredGrantIds.push(row.id);
        }
      } catch (error) {
        throw unreadableWorkflowRowError(
          WORKFLOW_RETIREMENT_GRANT_KIND,
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
      [WORKFLOW_RETIREMENT_GRANT_KIND, retiredGrantIds],
    );
  }

  for (const table of ["resource_audit", "resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [
      RETIRED_WORKFLOW_INSTANCE_KIND,
    ]);
  }
}

/**
 * v13: agent executions are runs. kind-rename.ts says what each row becomes
 * and why an unreadable row fails the step; `renameKind` applies it.
 */
async function migrateToV13(client: PoolClient): Promise<void> {
  await renameKind(client, RUN_RENAME_V18);
}

/**
 * One rename of a kind (kind-rename.ts), shared by v13, v16, v30 and v34.
 *
 * - Every row of the kind is read in keyset pages under its old name and
 *   rewritten when its bytes spell the kind the old way; then every table
 *   keyed by kind renames the kind.
 * - Every grant row is read in keyset pages, and the ones naming the
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
async function renameKind(client: PoolClient, rename: KindRename): Promise<void> {
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
          [kind, after, KIND_RENAME_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        await visit(row);
      }
      if (rows.length < KIND_RENAME_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  await forEachRow(fromKind, async (row) => {
    let data: Uint8Array | undefined;
    try {
      data = renamedKindRow(rename, new Uint8Array(row.data));
    } catch (error) {
      throw unreadableKindRenameRowError(rename, fromKind, row.id, error);
    }
    if (data !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
        [Buffer.from(data), fromKind, row.id],
      );
    }
  });
  for (const table of KIND_TABLES) {
    await client.query(`UPDATE ${table} SET kind = $1 WHERE kind = $2`, [
      toKind,
      fromKind,
    ]);
  }

  const rekeyed: Array<{ from: string; grant: RekeyedGrant }> = [];
  await forEachRow(KIND_RENAME_GRANT_KIND, (row) => {
    try {
      const grant = rekeyedGrant(rename, new Uint8Array(row.data));
      if (grant !== undefined) {
        rekeyed.push({ from: row.id, grant });
      }
    } catch (error) {
      throw unreadableKindRenameRowError(rename, KIND_RENAME_GRANT_KIND, row.id, error);
    }
  });
  for (const { from, grant } of rekeyed) {
    for (const table of ["resource_list_keys", "resources"]) {
      await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = $2`, [
        KIND_RENAME_GRANT_KIND,
        from,
      ]);
    }
    await client.query(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`,
      [KIND_RENAME_GRANT_KIND, grant.id, Buffer.from(grant.data)],
    );
  }
}

/**
 * v14: workflows, workflow runs and the artifact kind are removed
 * (workflow-retired.ts says what leaves, what each agent run becomes and
 * why an unreadable row fails the step).
 *
 * - Every grant row is read in keyset pages, and the ones naming a
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

  const retiredGrantIds: string[] = [];
  await forEachRow(
    WORKFLOW_RETIRED_GRANT_KIND,
    WORKFLOW_RETIRED_PAGE_SIZE,
    (row) => {
      try {
        if (grantNamesRetiredWorkflowKind(new Uint8Array(row.data))) {
          retiredGrantIds.push(row.id);
        }
      } catch (error) {
        throw unreadableRetiredWorkflowRowError(
          WORKFLOW_RETIRED_GRANT_KIND,
          row.id,
          error,
        );
      }
    },
  );
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [WORKFLOW_RETIRED_GRANT_KIND, retiredGrantIds],
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

  for (const table of KIND_TABLES) {
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
 * (`renameKind`), with this step's frozen names (kind-rename.ts
 * `RUN_RENAME_V21`, the SQLite step's number). Runs keep their ids, the
 * `aex_` ones included.
 */
async function migrateToV16(client: PoolClient): Promise<void> {
  await renameKind(client, RUN_RENAME_V21);
}

/**
 * v17: vaults replace the Environment kind (../environment-retired.ts says
 * what leaves and why nothing is carried). Every grant row is read in
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
  const retiredGrantIds: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [ENVIRONMENT_RETIRED_GRANT_KIND, after, ENVIRONMENT_RETIRED_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (grantNamesRetiredEnvironment(new Uint8Array(row.data))) {
          retiredGrantIds.push(row.id);
        }
      } catch (error) {
        throw unreadableRetiredEnvironmentRowError(
          ENVIRONMENT_RETIRED_GRANT_KIND,
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
      [ENVIRONMENT_RETIRED_GRANT_KIND, retiredGrantIds],
    );
  }

  for (const table of KIND_TABLES) {
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
  for (const table of KIND_TABLES) {
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

/**
 * v21: a plugin is one thing — the SQLite driver's v26 in this engine's
 * terms (../mcp-server-retired.ts says what each row becomes). Plugins, MCP
 * server rows and the skills a plugin installed are read first; agents are
 * rewritten as new archived versions, sessions list their plugins and move
 * to their agent's new version; the grants on the rows that leave go, then
 * the rows; the connect attempt table is recreated naming a plugin's
 * server. Runs inside applyInTransaction's BEGIN.
 */
async function migrateToV21(client: PoolClient, logger: StoreLogger): Promise<void> {
  const forEachRow = async (
    kind: string,
    visit: (row: { id: string; data: Uint8Array }) => Promise<void> | void,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources WHERE kind = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [kind, after, SERVER_RETIREMENT_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        try {
          await visit({ id: row.id, data: new Uint8Array(row.data) });
        } catch (error) {
          throw unreadableRetiredServerRowError(kind, row.id, error);
        }
      }
      if (rows.length < SERVER_RETIREMENT_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const facts = new RetirementFacts();
  await forEachRow(PLUGIN_KIND, (row) => facts.addPlugin(pluginFactsOf(row.data)));
  await forEachRow(RETIRED_MCP_SERVER_KIND, (row) => facts.addServer(serverFactsOf(row.data)));
  await forEachRow(SKILL_KIND, (row) => {
    const member = memberSkillFactsOf(row.data);
    if (member !== undefined) {
      facts.addMemberSkill(member);
    }
  });

  const repinned = new Map<string, string>();
  await forEachRow(RETIREMENT_AGENT_KIND, async (row) => {
    const migrated = migrateAgentRow(row.data, facts, logger);
    if (migrated === undefined) {
      return;
    }
    await client.query(
      `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
      [Buffer.from(migrated.data), RETIREMENT_AGENT_KIND, row.id],
    );
    const archived = await client.query(
      `SELECT 1 FROM resource_audit WHERE kind = $1 AND resource_id = $2 AND version_hash = $3 LIMIT 1`,
      [RETIREMENT_AGENT_KIND, row.id, migrated.versionHash],
    );
    if (archived.rowCount === 0) {
      await client.query(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
         VALUES ($1, $2, $3, $4, '', now())`,
        [RETIREMENT_AGENT_KIND, row.id, Buffer.from(migrated.data), migrated.versionHash],
      );
    }
    repinned.set(row.id, migrated.versionHash);
  });
  await forEachRow(RETIREMENT_SESSION_KIND, async (row) => {
    const migrated = migrateSessionRowForPlugins(row.data, facts, repinned, logger);
    if (migrated !== undefined) {
      await client.query(
        `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
        [Buffer.from(migrated), RETIREMENT_SESSION_KIND, row.id],
      );
    }
  });

  const serverIds = facts.serverIds();
  const memberSkillIds = facts.memberSkillIds();
  const retiredGrantIds: string[] = [];
  await forEachRow(RETIREMENT_GRANT_KIND, (row) => {
    if (grantNamesRetired(row.data, serverIds, memberSkillIds)) {
      retiredGrantIds.push(row.id);
    }
  });
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`, [
      RETIREMENT_GRANT_KIND,
      retiredGrantIds,
    ]);
  }
  await client.query(`DELETE FROM resource_audit WHERE kind = $1 AND resource_id = ANY($2::text[])`, [
    SKILL_KIND,
    [...memberSkillIds],
  ]);
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`, [
      SKILL_KIND,
      [...memberSkillIds],
    ]);
  }
  for (const table of ["resource_audit", "resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [RETIRED_MCP_SERVER_KIND]);
  }

  await client.query(`
    DROP TABLE connect_attempt;

    CREATE TABLE connect_attempt (
      id TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      created_by TEXT NOT NULL,
      person TEXT NOT NULL DEFAULT '',
      plugin_id TEXT NOT NULL,
      server TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX idx_connect_attempt_org ON connect_attempt (org);
    CREATE INDEX idx_connect_attempt_expires ON connect_attempt (expires_at);
  `);
}

/**
 * v23: a subagent is a saved agent the parent lists
 * (../sub-agents-retired.ts says what each row becomes and why a sub-agent
 * is logged rather than created). Every agent holding sub-agents written
 * inside it loses them, as a new current version archived like any saved
 * one, and each one is logged as an agent manifest; every session on a
 * changed agent moves to its new version. The SQLite driver's v28 in this
 * engine's terms. Runs inside applyInTransaction's BEGIN.
 */
async function migrateToV23(client: PoolClient, logger: StoreLogger): Promise<void> {
  const forEachRow = async (
    kind: string,
    visit: (row: { id: string; data: Uint8Array }) => Promise<void>,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources WHERE kind = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [kind, after, SUB_AGENT_RETIREMENT_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        try {
          await visit({ id: row.id, data: new Uint8Array(row.data) });
        } catch (error) {
          throw unreadableSubAgentRowError(kind, row.id, error);
        }
      }
      if (rows.length < SUB_AGENT_RETIREMENT_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };
  const update = async (kind: string, id: string, data: Uint8Array): Promise<void> => {
    await client.query(
      `UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`,
      [Buffer.from(data), kind, id],
    );
  };

  const repinned = new Map<string, string>();
  await forEachRow(SUB_AGENT_RETIREMENT_AGENT_KIND, async (row) => {
    const migrated = retireSubAgentsInAgentRow(row.data, logger);
    if (migrated === undefined) {
      return;
    }
    await update(SUB_AGENT_RETIREMENT_AGENT_KIND, row.id, migrated.data);
    const archived = await client.query(
      `SELECT 1 FROM resource_audit WHERE kind = $1 AND resource_id = $2 AND version_hash = $3 LIMIT 1`,
      [SUB_AGENT_RETIREMENT_AGENT_KIND, row.id, migrated.versionHash],
    );
    if (archived.rowCount === 0) {
      await client.query(
        `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
         VALUES ($1, $2, $3, $4, '', now())`,
        [SUB_AGENT_RETIREMENT_AGENT_KIND, row.id, Buffer.from(migrated.data), migrated.versionHash],
      );
    }
    repinned.set(row.id, migrated.versionHash);
  });
  if (repinned.size === 0) {
    return;
  }
  await forEachRow(SUB_AGENT_RETIREMENT_SESSION_KIND, async (row) => {
    const migrated = repinSessionRow(row.data, repinned);
    if (migrated !== undefined) {
      await update(SUB_AGENT_RETIREMENT_SESSION_KIND, row.id, migrated);
    }
  });
}

/**
 * v24: every named kind's slug is its current name in the name table
 * (../resource-names-backfill.ts says which kinds, which row keeps a slug
 * two rows share, and why an unreadable row fails the step). Each kind is
 * read in keyset pages and its names inserted; a name the table already
 * holds is left as it is. The SQLite driver's v29 in this engine's terms.
 * Runs inside applyInTransaction's BEGIN.
 */
async function migrateToV24(client: PoolClient, logger: StoreLogger): Promise<void> {
  const now = new Date().toISOString();
  for (const named of NAMED_KINDS_AT_BACKFILL) {
    const backfill = new KindNameBackfill(named, now);
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources WHERE kind = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [named.kind, after, RESOURCE_NAMES_BACKFILL_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        backfill.add(row.id, new Uint8Array(row.data));
      }
      if (rows.length < RESOURCE_NAMES_BACKFILL_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
    for (const name of backfill.names(logger)) {
      await client.query(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at)
         VALUES ($1, $2, $3, $4, 'current', $5)
         ON CONFLICT (kind, org, name) DO NOTHING`,
        [name.kind, name.org, name.name, name.id, name.claimedAt],
      );
    }
  }
}

/**
 * v25: every stored reference holds the id of the resource its name held
 * (../references-by-id.ts says which rows, how a reference resolves, what
 * an unresolved one keeps, and why an unreadable row fails the step). The
 * live names of the kinds a reference may name are read once; each
 * referring kind is read in keyset pages and a row its rewrite changed is
 * written back; the agent's archived versions are rewritten in place under
 * their hashes. The SQLite driver's v30 in this engine's terms. Runs
 * inside applyInTransaction's BEGIN.
 */
async function migrateToV25(client: PoolClient, logger: StoreLogger): Promise<void> {
  const names = (
    await client.query<NameAtRewrite>(
      `SELECT kind, org, name, id FROM resource_names
       WHERE kind = ANY($1::text[]) AND (expires_at = '' OR expires_at > $2)`,
      [[...NAMED_KINDS_AT_REWRITE], new Date().toISOString()],
    )
  ).rows;
  const rewrite = new ReferenceRewrite(names);
  for (const referring of REFERRING_KINDS_AT_REWRITE) {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources WHERE kind = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [referring.kind, after, REFERENCES_BY_ID_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        const rewritten = rewrite.rewrite(referring, row.id, new Uint8Array(row.data));
        if (rewritten !== undefined) {
          await client.query(
            `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
            [Buffer.from(rewritten), referring.kind, row.id],
          );
        }
      }
      if (rows.length < REFERENCES_BY_ID_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
  }
  const archived = ARCHIVED_KIND_AT_REWRITE;
  for (let after = "0"; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id::text AS id, data FROM resource_audit
         WHERE kind = $1 AND id > $2::bigint ORDER BY id LIMIT $3`,
        [archived.kind, after, REFERENCES_BY_ID_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      const rewritten = rewrite.rewrite(archived, `archive ${row.id}`, new Uint8Array(row.data));
      if (rewritten !== undefined) {
        await client.query(`UPDATE resource_audit SET data = $1 WHERE id = $2::bigint`, [
          Buffer.from(rewritten),
          row.id,
        ]);
      }
    }
    if (rows.length < REFERENCES_BY_ID_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  rewrite.report(logger);
}

/**
 * v22: each session's ordered event log (../session-events.ts). One row per
 * event, numbered per session: the primary key is the order, the event id
 * is unique per session (a runner's resend is recognised by it), and each
 * read the log serves has its index: a type filter and a session's newest
 * status event (type, seq), a run's own events at its delete (run_id, seq),
 * and an organization's purge (org). `processed_at` is fixed-width UTC
 * text, compared as bytes like every ledger time here. The SQLite driver's
 * v27 in this engine's terms.
 */
async function migrateToV22(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE session_events (
      session_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      event_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      org TEXT NOT NULL DEFAULT '',
      processed_at TEXT NOT NULL,
      data BYTEA NOT NULL,
      PRIMARY KEY (session_id, seq)
    );

    CREATE UNIQUE INDEX idx_session_events_event_id ON session_events (session_id, event_id);
    CREATE INDEX idx_session_events_type ON session_events (session_id, type, seq);
    CREATE INDEX idx_session_events_run ON session_events (session_id, run_id, seq);
    CREATE INDEX idx_session_events_org ON session_events (org);
    -- A session's high-water mark: the last seq and accepted time it handed
    -- out. Numbers come from here, never from the newest row, so a run's
    -- removal (which deletes its own events) never lowers it and no number
    -- is handed out twice.
    CREATE TABLE session_event_heads (
      session_id TEXT PRIMARY KEY,
      org TEXT NOT NULL DEFAULT '',
      last_seq BIGINT NOT NULL,
      last_processed_at TEXT NOT NULL
    );
    CREATE INDEX idx_session_event_heads_org ON session_event_heads (org);
  `);
}

/**
 * v26: each session event's gates (../session-events.ts, "Gates"): the tool
 * use an event opens (`opens_gate`, a call that waits for a person's
 * answer) or closes (`closes_gate`, the answer or the call's result), and
 * the revision of the domain's derivation that wrote them
 * (`gate_revision`, 0 for none). The columns are derived from each event's
 * bytes by the store, at write and, for every row of another revision, at
 * open, so this migration adds them empty. The two partial indexes serve
 * the read of a session's open gates under its lock; the revision index
 * serves the derivation at open. The SQLite driver's v31 in this engine's
 * terms.
 */
async function migrateToV26(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE session_events ADD COLUMN opens_gate TEXT NOT NULL DEFAULT '';
    ALTER TABLE session_events ADD COLUMN closes_gate TEXT NOT NULL DEFAULT '';
    ALTER TABLE session_events ADD COLUMN gate_revision INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_session_events_opens_gate ON session_events (session_id, opens_gate)
      WHERE opens_gate <> '';
    CREATE INDEX idx_session_events_closes_gate ON session_events (session_id, closes_gate)
      WHERE closes_gate <> '';
    CREATE INDEX idx_session_events_gate_revision ON session_events (gate_revision);
  `);
}

/**
 * v27: the permission history (../permission-history.ts): one entry per
 * change to an access row, written by the store in the row's transaction
 * when an edition keeps one, and the per-organization heads its numbers
 * come from. `change` is granted or revoked; `cause`, `actor_id` and
 * `actor_class` say why and who; `policy_id`, the decomposed triple and
 * `data` (the row as granted, or as it stood when revoked) are read from
 * the row itself. `occurred_at` is fixed-width UTC text, compared as bytes
 * like every ledger time here. The primary key (org, sequence) is an
 * organization's entries in order; no other index until a query needs
 * one. Not the Cloud's `cloud.iam_policy_history`, which its own policy
 * store writes; the columns match so one reader reads both alike. The
 * SQLite driver's v32 in this engine's terms.
 */
async function migrateToV27(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE iam_policy_history (
      org TEXT NOT NULL,
      sequence BIGINT NOT NULL,
      occurred_at TEXT NOT NULL,
      change TEXT NOT NULL CHECK (change IN ('granted', 'revoked')),
      cause TEXT NOT NULL CHECK (cause <> ''),
      actor_id TEXT NOT NULL,
      actor_class TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      principal_kind TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      principal_relation TEXT NOT NULL DEFAULT '',
      relation TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      data BYTEA NOT NULL,
      PRIMARY KEY (org, sequence)
    );
    -- An organization's high-water mark: the last number and time it handed
    -- out. Numbers come from here, so they never repeat or go back.
    CREATE TABLE iam_policy_history_heads (
      org TEXT PRIMARY KEY,
      last_sequence BIGINT NOT NULL,
      last_occurred_at TEXT NOT NULL
    );
  `);
}

/**
 * v28: a session's harness state moves from its spec to its status
 * (../session-harness-state-moved.ts says what each row becomes). Every
 * session row is read in keyset pages on `(kind, id)` and rewritten only
 * when its spec holds a moved field, its `updated_at` left alone. The
 * chain's advisory lock keeps a second instance's boot out of the step,
 * and the transaction makes it whole or nothing.
 */
async function migrateToV28(client: PoolClient): Promise<void> {
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [SESSION_HARNESS_KIND, after, SESSION_HARNESS_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let migrated: Uint8Array | undefined;
      try {
        migrated = migrateSessionHarnessRow(new Uint8Array(row.data));
      } catch (error) {
        throw unreadableSessionHarnessError(row.id, error);
      }
      if (migrated !== undefined) {
        await client.query(
          `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
          [Buffer.from(migrated), SESSION_HARNESS_KIND, row.id],
        );
      }
    }
    if (rows.length < SESSION_HARNESS_PAGE_SIZE) {
      return;
    }
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * v29: every stored resource is stamped with its etag
 * (../resource-etags-stamped.ts says what each row becomes). Each kind's
 * rows are read in keyset pages on `(kind, id)` and rewritten only when
 * the etag they carry is not the one their content gives, their
 * `updated_at` left alone (an etag is not an edit). A row that does not
 * decode is left as it is and reported, never fatal.
 */
async function migrateToV29(client: PoolClient, logger: StoreLogger): Promise<void> {
  for (const kind of ETAG_STAMPED_KIND_NAMES) {
    const unreadable: string[] = [];
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, ETAG_STAMP_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        let stamped: Uint8Array | undefined;
        try {
          stamped = stampEtagRow(kind, new Uint8Array(row.data));
        } catch {
          unreadable.push(row.id);
          continue;
        }
        if (stamped !== undefined) {
          await client.query(
            `UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`,
            [Buffer.from(stamped), kind, row.id],
          );
        }
      }
      if (rows.length < ETAG_STAMP_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
    logUnreadableEtagRows(logger, kind, unreadable);
  }
}

/**
 * v30: the identity provider is a federation issuer. The kind
 * `identity_provider` and its kind string `IdentityProvider` become
 * `federation_issuer` and `FederationIssuer` by the same transformation as
 * v13 (`renameKind`), with this step's frozen names (kind-rename.ts
 * `FEDERATION_ISSUER_RENAME_V30`): the name table's claims an edition made
 * for its issuers, and every grant naming one, re-keyed. The issuers' own
 * rows are an edition's, in tables of its own, and it renames them itself.
 * SQLite has no twin (kind-rename.ts says why). Issuers keep their ids,
 * the `idp_` ones included.
 *
 * The permission history (v27), which the earlier renames predate, follows
 * too: each entry naming the kind gets the kind's new name in its columns,
 * and the policy id and bytes its grant was re-keyed to, so the history
 * reads the kind by its name and a revoke after the upgrade names the id
 * the grant's entry holds. Entries are read in keyset pages on
 * `(org, sequence)`; their numbers and times are kept.
 */
async function migrateToV30(client: PoolClient): Promise<void> {
  const rename = FEDERATION_ISSUER_RENAME_V30;
  await renameKind(client, rename);
  const [fromKind, toKind] = rename.kind;
  await rekeyGrantHistory(client, {
    table: "iam_policy_history",
    idColumn: "policy_id",
    fromKinds: [fromKind],
    toKind,
    pageSize: KIND_RENAME_PAGE_SIZE,
    rekey: (data) => rekeyedGrant(rename, data),
    unreadable: (entry, error) => unreadableKindRenameRowError(rename, "iam_policy_history", entry, error),
  });
}

/** One step's move of the permission history's entries naming renamed kinds. */
interface GrantHistoryRekey {
  /** The history table as the step's time named it (`iam_policy_history` until v34, `grant_history` since). */
  readonly table: string;
  /** The column holding each entry's grant id at the step's time (`policy_id` until v34, `grant_id` since). */
  readonly idColumn: string;
  /** The kinds an entry's principal or resource may name, which the step moves. */
  readonly fromKinds: ReadonlyArray<string>;
  /** The kind they become. */
  readonly toKind: string;
  readonly pageSize: number;
  /** The re-keyed grant of an entry's copy of its grant row, or undefined when it names none of the kinds. */
  readonly rekey: (data: Uint8Array) => RekeyedGrant | undefined;
  /** The step's failure for an entry it cannot read, named `org/sequence`. */
  readonly unreadable: (entry: string, error: unknown) => Error;
}

/**
 * The permission history's entries naming one of a step's renamed kinds,
 * moved (v30 and v36): each takes the new kind's name in its kind columns,
 * and the id and bytes its grant was re-keyed to, so the history reads the
 * kind by its name and a revoke after the upgrade names the id the grant's
 * entry holds. Entries are read in keyset pages on `(org, sequence)`; their
 * numbers and times are kept.
 */
async function rekeyGrantHistory(client: PoolClient, step: GrantHistoryRekey): Promise<void> {
  const fromKinds = [...step.fromKinds];
  for (let afterOrg = "", afterSequence = 0; ; ) {
    const rows = (
      await client.query<{ org: string; sequence: string; data: Buffer }>(
        `SELECT org, sequence, data FROM ${step.table}
         WHERE (principal_kind = ANY($1::text[]) OR resource_kind = ANY($1::text[]))
           AND (org COLLATE "C", sequence) > ($2 COLLATE "C", $3)
         ORDER BY org COLLATE "C", sequence
         LIMIT $4`,
        [fromKinds, afterOrg, afterSequence, step.pageSize],
      )
    ).rows;
    for (const row of rows) {
      let grant: RekeyedGrant | undefined;
      try {
        grant = step.rekey(new Uint8Array(row.data));
      } catch (error) {
        throw step.unreadable(`${row.org}/${row.sequence}`, error);
      }
      await client.query(
        `UPDATE ${step.table}
            SET principal_kind = CASE WHEN principal_kind = ANY($1::text[]) THEN $2 ELSE principal_kind END,
                resource_kind = CASE WHEN resource_kind = ANY($1::text[]) THEN $2 ELSE resource_kind END,
                ${step.idColumn} = COALESCE($3, ${step.idColumn}),
                data = COALESCE($4, data)
          WHERE org = $5 AND sequence = $6`,
        [fromKinds, step.toKind, grant?.id ?? null, grant === undefined ? null : Buffer.from(grant.data), row.org, row.sequence],
      );
    }
    if (rows.length < step.pageSize) {
      return;
    }
    const last = rows[rows.length - 1]!;
    afterOrg = last.org;
    afterSequence = Number(last.sequence);
  }
}

/**
 * v31: the permission history indexed by time, for retention
 * (../permission-history.ts, "Removal"). The removal deletes the entries
 * before a cutoff ordered by `(occurred_at, org, sequence)`, a batch at a
 * time; the index is that order exactly, so each batch is a walk that
 * stops at its limit instead of a scan of every organization's entries.
 * The SQLite driver's v35 in this engine's terms.
 */
async function migrateToV31(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE INDEX iam_policy_history_by_time
      ON iam_policy_history (occurred_at, org, sequence)
  `);
}

/**
 * v32: labels and tags gain their rules and annotations leave resource
 * metadata (../label-tag-report.ts says what a row is found to hold). Each
 * kind's rows are read in keyset pages on `(kind, id)`, and the ones whose
 * stored labels, tags or annotations the rules refuse are named in one
 * warning per kind. Nothing is written: the step only reports.
 */
async function migrateToV32(client: PoolClient, logger: StoreLogger): Promise<void> {
  for (const kind of LABEL_TAG_REPORT_KIND_NAMES) {
    const tally = new LabelTagTally(kind);
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, LABEL_TAG_REPORT_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        tally.add(row.id, new Uint8Array(row.data));
      }
      if (rows.length < LABEL_TAG_REPORT_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
    tally.log(logger);
  }
}

/**
 * v33: the platform client kind is removed (../platform-client-retired.ts
 * says what leaves, what stays and why an unreadable row fails the step).
 *
 * - Every grant row is read in keyset pages, and the ones naming a
 *   client as resource or principal are deleted with their list keys,
 *   their history kept, as the store deletes a policy.
 * - The client rows then leave every table that keys a row by kind.
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale and the primary
 * key serves it. The chain's advisory lock keeps a second instance's boot
 * out of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV33(client: PoolClient): Promise<void> {
  const retiredGrantIds: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [
          PLATFORM_CLIENT_RETIRED_GRANT_KIND,
          after,
          PLATFORM_CLIENT_RETIRED_PAGE_SIZE,
        ],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (grantNamesRetiredPlatformClient(new Uint8Array(row.data))) {
          retiredGrantIds.push(row.id);
        }
      } catch (error) {
        throw unreadablePlatformClientRowError(
          PLATFORM_CLIENT_RETIRED_GRANT_KIND,
          row.id,
          error,
        );
      }
    }
    if (rows.length < PLATFORM_CLIENT_RETIRED_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(
      `DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`,
      [PLATFORM_CLIENT_RETIRED_GRANT_KIND, retiredGrantIds],
    );
  }
  for (const table of KIND_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1`, [
      RETIRED_PLATFORM_CLIENT_KIND,
    ]);
  }
}

/**
 * v34: the IAM policy is a grant (kind-rename.ts says why its ids move
 * when no other kind's do).
 *
 * - The kind `iam_policy` and its kind string `IamPolicy` become `grant`
 *   and `Grant` by the same transformation as v13 (`renameKind`), with this
 *   step's frozen names (`GRANT_RENAME_V34`).
 * - Every grant row is then read in keyset pages and moved from `iamp_X`
 *   to `grt_X`, its bytes' id with it, and its list keys follow; a row
 *   already at its `grt_` id is left as it is, and a row whose id is not
 *   the one its triple derives fails the step, naming it.
 * - The permission history's tables, their primary-key indexes and the
 *   time index (v27, v31) take the kind's name, and the history's
 *   `policy_id` column becomes `grant_id`. Every entry is read in keyset
 *   pages on `(org, sequence)` and moved the same way; numbers and times
 *   are kept.
 *
 * The rows are collected before any id moves, so no page reads an id the
 * step already wrote. The chain's advisory lock keeps a second instance's
 * boot out of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV34(client: PoolClient): Promise<void> {
  const rename = GRANT_RENAME_V34;
  const [, grantKind] = rename.kind;
  await renameKind(client, rename);

  const moved: Array<{ from: string; grant: RekeyedGrant }> = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [grantKind, after, KIND_RENAME_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let grant: RekeyedGrant | undefined;
      try {
        grant = movedGrant(row.id, new Uint8Array(row.data));
      } catch (error) {
        throw unreadableKindRenameRowError(rename, grantKind, row.id, error);
      }
      if (grant !== undefined) {
        moved.push({ from: row.id, grant });
      }
    }
    if (rows.length < KIND_RENAME_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  for (const { from, grant } of moved) {
    await client.query(
      `UPDATE resources SET id = $1, data = $2 WHERE kind = $3 AND id = $4`,
      [grant.id, Buffer.from(grant.data), grantKind, from],
    );
    await client.query(
      `UPDATE resource_list_keys SET id = $1 WHERE kind = $2 AND id = $3`,
      [grant.id, grantKind, from],
    );
  }

  await client.query(`
    ALTER TABLE iam_policy_history RENAME TO grant_history;
    ALTER INDEX iam_policy_history_pkey RENAME TO grant_history_pkey;
    ALTER TABLE grant_history RENAME COLUMN policy_id TO grant_id;
    ALTER INDEX iam_policy_history_by_time RENAME TO grant_history_by_time;
    ALTER TABLE iam_policy_history_heads RENAME TO grant_history_heads;
    ALTER INDEX iam_policy_history_heads_pkey RENAME TO grant_history_heads_pkey;
  `);
  for (let afterOrg = "", afterSequence = 0; ; ) {
    const rows = (
      await client.query<{ org: string; sequence: string; grant_id: string; data: Buffer }>(
        `SELECT org, sequence, grant_id, data FROM grant_history
         WHERE (org COLLATE "C", sequence) > ($1 COLLATE "C", $2)
         ORDER BY org COLLATE "C", sequence
         LIMIT $3`,
        [afterOrg, afterSequence, KIND_RENAME_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let grant: RekeyedGrant | undefined;
      try {
        grant = movedGrant(row.grant_id, new Uint8Array(row.data));
      } catch (error) {
        throw unreadableKindRenameRowError(rename, "grant_history", `${row.org}/${row.sequence}`, error);
      }
      if (grant !== undefined) {
        await client.query(
          `UPDATE grant_history SET grant_id = $1, data = $2 WHERE org = $3 AND sequence = $4`,
          [grant.id, Buffer.from(grant.data), row.org, row.sequence],
        );
      }
    }
    if (rows.length < KIND_RENAME_PAGE_SIZE) {
      return;
    }
    const last = rows[rows.length - 1]!;
    afterOrg = last.org;
    afterSequence = Number(last.sequence);
  }
}

/**
 * v35: the plugin eval and agent eval kinds are removed for one eval run
 * kind (../eval-kinds-retired.ts says what leaves, what stays relabelled
 * and why an unreadable row fails the step).
 *
 * - Every grant row (kind `grant` since v34) is read in keyset pages, and
 *   the ones naming a retired kind as resource or principal are deleted
 *   with their list keys, their history kept, as the store deletes a
 *   grant.
 * - The retired kinds' rows then leave every table that keys a row by
 *   kind.
 * - Every session, run and score row carrying the retired label is read
 *   in keyset pages and written back relabelled; its list keys are derived
 *   again at the next open, since the three list indexes' revisions moved.
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale and the primary
 * key serves it. The chain's advisory lock keeps a second instance's boot
 * out of the step, and the transaction makes it whole or nothing.
 */
async function migrateToV35(client: PoolClient): Promise<void> {
  const retiredPolicies: string[] = [];
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM resources
         WHERE kind = $1 AND id > $2
         ORDER BY id
         LIMIT $3`,
        [EVAL_KINDS_RETIRED_GRANT_KIND, after, EVAL_KINDS_RETIRED_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      try {
        if (grantNamesRetiredEvalKind(new Uint8Array(row.data))) {
          retiredPolicies.push(row.id);
        }
      } catch (error) {
        throw unreadableEvalKindRowError(EVAL_KINDS_RETIRED_GRANT_KIND, row.id, error);
      }
    }
    if (rows.length < EVAL_KINDS_RETIRED_PAGE_SIZE) {
      break;
    }
    after = rows[rows.length - 1]!.id;
  }
  for (const table of ["resource_list_keys", "resources"]) {
    await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = ANY($2::text[])`, [
      EVAL_KINDS_RETIRED_GRANT_KIND,
      retiredPolicies,
    ]);
  }
  for (const table of KIND_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE kind = ANY($1::text[])`, [[...RETIRED_EVAL_KINDS]]);
  }
  for (const kind of EVAL_TRY_KIND_NAMES) {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, EVAL_KINDS_RETIRED_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        let relabelled: Uint8Array | undefined;
        try {
          relabelled = relabelEvalTryRow(kind, new Uint8Array(row.data));
        } catch (error) {
          throw unreadableEvalKindRowError(kind, row.id, error);
        }
        if (relabelled !== undefined) {
          await client.query(`UPDATE resources SET data = $1 WHERE kind = $2 AND id = $3`, [
            Buffer.from(relabelled),
            kind,
            row.id,
          ]);
        }
      }
      if (rows.length < EVAL_KINDS_RETIRED_PAGE_SIZE) {
        break;
      }
      after = rows[rows.length - 1]!.id;
    }
  }
}

/**
 * v36: the evaluator is a scoring rule. The kind `evaluator` and its kind
 * string `Evaluator` become `scoring_rule` and `ScoringRule` by the same
 * transformation as v13 (`renameKind`), with this step's frozen names
 * (kind-rename.ts `SCORING_RULE_RENAME_V36`). Its rows keep their `evl_`
 * ids and their settings and spend. The kind lists no grantable roles, so
 * no grant and no permission history entry names it.
 */
async function migrateToV36(client: PoolClient): Promise<void> {
  await renameKind(client, SCORING_RULE_RENAME_V36);
}

/**
 * v37: the agent share and agent channel kinds merge into the channel kind
 * (../channel-kinds-merged.ts says what one row becomes, which row keeps a
 * slug two held, and why an unreadable row fails the step).
 *
 * - An archived version or a previous name of either kind fails the step,
 *   naming it: neither kind wrote one.
 * - Every row of both kinds is read in keyset pages and converted, the
 *   one namespace's slugs assigned, then each row leaves under its old
 *   kind with its list keys and is written under `channel` with its id,
 *   unproven (`updated_at` stamped), so its keys derive at open.
 * - The names of both kinds are claimed again under `channel`, each with
 *   the slug its row now holds and the time its old claim was made.
 * - Every grant naming either kind is re-keyed to the channel triple's
 *   `grt_` id, its old row leaving with its list keys and the new one
 *   written unproven; its history entries move by v30's loop
 *   (`rekeyGrantHistory`) on the tables v34 named.
 * - Every conversation (session and run) a chat link's guest started takes
 *   the channel id label in place of the share id, written unproven.
 *
 * Each page compares and orders `id` under the column's own collation, so
 * the keyset is consistent whatever the database's locale. The changed
 * slugs are logged at warn, once, as a count and a capped sample. The
 * chain's advisory lock keeps a second instance's boot out of the step,
 * and the transaction makes it whole or nothing.
 */
async function migrateToV37(client: PoolClient, logger: StoreLogger): Promise<void> {
  const mergedKinds = [...MERGED_CHANNEL_KINDS];
  const audit = (
    await client.query<{ kind: string; resource_id: string }>(
      `SELECT kind, resource_id FROM resource_audit WHERE kind = ANY($1::text[]) ORDER BY kind, resource_id LIMIT 1`,
      [mergedKinds],
    )
  ).rows[0];
  if (audit !== undefined) {
    throw channelMergeAuditRowError(audit.kind, audit.resource_id);
  }
  const previous = (
    await client.query<{ kind: string; org: string; name: string }>(
      `SELECT kind, org, name FROM resource_names WHERE kind = ANY($1::text[]) AND state <> 'current' ORDER BY kind, org, name LIMIT 1`,
      [mergedKinds],
    )
  ).rows[0];
  if (previous !== undefined) {
    throw channelMergePreviousNameError(previous.kind, previous.org, previous.name);
  }
  const claimedAt = new Map<string, string>();
  for (const claim of (
    await client.query<{ id: string; claimed_at: string }>(
      `SELECT id, claimed_at FROM resource_names WHERE kind = ANY($1::text[])`,
      [mergedKinds],
    )
  ).rows) {
    claimedAt.set(claim.id, claim.claimed_at);
  }

  const forEachRow = async (
    kind: string,
    visit: (row: { id: string; data: Uint8Array }) => Promise<void> | void,
  ): Promise<void> => {
    for (let after = ""; ; ) {
      const rows = (
        await client.query<{ id: string; data: Buffer }>(
          `SELECT id, data FROM resources
           WHERE kind = $1 AND id > $2
           ORDER BY id
           LIMIT $3`,
          [kind, after, CHANNEL_MERGE_PAGE_SIZE],
        )
      ).rows;
      for (const row of rows) {
        await visit({ id: row.id, data: new Uint8Array(row.data) });
      }
      if (rows.length < CHANNEL_MERGE_PAGE_SIZE) {
        return;
      }
      after = rows[rows.length - 1]!.id;
    }
  };

  const converted: ConvertedChannel[] = [];
  for (const kind of MERGED_CHANNEL_KINDS) {
    await forEachRow(kind, (row) => {
      try {
        converted.push(convertToChannel(kind, row.id, row.data));
      } catch (error) {
        throw unreadableChannelMergeRowError(kind, row.id, error);
      }
    });
  }
  const changedSlugs = assignChannelSlugs(converted);
  const now = rfc3339Seconds(new Date());
  await client.query(`DELETE FROM resource_names WHERE kind = ANY($1::text[])`, [mergedKinds]);
  await client.query(`DELETE FROM resource_list_keys WHERE kind = ANY($1::text[])`, [mergedKinds]);
  for (const row of converted) {
    const slug = changedSlugs.get(row.id) ?? row.slug;
    await client.query(`DELETE FROM resources WHERE kind = $1 AND id = $2`, [row.fromKind, row.id]);
    await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`, [
      CHANNEL_KIND_AT_MERGE,
      row.id,
      Buffer.from(encodeChannel(row, slug)),
    ]);
    if (slug !== "") {
      await client.query(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, $3, $4, 'current', $5)`,
        [CHANNEL_KIND_AT_MERGE, row.org, slug, row.id, claimedAt.get(row.id) ?? now],
      );
    }
  }

  const rekeyed: Array<{ from: string; grant: RekeyedGrant }> = [];
  await forEachRow(CHANNEL_MERGE_GRANT_KIND, (row) => {
    try {
      const grant = rekeyedChannelGrant(row.data);
      if (grant !== undefined) {
        rekeyed.push({ from: row.id, grant });
      }
    } catch (error) {
      throw unreadableChannelMergeRowError(CHANNEL_MERGE_GRANT_KIND, row.id, error);
    }
  });
  for (const { from, grant } of rekeyed) {
    for (const table of ["resource_list_keys", "resources"]) {
      await client.query(`DELETE FROM ${table} WHERE kind = $1 AND id = $2`, [CHANNEL_MERGE_GRANT_KIND, from]);
    }
    await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`, [
      CHANNEL_MERGE_GRANT_KIND,
      grant.id,
      Buffer.from(grant.data),
    ]);
  }
  await rekeyGrantHistory(client, {
    table: "grant_history",
    idColumn: "grant_id",
    fromKinds: mergedKinds,
    toKind: CHANNEL_KIND_AT_MERGE,
    pageSize: CHANNEL_MERGE_PAGE_SIZE,
    rekey: rekeyedChannelGrant,
    unreadable: (entry, error) => unreadableChannelMergeRowError("grant_history", entry, error),
  });

  for (const kind of CHANNEL_MERGE_SESSION_KINDS) {
    await forEachRow(kind, async (row) => {
      let relabelled: Uint8Array | undefined;
      try {
        relabelled = relabelChannelSessionRow(kind, row.data);
      } catch (error) {
        throw unreadableChannelMergeRowError(kind, row.id, error);
      }
      if (relabelled !== undefined) {
        await client.query(`UPDATE resources SET data = $1, updated_at = now() WHERE kind = $2 AND id = $3`, [
          Buffer.from(relabelled),
          kind,
          row.id,
        ]);
      }
    });
  }
  logChannelMerge(logger, converted, changedSlugs);
}
