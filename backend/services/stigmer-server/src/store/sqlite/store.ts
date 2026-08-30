/**
 * node:sqlite driver — ports backend/libs/go/store/sqlite/store.go
 * method-for-method (D2 §3): same database file, same pragmas, same
 * physical layout (kind = the enum's proto name, data = the marshaled
 * protobuf bytes), same full-scan semantics. Physical indexing is
 * deliberately NOT added in phase 1 (D2 §3, rejected: couples behavior-port
 * risk to storage-redesign risk); the interface's named methods guarantee
 * indexability for the phase-2 Postgres driver.
 *
 * Write serialization: Go used a process-wide mutex around a pooled
 * connection. node:sqlite is synchronous on a single connection, which
 * gives the same serialization for free (D2 §3) — the accepted trade-off
 * is that a large full-scan read blocks the event loop momentarily, fine
 * at laptop scale where Go ships the same scans. updateResource
 * additionally wraps its read-modify-write in BEGIN IMMEDIATE (D2 §2):
 * unlike the in-process mutex, the transaction also excludes OTHER
 * processes sharing the database file.
 *
 * Multi-statement operations (setAuditTag, upsertSearchIndex,
 * appendWorkflowExecutionEvents, pendingOAuthStates.getAndDelete) run in
 * explicit transactions exactly where Go used one. All code between BEGIN
 * and COMMIT is synchronous — nothing can interleave into an open
 * transaction on the sole connection.
 *
 * Proven by __tests__/ (migrations incl. the DD-002 Go-database fixture,
 * per-method contracts, the permanent SP-C FTS5 probe) and end-to-end by
 * the conformance suites on local.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  AuditNotFoundError,
  DELIVERED_SIGNAL_DEDUPE_TTL_MS,
  PENDING_OAUTH_STATE_TTL_MS,
  ResourceNotFoundError,
} from "../interface.js";
import type {
  AuditRecord,
  BootstrapStateStore,
  ClaimResult,
  OAuthGrant,
  OAuthGrantStore,
  PendingOAuthState,
  PendingOAuthStateStore,
  ScheduleRunRecord,
  SearchIndexEntry,
  SearchIndexHit,
  SearchIndexQuery,
  SearchIndexQueryResult,
  SignalDedupeRecord,
  SignalDedupeStatus,
  SignalDedupeStore,
  Store,
  WorkflowExecutionEventRecord,
} from "../interface.js";
import { NOOP_STORE_LOGGER } from "../logger.js";
import type { StoreLogger } from "../logger.js";
import {
  apiResourceKindName,
  filterRowsByLabel,
  scanForFieldMatch,
} from "../proto-fields.js";
import { rfc3339Seconds } from "../rfc3339.js";
import { normalizeBm25Score, renderFts5MatchExpression } from "./fts5.js";
import { runMigrations } from "./migrations.js";

// The logging seam lived here through Phase 1; re-exported after its
// promotion to ../logger.ts (second consumer: the Postgres driver) so the
// import path stays stable for existing consumers.
export type { StoreLogger } from "../logger.js";

export class SqliteStore implements Store {
  readonly bootstrapState: BootstrapStateStore;
  readonly signalDedupe: SignalDedupeStore;
  readonly oauthGrants: OAuthGrantStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;

  private db: DatabaseSync | undefined;
  private readonly dbPath: string;
  private readonly logger: StoreLogger;

  private constructor(db: DatabaseSync, dbPath: string, logger: StoreLogger) {
    this.db = db;
    this.dbPath = dbPath;
    this.logger = logger;
    this.bootstrapState = new SqliteBootstrapStateStore(() => this.open());
    this.signalDedupe = new SqliteSignalDedupeStore(() => this.open(), logger);
    this.oauthGrants = new SqliteOAuthGrantStore(() => this.open());
    this.pendingOAuthStates = new SqlitePendingOAuthStateStore(() =>
      this.open(),
    );
  }

  /**
   * Opens (or creates) the database at dbPath, applies the pragmas in Go's
   * order, and runs migrations — Go NewStore.
   */
  static open(
    dbPath: string,
    logger: StoreLogger = NOOP_STORE_LOGGER,
  ): SqliteStore {
    const dir = path.dirname(dbPath);
    if (dir !== "" && dir !== ".") {
      mkdirSync(dir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);

    // Pragma order is contract (Go store.go:82-99, journal_mode first).
    db.exec("PRAGMA journal_mode=WAL"); // Write-Ahead Logging for concurrent reads
    db.exec("PRAGMA synchronous=NORMAL"); // Balance between durability and speed
    db.exec("PRAGMA busy_timeout=5000"); // Wait up to 5s for locks
    db.exec("PRAGMA cache_size=-64000"); // 64MB page cache
    db.exec("PRAGMA foreign_keys=ON"); // Parity with Go (no FK is actually declared today)
    db.exec("PRAGMA temp_store=MEMORY"); // Keep temp tables in memory

    try {
      runMigrations(db);
    } catch (error) {
      db.close();
      throw error;
    }

    return new SqliteStore(db, dbPath, logger);
  }

  /** Filesystem path of the database file (Go Store.Path()). */
  path(): string {
    return this.dbPath;
  }

  // ---------------------------------------------------------------------------
  // Resource operations
  // ---------------------------------------------------------------------------

  async saveResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
    msg: MessageShape<Desc>,
  ): Promise<void> {
    const db = this.open();
    const data = toBinary(schema, msg);
    db.prepare(
      `INSERT OR REPLACE INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
    ).run(apiResourceKindName(kind), id, data);
  }

  async getResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    const row = db
      .prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`)
      .get(kindName, id) as { data: Uint8Array } | undefined;
    if (row === undefined) {
      throw new ResourceNotFoundError(`${kindName}/${id}`);
    }
    return fromBinary(schema, row.data);
  }

  async updateResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
    modify: (msg: MessageShape<Desc>) => void,
  ): Promise<MessageShape<Desc>> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);

    // BEGIN IMMEDIATE takes the write lock up front (D2 §2), so the
    // read-modify-write also excludes other PROCESSES on the same file —
    // strictly stronger than Go's in-process mutex. `modify` is synchronous
    // by contract (interface.ts): nothing can interleave into the open
    // transaction on this sole connection.
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`)
        .get(kindName, id) as { data: Uint8Array } | undefined;
      if (row === undefined) {
        throw new ResourceNotFoundError(`${kindName}/${id}`);
      }

      const msg = fromBinary(schema, row.data);
      modify(msg);

      const data = toBinary(schema, msg);
      db.prepare(
        `INSERT OR REPLACE INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
      ).run(kindName, id, data);

      db.exec("COMMIT");
      return msg;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async listResources(kind: ApiResourceKind): Promise<Uint8Array[]> {
    const db = this.open();
    const rows = db
      .prepare(`SELECT data FROM resources WHERE kind = ?`)
      .all(apiResourceKindName(kind)) as Array<{ data: Uint8Array }>;
    // node:sqlite materializes a fresh Uint8Array per row — no buffer-reuse
    // copy is needed (Go copied because database/sql may reuse buffers).
    return rows.map((row) => row.data);
  }

  async deleteResource(kind: ApiResourceKind, id: string): Promise<void> {
    const db = this.open();
    db.prepare(`DELETE FROM resources WHERE kind = ? AND id = ?`).run(
      apiResourceKindName(kind),
      id,
    );
  }

  async findByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    const rows = db
      .prepare(`SELECT data FROM resources WHERE kind = ?`)
      .all(kindName) as Array<{ data: Uint8Array }>;

    const match = scanForFieldMatch(
      rows.map((row) => row.data),
      schema,
      fieldPath,
      value,
    );
    if (match === undefined) {
      throw new ResourceNotFoundError(
        `${kindName} where ${fieldPath}=${value}`,
      );
    }
    return match;
  }

  async findAllByField(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
  ): Promise<Uint8Array[]> {
    // Go-parity quirk preserved (sub-project DD-001): returns ALL rows of
    // the kind, unfiltered — see the interface doc. The parameters are kept
    // so the signature stays surface-identical to Go's.
    void fieldPath;
    void value;
    return this.listResources(kind);
  }

  async findAllByLabel<Desc extends DescMessage>(
    kind: ApiResourceKind,
    labelKey: string,
    labelValue: string,
    schema: Desc,
  ): Promise<Uint8Array[]> {
    const db = this.open();
    const rows = db
      .prepare(`SELECT data FROM resources WHERE kind = ?`)
      .all(apiResourceKindName(kind)) as Array<{ data: Uint8Array }>;

    return filterRowsByLabel(
      rows.map((row) => row.data),
      schema,
      labelKey,
      labelValue,
    );
  }

  async deleteResourcesByKind(kind: ApiResourceKind): Promise<number> {
    const db = this.open();
    const result = db
      .prepare(`DELETE FROM resources WHERE kind = ?`)
      .run(apiResourceKindName(kind));
    return Number(result.changes);
  }

  async deleteResourcesByIdPrefix(
    kind: ApiResourceKind,
    idPrefix: string,
  ): Promise<number> {
    const db = this.open();
    // GLOB 'prefix*' uses the (kind, id) index where LIKE would not (Go).
    const result = db
      .prepare(`DELETE FROM resources WHERE kind = ? AND id GLOB ?`)
      .run(apiResourceKindName(kind), `${idPrefix}*`);
    return Number(result.changes);
  }

  // ---------------------------------------------------------------------------
  // Audit operations
  // ---------------------------------------------------------------------------

  async saveAudit<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    schema: Desc,
    msg: MessageShape<Desc>,
    versionHash: string,
    tag: string,
  ): Promise<void> {
    const db = this.open();
    const data = toBinary(schema, msg);
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).run(apiResourceKindName(kind), resourceId, data, versionHash, tag);
  }

  async getAuditByHash<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const record = await this.getAuditRecordByHash(
      kind,
      resourceId,
      versionHash,
    );
    return fromBinary(schema, record.data);
  }

  async getAuditByTag<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    tag: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const record = await this.getAuditRecordByTag(kind, resourceId, tag);
    return fromBinary(schema, record.data);
  }

  async listAuditHistory(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<Uint8Array[]> {
    const records = await this.listAuditRecords(kind, resourceId);
    return records.map((record) => record.data);
  }

  async deleteAuditByResourceId(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<number> {
    const db = this.open();
    const result = db
      .prepare(`DELETE FROM resource_audit WHERE kind = ? AND resource_id = ?`)
      .run(apiResourceKindName(kind), resourceId);
    return Number(result.changes);
  }

  async countAuditEntries(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<number> {
    const db = this.open();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM resource_audit WHERE kind = ? AND resource_id = ?`,
      )
      .get(apiResourceKindName(kind), resourceId) as { count: number };
    return row.count;
  }

  async getLatestAuditHash(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<string> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    // id DESC breaks archived_at ties from sub-second inserts (Go).
    const row = db
      .prepare(
        `SELECT version_hash FROM resource_audit
         WHERE kind = ? AND resource_id = ?
         ORDER BY archived_at DESC, id DESC
         LIMIT 1`,
      )
      .get(kindName, resourceId) as { version_hash: string | null } | undefined;
    if (row === undefined) {
      throw new AuditNotFoundError(`${kindName}/${resourceId}`);
    }
    return row.version_hash ?? "";
  }

  async setAuditTag(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
    tag: string,
  ): Promise<void> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);

    // Single transaction: clear the prior holder, assign the target. A
    // missing target rolls back, leaving the prior holder untouched — the
    // #341 head-repoint contract.
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE resource_audit SET tag = ''
         WHERE kind = ? AND resource_id = ? AND tag = ?`,
      ).run(kindName, resourceId, tag);

      const result = db
        .prepare(
          `UPDATE resource_audit SET tag = ?
           WHERE kind = ? AND resource_id = ? AND version_hash = ?`,
        )
        .run(tag, kindName, resourceId, versionHash);

      if (Number(result.changes) === 0) {
        throw new AuditNotFoundError(
          `${kindName}/${resourceId} (hash=${versionHash})`,
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async listAuditRecords(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<AuditRecord[]> {
    const db = this.open();
    const rows = db
      .prepare(
        `SELECT data, version_hash, tag FROM resource_audit
         WHERE kind = ? AND resource_id = ?
         ORDER BY archived_at DESC, id DESC`,
      )
      .all(apiResourceKindName(kind), resourceId) as Array<{
      data: Uint8Array;
      version_hash: string | null;
      tag: string | null;
    }>;
    return rows.map((row) => ({
      data: row.data,
      versionHash: row.version_hash ?? "",
      tag: row.tag ?? "",
    }));
  }

  async getAuditRecordByHash(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
  ): Promise<AuditRecord> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    // Duplicates for one hash are legal — newest wins (stigmer-cloud#191).
    const row = db
      .prepare(
        `SELECT data, tag FROM resource_audit
         WHERE kind = ? AND resource_id = ? AND version_hash = ?
         ORDER BY archived_at DESC, id DESC
         LIMIT 1`,
      )
      .get(kindName, resourceId, versionHash) as
      | { data: Uint8Array; tag: string | null }
      | undefined;
    if (row === undefined) {
      throw new AuditNotFoundError(
        `${kindName}/${resourceId} (hash=${versionHash})`,
      );
    }
    return { data: row.data, versionHash, tag: row.tag ?? "" };
  }

  async getAuditRecordByTag(
    kind: ApiResourceKind,
    resourceId: string,
    tag: string,
  ): Promise<AuditRecord> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    const row = db
      .prepare(
        `SELECT data, version_hash FROM resource_audit
         WHERE kind = ? AND resource_id = ? AND tag = ?
         ORDER BY archived_at DESC, id DESC
         LIMIT 1`,
      )
      .get(kindName, resourceId, tag) as
      | { data: Uint8Array; version_hash: string | null }
      | undefined;
    if (row === undefined) {
      throw new AuditNotFoundError(`${kindName}/${resourceId} (tag=${tag})`);
    }
    return { data: row.data, versionHash: row.version_hash ?? "", tag };
  }

  // ---------------------------------------------------------------------------
  // Workflow execution events
  // ---------------------------------------------------------------------------

  async appendWorkflowExecutionEvents(
    executionId: string,
    events: readonly WorkflowExecutionEventRecord[],
  ): Promise<number> {
    if (events.length === 0) {
      return 0;
    }
    const db = this.open();

    db.exec("BEGIN");
    try {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO workflow_execution_events (execution_id, sequence_number, event_type, task_name, data)
         VALUES (?, ?, ?, ?, ?)`,
      );
      let inserted = 0;
      for (const event of events) {
        const result = insert.run(
          executionId,
          event.sequenceNumber,
          event.eventType,
          event.taskName,
          event.data,
        );
        inserted += Number(result.changes);
      }
      db.exec("COMMIT");
      return inserted;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async getWorkflowExecutionEvents(
    executionId: string,
    afterSequence: number,
    eventType: string,
    taskName: string,
    limit: number,
  ): Promise<WorkflowExecutionEventRecord[]> {
    const db = this.open();
    const effectiveLimit = limit <= 0 ? 100 : limit;

    let query = `SELECT execution_id, sequence_number, event_type, task_name, data, created_at
      FROM workflow_execution_events
      WHERE execution_id = ? AND sequence_number > ?`;
    const args: Array<string | number> = [executionId, afterSequence];
    if (eventType !== "") {
      query += ` AND event_type = ?`;
      args.push(eventType);
    }
    if (taskName !== "") {
      query += ` AND task_name = ?`;
      args.push(taskName);
    }
    query += ` ORDER BY sequence_number ASC LIMIT ?`;
    args.push(effectiveLimit);

    const rows = db.prepare(query).all(...args) as Array<{
      execution_id: string;
      sequence_number: number;
      event_type: string;
      task_name: string;
      data: Uint8Array;
      created_at: string;
    }>;
    return rows.map((row) => ({
      executionId: row.execution_id,
      sequenceNumber: row.sequence_number,
      eventType: row.event_type,
      taskName: row.task_name,
      data: row.data,
      createdAt: row.created_at,
    }));
  }

  async getMaxEventSequence(executionId: string): Promise<number> {
    const db = this.open();
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(sequence_number), 0) AS max_seq FROM workflow_execution_events WHERE execution_id = ?`,
      )
      .get(executionId) as { max_seq: number };
    return row.max_seq;
  }

  // ---------------------------------------------------------------------------
  // Schedule runs (fire ledger)
  // ---------------------------------------------------------------------------

  async upsertScheduleRun(record: ScheduleRunRecord): Promise<void> {
    const db = this.open();
    // Default recorded_at is RFC-3339 whole seconds (Go time.RFC3339) —
    // the ledger's house convention for lexicographic comparison.
    const recordedAt =
      record.recordedAt !== "" ? record.recordedAt : rfc3339Seconds(new Date());

    // The ON CONFLICT WHERE guard is the terminal-immutability contract:
    // rows with a completed_at never get downgraded by a replayed write.
    db.prepare(
      `INSERT INTO schedule_runs
        (schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (schedule_id, nominal_fire_time, origin) DO UPDATE SET
        outcome = excluded.outcome,
        reason = excluded.reason,
        execution_id = excluded.execution_id,
        completed_at = excluded.completed_at
      WHERE schedule_runs.completed_at = ''`,
    ).run(
      record.scheduleId,
      record.org,
      record.nominalFireTime,
      record.origin,
      record.outcome,
      record.reason,
      record.executionId,
      recordedAt,
      record.completedAt,
    );
  }

  async markLatestScheduleRunTerminal(
    scheduleId: string,
    origin: string,
    outcome: string,
    reason: string,
    completedAt: string,
  ): Promise<void> {
    const db = this.open();
    db.prepare(
      `UPDATE schedule_runs SET outcome = ?, reason = ?, completed_at = ?
       WHERE schedule_id = ? AND origin = ? AND completed_at = ''
       AND nominal_fire_time = (
         SELECT MAX(nominal_fire_time) FROM schedule_runs
         WHERE schedule_id = ? AND origin = ? AND completed_at = ''
       )`,
    ).run(outcome, reason, completedAt, scheduleId, origin, scheduleId, origin);
  }

  async listScheduleRuns(
    scheduleId: string,
    offset: number,
    limit: number,
  ): Promise<{ runs: ScheduleRunRecord[]; total: number }> {
    const db = this.open();
    const effectiveLimit = limit <= 0 ? 50 : limit;
    const effectiveOffset = offset < 0 ? 0 : offset;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM schedule_runs WHERE schedule_id = ?`,
      )
      .get(scheduleId) as { total: number };

    const rows = db
      .prepare(
        `SELECT schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at
         FROM schedule_runs
         WHERE schedule_id = ?
         ORDER BY nominal_fire_time DESC, origin DESC
         LIMIT ? OFFSET ?`,
      )
      .all(scheduleId, effectiveLimit, effectiveOffset) as Array<{
      schedule_id: string;
      org: string;
      nominal_fire_time: string;
      origin: string;
      outcome: string;
      reason: string;
      execution_id: string;
      recorded_at: string;
      completed_at: string;
    }>;

    return {
      total: totalRow.total,
      runs: rows.map((row) => ({
        scheduleId: row.schedule_id,
        org: row.org,
        nominalFireTime: row.nominal_fire_time,
        origin: row.origin,
        outcome: row.outcome,
        reason: row.reason,
        executionId: row.execution_id,
        recordedAt: row.recorded_at,
        completedAt: row.completed_at,
      })),
    };
  }

  async deleteScheduleRunsBySchedule(scheduleId: string): Promise<number> {
    const db = this.open();
    const result = db
      .prepare(`DELETE FROM schedule_runs WHERE schedule_id = ?`)
      .run(scheduleId);
    return Number(result.changes);
  }

  async pruneScheduleRuns(recordedBefore: string): Promise<number> {
    const db = this.open();
    const result = db
      .prepare(`DELETE FROM schedule_runs WHERE recorded_at < ?`)
      .run(recordedBefore);
    return Number(result.changes);
  }

  // ---------------------------------------------------------------------------
  // Search index (FTS5)
  // ---------------------------------------------------------------------------

  async upsertSearchIndex(
    kind: ApiResourceKind,
    resourceId: string,
    entry: SearchIndexEntry,
  ): Promise<void> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);

    // FTS5 has no UPDATE — DELETE + INSERT in one transaction (Go).
    db.exec("BEGIN");
    try {
      db.prepare(
        `DELETE FROM search_index WHERE kind = ? AND resource_id = ?`,
      ).run(kindName, resourceId);
      db.prepare(
        `INSERT INTO search_index (kind, resource_id, name, description, tags, org, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        kindName,
        resourceId,
        entry.name,
        entry.description,
        entry.tags,
        entry.org,
        entry.visibility,
        entry.createdAt,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteSearchIndex(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<void> {
    const db = this.open();
    db.prepare(
      `DELETE FROM search_index WHERE kind = ? AND resource_id = ?`,
    ).run(apiResourceKindName(kind), resourceId);
  }

  async querySearchIndex(
    query: SearchIndexQuery,
  ): Promise<SearchIndexQueryResult> {
    const db = this.open();

    const kindPlaceholders = query.kinds.map(() => "?").join(",");
    const kindArgs = [...query.kinds];

    // The scope-filter fragments, byte-identical to Go's buildScopeFilter:
    // org (strict or public-widened) and the independent public subtraction.
    const scopeClauses: string[] = [];
    const scopeArgs: string[] = [];
    if (query.orgFilter !== "") {
      scopeClauses.push(
        query.crossOrgPublic
          ? `AND (org = ? OR visibility = 'visibility_public')`
          : `AND org = ?`,
      );
      scopeArgs.push(query.orgFilter);
    }
    if (query.excludePublic) {
      scopeClauses.push(`AND visibility != 'visibility_public'`);
    }
    if (query.authorizedIdsByKind !== undefined) {
      // The 20260830.01 scoping arm: per-kind resource_id allowlists.
      // An empty set contributes NO clause — that kind matches nothing —
      // and all-kinds-empty renders a constant-false predicate (never an
      // `IN ()` accident, per the interface contract).
      const kindClauses: string[] = [];
      for (const kind of query.kinds) {
        const ids = query.authorizedIdsByKind.get(kind);
        if (ids === undefined) {
          kindClauses.push(`kind = ?`);
          scopeArgs.push(kind);
        } else if (ids.size > 0) {
          const idPlaceholders = [...ids].map(() => "?").join(",");
          kindClauses.push(`(kind = ? AND resource_id IN (${idPlaceholders}))`);
          scopeArgs.push(kind, ...ids);
        }
      }
      scopeClauses.push(
        kindClauses.length === 0 ? `AND 1 = 0` : `AND (${kindClauses.join(" OR ")})`,
      );
    }
    const scopeSql = scopeClauses.join("\n        ");

    // Search mode is "terms present", even when they sanitize to an empty
    // MATCH expression — FTS5's rejection of that expression is the
    // preserved behavior for such queries (see fts5.ts).
    const searchMode = query.terms !== undefined;
    const matchClause = searchMode ? `search_index MATCH ? AND ` : "";
    const matchArgs =
      query.terms !== undefined ? [renderFts5MatchExpression(query.terms)] : [];

    // Statement 1 — full counts per kind (Go's count query; zero-count
    // kinds never appear: the counts come from GROUP BY over matches).
    const countRows = db
      .prepare(
        `SELECT kind, COUNT(*) as cnt
         FROM search_index
         WHERE ${matchClause}kind IN (${kindPlaceholders})
         ${scopeSql}
         GROUP BY kind`,
      )
      .all(...matchArgs, ...kindArgs, ...scopeArgs) as Array<{
      kind: string;
      cnt: number;
    }>;

    const countsByKind: Record<string, number> = {};
    let totalCount = 0;
    for (const row of countRows) {
      countsByKind[row.kind] = row.cnt;
      totalCount += row.cnt;
    }

    // Go short-circuits to EmptyResult before the page statement.
    if (totalCount === 0) {
      return { countsByKind: {}, totalCount: 0, hits: [] };
    }

    // Statement 2 — the ranked page. Search mode: bm25 with the pinned
    // weight vector (kind=1, resource_id=0, name=10, description=5,
    // tags=5), ascending rank (bm25 is negative, lower = better). List
    // mode: rank pinned 1.0, newest first.
    const pageSql = searchMode
      ? `SELECT kind, resource_id, bm25(search_index, 1.0, 0, 10.0, 5.0, 5.0) as rank
         FROM search_index
         WHERE search_index MATCH ? AND kind IN (${kindPlaceholders})
         ${scopeSql}
         ORDER BY rank
         LIMIT ? OFFSET ?`
      : `SELECT kind, resource_id, 1.0 as rank
         FROM search_index
         WHERE kind IN (${kindPlaceholders})
         ${scopeSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`;

    const pageRows = db
      .prepare(pageSql)
      .all(
        ...matchArgs,
        ...kindArgs,
        ...scopeArgs,
        query.limit,
        query.offset,
      ) as Array<{ kind: string; resource_id: string; rank: number }>;

    // The interface promises wire-ready scores (DD-001): normalize bm25
    // here; list mode's pinned 1.0 maps to exactly 1.0 through the same
    // function.
    const hits: SearchIndexHit[] = pageRows.map((row) => ({
      kind: row.kind,
      resourceId: row.resource_id,
      score: normalizeBm25Score(row.rank),
    }));

    return { countsByKind, totalCount, hits };
  }

  async clearSearchIndex(): Promise<void> {
    const db = this.open();
    db.exec("DELETE FROM search_index");
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.db === undefined) {
      return; // already closed
    }
    const db = this.db;
    this.db = undefined;
    db.close();
  }

  /** Live connection or the Go-parity "store is closed" error. */
  private open(): DatabaseSync {
    if (this.db === undefined) {
      throw new Error("store is closed");
    }
    return this.db;
  }
}

// =============================================================================
// Bootstrap state (Go concrete-type methods, store.go:1480-1611)
// =============================================================================

class SqliteBootstrapStateStore implements BootstrapStateStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async get(key: string): Promise<string> {
    const row = this.open()
      .prepare(`SELECT value FROM bootstrap_state WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    // Missing key → "" and NOT an error — Go's contract.
    return row?.value ?? "";
  }

  async set(key: string, value: string): Promise<void> {
    this.open()
      .prepare(
        `INSERT OR REPLACE INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      )
      .run(key, value);
  }

  async getAll(): Promise<Map<string, string>> {
    const rows = this.open()
      .prepare(`SELECT key, value FROM bootstrap_state`)
      .all() as Array<{ key: string; value: string }>;
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  async delete(key: string): Promise<void> {
    this.open().prepare(`DELETE FROM bootstrap_state WHERE key = ?`).run(key);
  }

  async clear(): Promise<void> {
    this.open().exec(`DELETE FROM bootstrap_state`);
  }
}

// =============================================================================
// Signal dedupe (Go pkg/domain/workflowexecution/dedupe, Gap B2 / oss#442)
// =============================================================================

class SqliteSignalDedupeStore implements SignalDedupeStore {
  constructor(
    private readonly open: () => DatabaseSync,
    private readonly logger: StoreLogger,
  ) {}

  async claim(
    org: string,
    idempotencyKey: string,
    executionId: string,
    signalName: string,
    ttlMs: number,
  ): Promise<ClaimResult> {
    const db = this.open();
    const id = buildDedupeKey(org, idempotencyKey);
    const now = new Date();
    // ISO-8601 with milliseconds; Go writes RFC3339Nano. Both compare
    // correctly through the shared second+fraction prefix — the formats
    // only diverge sub-millisecond, below the TTLs' resolution.
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    // Expired rows are cleaned before claiming so keys become reusable —
    // failure is non-critical (warn and continue), as in Go.
    try {
      this.cleanupExpired(db, now);
    } catch (error) {
      this.logger.warn("failed to cleanup expired dedupe records", {
        error: String(error),
      });
    }

    try {
      db.prepare(
        `INSERT INTO signal_dedupe (id, org, idempotency_key, execution_id, signal_name, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?, ?)`,
      ).run(
        id,
        org,
        idempotencyKey,
        executionId,
        signalName,
        createdAt,
        expiresAt,
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const record = this.loadRecord(db, id);
      if (record === undefined) {
        // The holder vanished between INSERT and SELECT — surface as a
        // claim failure rather than fabricating a record.
        throw new Error(`load existing record: ${id} disappeared`);
      }
      return { status: "DUPLICATE", record };
    }

    return { status: "SUCCESS" };
  }

  async markDelivered(org: string, idempotencyKey: string): Promise<void> {
    const db = this.open();
    const id = buildDedupeKey(org, idempotencyKey);
    const now = new Date();

    // Extending expires_at here is the load-bearing half of the two-phase
    // hold: delivery earns DELIVERED_SIGNAL_DEDUPE_TTL_MS. The status guard
    // makes re-marking a no-op and keeps a takeover's fresh claim intact.
    const result = db
      .prepare(
        `UPDATE signal_dedupe
         SET status = 'DELIVERED', delivered_at = ?, expires_at = ?
         WHERE id = ? AND status = 'CLAIMED'`,
      )
      .run(
        now.toISOString(),
        new Date(now.getTime() + DELIVERED_SIGNAL_DEDUPE_TTL_MS).toISOString(),
        id,
      );

    if (Number(result.changes) === 0) {
      this.logger.warn(
        "no dedupe record updated - may be already delivered or doesn't exist",
        { id },
      );
    }
  }

  async release(org: string, idempotencyKey: string): Promise<void> {
    const db = this.open();
    const id = buildDedupeKey(org, idempotencyKey);

    // Status-guarded DELETE: only an in-flight claim can be freed, so a
    // release racing markDelivered can never unblock a delivered key.
    db.prepare(
      `DELETE FROM signal_dedupe WHERE id = ? AND status = 'CLAIMED'`,
    ).run(id);
  }

  private loadRecord(
    db: DatabaseSync,
    id: string,
  ): SignalDedupeRecord | undefined {
    const row = db
      .prepare(
        `SELECT id, org, idempotency_key, execution_id, signal_name, status, created_at, delivered_at, expires_at
         FROM signal_dedupe WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          org: string;
          idempotency_key: string;
          execution_id: string;
          signal_name: string;
          status: string;
          created_at: string;
          delivered_at: string | null;
          expires_at: string;
        }
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      org: row.org,
      idempotencyKey: row.idempotency_key,
      executionId: row.execution_id,
      signalName: row.signal_name,
      status: row.status as SignalDedupeStatus,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at ?? "",
      expiresAt: row.expires_at,
    };
  }

  private cleanupExpired(db: DatabaseSync, now: Date): void {
    db.prepare(`DELETE FROM signal_dedupe WHERE expires_at < ?`).run(
      now.toISOString(),
    );
  }
}

/** Composite dedupe key: "{org}:{idempotency_key}" (Go buildDedupeKey). */
function buildDedupeKey(org: string, idempotencyKey: string): string {
  return `${org}:${idempotencyKey}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("UNIQUE constraint failed")
  );
}

// =============================================================================
// MCP OAuth grants (Go pkg/domain/mcpserver/oauth/grant_store.go)
// =============================================================================

class SqliteOAuthGrantStore implements OAuthGrantStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async upsert(grant: OAuthGrant): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const createdAt = grant.createdAt !== 0 ? grant.createdAt : now;

    this.open()
      .prepare(
        `INSERT INTO oauth_grant (
          identity_account_id, resource_id, resource_kind, org_id,
          access_token_expires_at, client_id, auth_method, token_endpoint,
          access_token_env_var, refresh_token_env_var, environment_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (identity_account_id, resource_id, org_id) DO UPDATE SET
          resource_kind = excluded.resource_kind,
          access_token_expires_at = excluded.access_token_expires_at,
          client_id = excluded.client_id,
          auth_method = excluded.auth_method,
          token_endpoint = excluded.token_endpoint,
          access_token_env_var = excluded.access_token_env_var,
          refresh_token_env_var = excluded.refresh_token_env_var,
          environment_id = excluded.environment_id,
          updated_at = excluded.updated_at`,
      )
      .run(
        grant.identityAccountId,
        grant.resourceId,
        grant.resourceKind,
        grant.orgId,
        grant.accessTokenExpiresAt,
        grant.clientId,
        grant.authMethod,
        grant.tokenEndpoint,
        grant.accessTokenEnvVar,
        grant.refreshTokenEnvVar,
        grant.environmentId,
        createdAt,
        now,
      );
  }

  async find(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<OAuthGrant | undefined> {
    const row = this.open()
      .prepare(
        `SELECT identity_account_id, resource_id, resource_kind, org_id,
          access_token_expires_at, client_id, auth_method, token_endpoint,
          access_token_env_var, refresh_token_env_var, environment_id,
          created_at, updated_at
         FROM oauth_grant
         WHERE identity_account_id = ? AND resource_id = ? AND org_id = ?`,
      )
      .get(identityAccountId, resourceId, orgId) as
      | {
          identity_account_id: string;
          resource_id: string;
          resource_kind: string;
          org_id: string;
          access_token_expires_at: number;
          client_id: string;
          auth_method: string;
          token_endpoint: string;
          access_token_env_var: string;
          refresh_token_env_var: string;
          environment_id: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (row === undefined) {
      return undefined; // no grant is a normal state, not an error (Go: nil, nil)
    }
    return {
      identityAccountId: row.identity_account_id,
      resourceId: row.resource_id,
      resourceKind: row.resource_kind,
      orgId: row.org_id,
      accessTokenExpiresAt: row.access_token_expires_at,
      clientId: row.client_id,
      authMethod: row.auth_method,
      tokenEndpoint: row.token_endpoint,
      accessTokenEnvVar: row.access_token_env_var,
      refreshTokenEnvVar: row.refresh_token_env_var,
      environmentId: row.environment_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async delete(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<void> {
    this.open()
      .prepare(
        `DELETE FROM oauth_grant
         WHERE identity_account_id = ? AND resource_id = ? AND org_id = ?`,
      )
      .run(identityAccountId, resourceId, orgId);
  }

  async deleteByResourceId(resourceId: string, orgId: string): Promise<number> {
    const result = this.open()
      .prepare(
        `DELETE FROM oauth_grant
         WHERE resource_id = ? AND org_id = ?`,
      )
      .run(resourceId, orgId);
    return Number(result.changes);
  }
}

// =============================================================================
// MCP pending OAuth state (Go pkg/domain/mcpserver/oauth/pending_state_store.go)
// =============================================================================

class SqlitePendingOAuthStateStore implements PendingOAuthStateStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async save(state: PendingOAuthState): Promise<void> {
    const createdAt =
      state.createdAt !== 0 ? state.createdAt : Math.floor(Date.now() / 1000);
    this.open()
      .prepare(
        `INSERT INTO pending_oauth_state (
          state, code_verifier, client_id, client_secret, token_endpoint,
          mcp_server_id, identity_account_id, target_env_var, auth_method,
          token_auth_method, redirect_uri, org, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.state,
        state.codeVerifier,
        state.clientId,
        state.clientSecret,
        state.tokenEndpoint,
        state.mcpServerId,
        state.identityAccountId,
        state.targetEnvVar,
        state.authMethod,
        state.tokenAuthMethod,
        state.redirectUri,
        state.org,
        createdAt,
      );
  }

  async getAndDelete(
    stateParam: string,
  ): Promise<PendingOAuthState | undefined> {
    const db = this.open();

    // Read + delete are one transaction so a state can be redeemed at most
    // once (Go GetAndDelete). All statements are synchronous — nothing can
    // interleave into the open transaction.
    db.exec("BEGIN");
    try {
      const row = db
        .prepare(
          `SELECT state, code_verifier, client_id, client_secret, token_endpoint,
            mcp_server_id, identity_account_id, target_env_var, auth_method,
            token_auth_method, redirect_uri, org, created_at
           FROM pending_oauth_state
           WHERE state = ?`,
        )
        .get(stateParam) as
        | {
            state: string;
            code_verifier: string;
            client_id: string;
            client_secret: string;
            token_endpoint: string;
            mcp_server_id: string;
            identity_account_id: string;
            target_env_var: string;
            auth_method: string;
            token_auth_method: string;
            redirect_uri: string;
            org: string;
            created_at: number;
          }
        | undefined;

      if (row === undefined) {
        db.exec("COMMIT");
        return undefined;
      }

      db.prepare(`DELETE FROM pending_oauth_state WHERE state = ?`).run(
        stateParam,
      );
      db.exec("COMMIT");

      const ageMs = Date.now() - row.created_at * 1000;
      if (ageMs > PENDING_OAUTH_STATE_TTL_MS) {
        return undefined; // expired: deleted on the way out, never redeemed
      }

      return {
        state: row.state,
        codeVerifier: row.code_verifier,
        clientId: row.client_id,
        clientSecret: row.client_secret,
        tokenEndpoint: row.token_endpoint,
        mcpServerId: row.mcp_server_id,
        identityAccountId: row.identity_account_id,
        targetEnvVar: row.target_env_var,
        authMethod: row.auth_method,
        tokenAuthMethod: row.token_auth_method,
        redirectUri: row.redirect_uri,
        org: row.org,
        createdAt: row.created_at,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    const cutoff =
      Math.floor(Date.now() / 1000) - PENDING_OAUTH_STATE_TTL_MS / 1000;
    const result = this.open()
      .prepare(`DELETE FROM pending_oauth_state WHERE created_at < ?`)
      .run(cutoff);
    return Number(result.changes);
  }
}
