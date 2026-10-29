/**
 * The SQLite driver's schema chain, run at every open. v1 is the schema
 * 0.1.0 starts from; each later version is a new step, and a merged step
 * never changes (the store README's "Schema migrations" has the practice).
 * `schema.snapshot.sql` beside this file is what the chain leaves on a fresh
 * database, and `migrations.sum` holds each step's digest.
 *
 * The runner is the synchronous twin of the Postgres one
 * (sqlite/schema-chain.ts says how it differs).
 *
 * The tables are the Postgres chain's in SQLite's dialect: payloads are
 * BLOBs, instants TEXT, and a table keyed by its primary key alone is
 * WITHOUT ROWID. search_index is an
 * FTS5 table (fts5.ts renders its queries).
 */
import type { DatabaseSync } from "node:sqlite";

import type { StoreLogger } from "../logger.js";
import {
  currentSqliteSchemaVersion,
  runSqliteSchemaChain,
} from "./schema-chain.js";
import type { SqliteSchemaMigration } from "./schema-chain.js";

/** The chain. Exported so the sum test and the snapshot script read it without a database. */
export const SQLITE_MIGRATIONS: ReadonlyArray<SqliteSchemaMigration> = [
  {
    version: 1,
    statements: [
      // Resources: every kind's rows as proto bytes, keyed by kind and id,
      // with the list index's facts (list-index.ts) beside each declared row
      // and the partial index the open-time reconciliation reads.
      `CREATE TABLE resources (
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         data BLOB NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')),
         list_org TEXT,
         list_created_at TEXT,
         list_index_revision INTEGER,
         list_indexed_at TEXT,
         PRIMARY KEY (kind, id)
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_resources_list_created ON resources (kind, list_created_at, id)`,
      `CREATE INDEX idx_resources_list_org ON resources (kind, list_org, list_created_at, id)`,
      `CREATE INDEX idx_resources_list_revision ON resources (kind, list_index_revision)`,
      `CREATE INDEX idx_resources_list_unproven ON resources (kind, id) WHERE list_indexed_at IS NOT updated_at`,
      // A declared kind's list keys (a parent, a status), one row per key.
      `CREATE TABLE resource_list_keys (
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (kind, id, key)
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_resource_list_keys_lookup ON resource_list_keys (kind, key, value, created_at, id)`,
      // Every version of a resource a write replaced, addressed by its
      // content hash and its tag.
      `CREATE TABLE resource_audit (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         kind TEXT NOT NULL,
         resource_id TEXT NOT NULL,
         data BLOB NOT NULL,
         archived_at TEXT NOT NULL DEFAULT (datetime('now')),
         version_hash TEXT,
         tag TEXT
       )`,
      `CREATE INDEX idx_audit_hash ON resource_audit (kind, resource_id, version_hash)`,
      `CREATE INDEX idx_audit_resource ON resource_audit (kind, resource_id)`,
      `CREATE INDEX idx_audit_tag ON resource_audit (kind, resource_id, tag, archived_at DESC)`,
      // Search: one document per searchable resource.
      `CREATE VIRTUAL TABLE search_index USING fts5(
         kind,
         resource_id UNINDEXED,
         name,
         description,
         tags,
         org UNINDEXED,
         visibility UNINDEXED,
         created_at UNINDEXED,
         tokenize='porter unicode61'
       )`,
      // Bootstrap's own facts (the operator identity, seeded defaults).
      `CREATE TABLE bootstrap_state (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       ) WITHOUT ROWID`,

      // Names: each named kind's name claims within an organization, held
      // while a resource lives and for a while after it goes.
      `CREATE TABLE resource_names (
         kind TEXT NOT NULL,
         org TEXT NOT NULL,
         name TEXT NOT NULL,
         id TEXT NOT NULL,
         state TEXT NOT NULL,
         claimed_at TEXT NOT NULL,
         expires_at TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (kind, org, name)
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_resource_names_id ON resource_names (kind, org, id)`,
      // An organization's deletion, phase by phase, so a purge resumes.
      `CREATE TABLE organization_deletions (
         org TEXT NOT NULL PRIMARY KEY,
         phase TEXT NOT NULL,
         marked_at TEXT NOT NULL,
         accepted_at TEXT NOT NULL DEFAULT '',
         heartbeat_at TEXT NOT NULL DEFAULT '',
         stage TEXT NOT NULL DEFAULT '',
         last_error TEXT NOT NULL DEFAULT ''
       ) WITHOUT ROWID`,

      // Sign-in to MCP servers: an OAuth flow in progress, the clients
      // registered with each login server, and the connect links and
      // attempts that start a connection for someone else.
      `CREATE TABLE pending_oauth_state (
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
         created_at INTEGER NOT NULL
       )`,
      `CREATE TABLE oauth_client_registration (
         login_server TEXT NOT NULL,
         redirect_uri TEXT NOT NULL,
         client_id TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (login_server, redirect_uri)
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_oauth_client_registration_client ON oauth_client_registration (client_id)`,
      `CREATE TABLE connect_link (
         token_hash TEXT PRIMARY KEY,
         org TEXT NOT NULL,
         vault_id TEXT NOT NULL,
         address TEXT NOT NULL,
         return_url TEXT NOT NULL,
         created_by TEXT NOT NULL,
         created_by_class TEXT NOT NULL,
         created_by_bound_org TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL,
         used_at INTEGER NOT NULL DEFAULT 0
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_connect_link_expires ON connect_link (expires_at)`,
      `CREATE INDEX idx_connect_link_org ON connect_link (org)`,
      `CREATE INDEX idx_connect_link_vault ON connect_link (vault_id)`,
      `CREATE TABLE connect_attempt (
         id TEXT PRIMARY KEY,
         org TEXT NOT NULL,
         created_by TEXT NOT NULL,
         person TEXT NOT NULL DEFAULT '',
         plugin_id TEXT NOT NULL,
         server TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_connect_attempt_expires ON connect_attempt (expires_at)`,
      `CREATE INDEX idx_connect_attempt_org ON connect_attempt (org)`,

      // Sessions: each session's ordered event log with each event's gates
      // (session-events.ts), the head that numbers the next event, and the
      // messages queued while a turn runs.
      `CREATE TABLE session_events (
         session_id TEXT NOT NULL,
         seq INTEGER NOT NULL,
         event_id TEXT NOT NULL,
         run_id TEXT NOT NULL DEFAULT '',
         thread_id TEXT NOT NULL DEFAULT '',
         type TEXT NOT NULL,
         org TEXT NOT NULL DEFAULT '',
         processed_at TEXT NOT NULL,
         data BLOB NOT NULL,
         opens_gate TEXT NOT NULL DEFAULT '',
         closes_gate TEXT NOT NULL DEFAULT '',
         gate_revision INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (session_id, seq)
       )`,
      `CREATE INDEX idx_session_events_closes_gate ON session_events (session_id, closes_gate) WHERE closes_gate <> ''`,
      `CREATE UNIQUE INDEX idx_session_events_event_id ON session_events (session_id, event_id)`,
      `CREATE INDEX idx_session_events_gate_revision ON session_events (gate_revision)`,
      `CREATE INDEX idx_session_events_opens_gate ON session_events (session_id, opens_gate) WHERE opens_gate <> ''`,
      `CREATE INDEX idx_session_events_org ON session_events (org)`,
      `CREATE INDEX idx_session_events_org_type ON session_events (org, type, processed_at, event_id)`,
      `CREATE INDEX idx_session_events_run ON session_events (session_id, run_id, seq)`,
      `CREATE INDEX idx_session_events_type ON session_events (session_id, type, seq)`,
      `CREATE TABLE session_event_heads (
         session_id TEXT PRIMARY KEY,
         org TEXT NOT NULL DEFAULT '',
         last_seq INTEGER NOT NULL,
         last_processed_at TEXT NOT NULL
       )`,
      `CREATE INDEX idx_session_event_heads_org ON session_event_heads (org)`,
      `CREATE TABLE session_queued_messages (
         session_id TEXT NOT NULL,
         event_id TEXT NOT NULL,
         org TEXT NOT NULL DEFAULT '',
         sender TEXT NOT NULL DEFAULT '',
         turn BLOB NOT NULL,
         lane BLOB NOT NULL DEFAULT x'',
         PRIMARY KEY (session_id, event_id)
       )`,
      `CREATE INDEX idx_session_queued_messages_org ON session_queued_messages (org)`,

      // Grants: every grant and revoke per organization, numbered by its
      // head (permission-history.ts), and each routine's fires.
      `CREATE TABLE grant_history (
         org TEXT NOT NULL,
         sequence INTEGER NOT NULL,
         occurred_at TEXT NOT NULL,
         change TEXT NOT NULL CHECK (change IN ('granted', 'revoked')),
         cause TEXT NOT NULL CHECK (cause <> ''),
         actor_id TEXT NOT NULL,
         actor_class TEXT NOT NULL,
         grant_id TEXT NOT NULL,
         principal_kind TEXT NOT NULL,
         principal_id TEXT NOT NULL,
         principal_relation TEXT NOT NULL DEFAULT '',
         relation TEXT NOT NULL,
         resource_kind TEXT NOT NULL,
         resource_id TEXT NOT NULL,
         data BLOB NOT NULL,
         PRIMARY KEY (org, sequence)
       )`,
      `CREATE INDEX grant_history_by_time ON grant_history (occurred_at, org, sequence)`,
      `CREATE TABLE grant_history_heads (
         org TEXT PRIMARY KEY,
         last_sequence INTEGER NOT NULL,
         last_occurred_at TEXT NOT NULL
       )`,
      `CREATE TABLE routine_fires (
         routine_id TEXT NOT NULL,
         fire_id TEXT NOT NULL,
         org TEXT NOT NULL DEFAULT '',
         nominal_fire_time TEXT NOT NULL,
         origin TEXT NOT NULL,
         outcome TEXT NOT NULL,
         reason TEXT NOT NULL DEFAULT '',
         run_id TEXT NOT NULL DEFAULT '',
         fired_by BLOB,
         recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
         completed_at TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (routine_id, fire_id)
       )`,
      `CREATE INDEX idx_routine_fires_order ON routine_fires (routine_id, nominal_fire_time, fire_id)`,
      `CREATE INDEX idx_routine_fires_recency ON routine_fires (routine_id, recorded_at DESC)`,

      // Files: each stored blob once, by content key, and every file that
      // refers to it; a blob goes when its last reference does.
      `CREATE TABLE file_blobs (
         blob_key TEXT PRIMARY KEY,
         org TEXT NOT NULL,
         state TEXT NOT NULL,
         size_bytes INTEGER NOT NULL DEFAULT 0,
         expires_at INTEGER NOT NULL DEFAULT 0
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_file_blobs_org ON file_blobs (org, blob_key)`,
      `CREATE INDEX idx_file_blobs_sweep ON file_blobs (state, expires_at)`,
      `CREATE TABLE file_blob_refs (
         file_id TEXT PRIMARY KEY,
         blob_key TEXT NOT NULL,
         org TEXT NOT NULL
       ) WITHOUT ROWID`,
      `CREATE INDEX idx_file_blob_refs_blob ON file_blob_refs (blob_key)`,
      `CREATE INDEX idx_file_blob_refs_org ON file_blob_refs (org)`,
    ],
  },
];

/** The newest version this build knows. */
export const CURRENT_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;

/** How far {@link runMigrations} goes. */
export interface MigrationOptions {
  /** The last version to apply; every version when absent. Only a test passes it. */
  readonly through?: number | undefined;
  readonly logger?: StoreLogger | undefined;
}

/** Brings the database up to the chain's newest version (or `through`). */
export function runMigrations(
  db: DatabaseSync,
  options: MigrationOptions = {},
): void {
  runSqliteSchemaChain(db, {
    migrations: SQLITE_MIGRATIONS,
    through: options.through,
    logger: options.logger,
  });
}

/** Current schema version; 0 when none has been recorded yet. */
export function getSchemaVersion(db: DatabaseSync): number {
  return currentSqliteSchemaVersion(db);
}
