/**
 * Postgres driver — implements the Store contract over node-postgres
 * (DD-010), method-for-method against sqlite/store.ts so the two drivers
 * stay contract-twins: same typed errors, same full-scan find* semantics
 * (shared scanners in ../proto-fields.ts), same ledger string formats.
 * Selected at boot when DATABASE_URL is set (boot/config.ts precedence).
 *
 * Concurrency model (DD-010, the recorded semantic widening): atomicity is
 * per-resource, not global. updateResource runs
 * BEGIN → SELECT ... FOR UPDATE → modify() → UPDATE → COMMIT on one pooled
 * connection — the synchronous `modify` contract (interface.ts) means no
 * caller I/O can ever hold the row lock open. Concurrent writes to
 * DIFFERENT resources may interleave; sqlite's incidental global write
 * serialization is deliberately NOT emulated (rejected alternative in
 * DD-010 — an advisory lock around every write would discard the
 * concurrency a team-scale database exists to provide).
 *
 * Other write contracts and their mechanisms here:
 * - first-writer-wins event appends: one multi-row INSERT ON CONFLICT DO
 *   NOTHING, rowCount = the true inserted count;
 * - fire-identity schedule-run upserts: ON CONFLICT DO UPDATE guarded by
 *   completed_at = '' (terminal rows immutable);
 * - single-holder audit tags: two UPDATEs in one transaction, missing
 *   target rolls back (the #341 head-repoint contract);
 * - at-most-once OAuth state redemption: DELETE ... RETURNING (atomic
 *   without an explicit transaction).
 *
 * BIGINT/COUNT results arrive from pg as strings (precision posture);
 * every numeric read is explicitly Number()-converted at the row mapping.
 *
 * Proven by the shared store contract suite (../__tests__/store-contract.ts)
 * under TEST_DATABASE_URL, __tests__/ (migrations, tsquery, driver
 * physicals), and end-to-end by the conformance suites on local-postgres /
 * local-postgres-execution (DD-011).
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import pg from "pg";
import type { Pool, PoolClient } from "pg";

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
import { runMigrations } from "./migrations.js";
import { normalizeTsRankScore, renderTsQueryExpression } from "./tsquery.js";

/**
 * The text search config every query-side to_tsquery call must name —
 * it MUST match the config baked into the migration's generated tsvector
 * (a mismatched config searches a differently-stemmed document and
 * silently returns wrong membership).
 */
const TEXT_SEARCH_CONFIG = "english";

export class PostgresStore implements Store {
  readonly bootstrapState: BootstrapStateStore;
  readonly signalDedupe: SignalDedupeStore;
  readonly oauthGrants: OAuthGrantStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;

  private pool: Pool | undefined;
  private readonly logger: StoreLogger;

  private constructor(pool: Pool, logger: StoreLogger) {
    this.pool = pool;
    this.logger = logger;
    this.bootstrapState = new PostgresBootstrapStateStore(() => this.open());
    this.signalDedupe = new PostgresSignalDedupeStore(
      () => this.open(),
      logger,
    );
    this.oauthGrants = new PostgresOAuthGrantStore(() => this.open());
    this.pendingOAuthStates = new PostgresPendingOAuthStateStore(() =>
      this.open(),
    );
  }

  /**
   * Connects to databaseUrl, runs migrations (advisory-locked, so
   * concurrent boots serialize), and returns the ready store. Any failure
   * here is a loud boot throw — never a degraded server (the same posture
   * as SqliteStore.open; the composition root does not catch it).
   */
  static async open(
    databaseUrl: string,
    logger: StoreLogger = NOOP_STORE_LOGGER,
  ): Promise<PostgresStore> {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    // An idle pooled connection dropping (server restart, network blip)
    // emits 'error' on the pool; without a listener that is a process
    // crash. The next query checks out a fresh connection, so warn-only.
    pool.on("error", (error) => {
      logger.warn("postgres pool idle-connection error", {
        error: error.message,
      });
    });

    // Migrations run on a dedicated client: pg_advisory_lock is
    // session-scoped, so lock and unlock must ride the same connection.
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } catch (error) {
      client.release();
      await pool.end();
      throw error;
    }
    client.release();

    return new PostgresStore(pool, logger);
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
    const data = toBinary(schema, msg);
    await this.open().query(
      `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = now()`,
      [apiResourceKindName(kind), id, Buffer.from(data)],
    );
  }

  async getResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const kindName = apiResourceKindName(kind);
    const result = await this.open().query(
      `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
      [kindName, id],
    );
    const row = result.rows[0] as { data: Uint8Array } | undefined;
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
    const kindName = apiResourceKindName(kind);

    // FOR UPDATE locks exactly this row for the transaction — the DD-010
    // per-resource atomicity contract. `modify` is synchronous by contract
    // (interface.ts), so no caller I/O can extend the lock's hold time.
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT data FROM resources WHERE kind = $1 AND id = $2 FOR UPDATE`,
        [kindName, id],
      );
      const row = result.rows[0] as { data: Uint8Array } | undefined;
      if (row === undefined) {
        throw new ResourceNotFoundError(`${kindName}/${id}`);
      }

      const msg = fromBinary(schema, row.data);
      modify(msg);

      const data = toBinary(schema, msg);
      await client.query(
        `UPDATE resources SET data = $3, updated_at = now() WHERE kind = $1 AND id = $2`,
        [kindName, id, Buffer.from(data)],
      );
      return msg;
    });
  }

  async listResources(kind: ApiResourceKind): Promise<Uint8Array[]> {
    const result = await this.open().query(
      `SELECT data FROM resources WHERE kind = $1`,
      [apiResourceKindName(kind)],
    );
    return (result.rows as Array<{ data: Uint8Array }>).map((row) => row.data);
  }

  async deleteResource(kind: ApiResourceKind, id: string): Promise<void> {
    await this.open().query(
      `DELETE FROM resources WHERE kind = $1 AND id = $2`,
      [apiResourceKindName(kind), id],
    );
  }

  async findByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const kindName = apiResourceKindName(kind);
    const rows = await this.listResources(kind);
    const match = scanForFieldMatch(rows, schema, fieldPath, value);
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
    // Go-parity quirk preserved (interface.ts doc; both drivers mirror it):
    // returns ALL rows of the kind, unfiltered. The parameters are kept so
    // the signature stays surface-identical.
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
    const rows = await this.listResources(kind);
    return filterRowsByLabel(rows, schema, labelKey, labelValue);
  }

  async deleteResourcesByKind(kind: ApiResourceKind): Promise<number> {
    const result = await this.open().query(
      `DELETE FROM resources WHERE kind = $1`,
      [apiResourceKindName(kind)],
    );
    return result.rowCount ?? 0;
  }

  async deleteResourcesByIdPrefix(
    kind: ApiResourceKind,
    idPrefix: string,
  ): Promise<number> {
    // LIKE with the wildcard characters of the PREFIX escaped — sqlite's
    // GLOB has no LIKE-metacharacter hazard, this port must not either.
    const result = await this.open().query(
      `DELETE FROM resources WHERE kind = $1 AND id LIKE $2 ESCAPE '\\'`,
      [apiResourceKindName(kind), `${escapeLikePattern(idPrefix)}%`],
    );
    return result.rowCount ?? 0;
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
    const data = toBinary(schema, msg);
    await this.open().query(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        apiResourceKindName(kind),
        resourceId,
        Buffer.from(data),
        versionHash,
        tag,
      ],
    );
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
    const result = await this.open().query(
      `DELETE FROM resource_audit WHERE kind = $1 AND resource_id = $2`,
      [apiResourceKindName(kind), resourceId],
    );
    return result.rowCount ?? 0;
  }

  async countAuditEntries(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<number> {
    const result = await this.open().query(
      `SELECT COUNT(*) AS count FROM resource_audit WHERE kind = $1 AND resource_id = $2`,
      [apiResourceKindName(kind), resourceId],
    );
    return Number((result.rows[0] as { count: string | number }).count);
  }

  async getLatestAuditHash(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<string> {
    const kindName = apiResourceKindName(kind);
    // id DESC breaks archived_at ties from sub-timestamp inserts — the
    // same recency contract as sqlite's rowid tie-break.
    const result = await this.open().query(
      `SELECT version_hash FROM resource_audit
       WHERE kind = $1 AND resource_id = $2
       ORDER BY archived_at DESC, id DESC
       LIMIT 1`,
      [kindName, resourceId],
    );
    const row = result.rows[0] as { version_hash: string | null } | undefined;
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
    const kindName = apiResourceKindName(kind);

    // Single transaction: clear the prior holder, assign the target. A
    // missing target rolls back, leaving the prior holder untouched — the
    // #341 head-repoint contract.
    await this.withTransaction(async (client) => {
      await client.query(
        `UPDATE resource_audit SET tag = ''
         WHERE kind = $1 AND resource_id = $2 AND tag = $3`,
        [kindName, resourceId, tag],
      );

      const result = await client.query(
        `UPDATE resource_audit SET tag = $1
         WHERE kind = $2 AND resource_id = $3 AND version_hash = $4`,
        [tag, kindName, resourceId, versionHash],
      );

      if ((result.rowCount ?? 0) === 0) {
        throw new AuditNotFoundError(
          `${kindName}/${resourceId} (hash=${versionHash})`,
        );
      }
    });
  }

  async listAuditRecords(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<AuditRecord[]> {
    const result = await this.open().query(
      `SELECT data, version_hash, tag FROM resource_audit
       WHERE kind = $1 AND resource_id = $2
       ORDER BY archived_at DESC, id DESC`,
      [apiResourceKindName(kind), resourceId],
    );
    return (
      result.rows as Array<{
        data: Uint8Array;
        version_hash: string | null;
        tag: string | null;
      }>
    ).map((row) => ({
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
    const kindName = apiResourceKindName(kind);
    // Duplicates for one hash are legal — newest wins (stigmer-cloud#191).
    const result = await this.open().query(
      `SELECT data, tag FROM resource_audit
       WHERE kind = $1 AND resource_id = $2 AND version_hash = $3
       ORDER BY archived_at DESC, id DESC
       LIMIT 1`,
      [kindName, resourceId, versionHash],
    );
    const row = result.rows[0] as
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
    const kindName = apiResourceKindName(kind);
    const result = await this.open().query(
      `SELECT data, version_hash FROM resource_audit
       WHERE kind = $1 AND resource_id = $2 AND tag = $3
       ORDER BY archived_at DESC, id DESC
       LIMIT 1`,
      [kindName, resourceId, tag],
    );
    const row = result.rows[0] as
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

    // One multi-row INSERT: atomic without an explicit transaction, and
    // ON CONFLICT DO NOTHING makes rowCount the true first-writer-wins
    // inserted count (oss#308).
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const [i, event] of events.entries()) {
      const base = i * 5;
      tuples.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
      );
      values.push(
        executionId,
        event.sequenceNumber,
        event.eventType,
        event.taskName,
        Buffer.from(event.data),
      );
    }

    const result = await this.open().query(
      `INSERT INTO workflow_execution_events (execution_id, sequence_number, event_type, task_name, data)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (execution_id, sequence_number) DO NOTHING`,
      values,
    );
    return result.rowCount ?? 0;
  }

  async getWorkflowExecutionEvents(
    executionId: string,
    afterSequence: number,
    eventType: string,
    taskName: string,
    limit: number,
  ): Promise<WorkflowExecutionEventRecord[]> {
    const effectiveLimit = limit <= 0 ? 100 : limit;

    let query = `SELECT execution_id, sequence_number, event_type, task_name, data, created_at
      FROM workflow_execution_events
      WHERE execution_id = $1 AND sequence_number > $2`;
    const args: unknown[] = [executionId, afterSequence];
    if (eventType !== "") {
      args.push(eventType);
      query += ` AND event_type = $${args.length}`;
    }
    if (taskName !== "") {
      args.push(taskName);
      query += ` AND task_name = $${args.length}`;
    }
    args.push(effectiveLimit);
    query += ` ORDER BY sequence_number ASC LIMIT $${args.length}`;

    const result = await this.open().query(query, args);
    return (
      result.rows as Array<{
        execution_id: string;
        sequence_number: string | number;
        event_type: string;
        task_name: string;
        data: Uint8Array;
        created_at: string;
      }>
    ).map((row) => ({
      executionId: row.execution_id,
      sequenceNumber: Number(row.sequence_number),
      eventType: row.event_type,
      taskName: row.task_name,
      data: row.data,
      createdAt: row.created_at,
    }));
  }

  async getMaxEventSequence(executionId: string): Promise<number> {
    const result = await this.open().query(
      `SELECT COALESCE(MAX(sequence_number), 0) AS max_seq FROM workflow_execution_events WHERE execution_id = $1`,
      [executionId],
    );
    return Number((result.rows[0] as { max_seq: string | number }).max_seq);
  }

  // ---------------------------------------------------------------------------
  // Schedule runs (fire ledger)
  // ---------------------------------------------------------------------------

  async upsertScheduleRun(record: ScheduleRunRecord): Promise<void> {
    // Default recorded_at is RFC-3339 whole seconds (Go time.RFC3339) —
    // the ledger's house convention for lexicographic comparison.
    const recordedAt =
      record.recordedAt !== "" ? record.recordedAt : rfc3339Seconds(new Date());

    // The ON CONFLICT WHERE guard is the terminal-immutability contract:
    // rows with a completed_at never get downgraded by a replayed write.
    await this.open().query(
      `INSERT INTO schedule_runs
        (schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (schedule_id, nominal_fire_time, origin) DO UPDATE SET
        outcome = excluded.outcome,
        reason = excluded.reason,
        execution_id = excluded.execution_id,
        completed_at = excluded.completed_at
      WHERE schedule_runs.completed_at = ''`,
      [
        record.scheduleId,
        record.org,
        record.nominalFireTime,
        record.origin,
        record.outcome,
        record.reason,
        record.executionId,
        recordedAt,
        record.completedAt,
      ],
    );
  }

  async markLatestScheduleRunTerminal(
    scheduleId: string,
    origin: string,
    outcome: string,
    reason: string,
    completedAt: string,
  ): Promise<void> {
    await this.open().query(
      `UPDATE schedule_runs SET outcome = $1, reason = $2, completed_at = $3
       WHERE schedule_id = $4 AND origin = $5 AND completed_at = ''
       AND nominal_fire_time = (
         SELECT MAX(nominal_fire_time) FROM schedule_runs
         WHERE schedule_id = $4 AND origin = $5 AND completed_at = ''
       )`,
      [outcome, reason, completedAt, scheduleId, origin],
    );
  }

  async listScheduleRuns(
    scheduleId: string,
    offset: number,
    limit: number,
  ): Promise<{ runs: ScheduleRunRecord[]; total: number }> {
    const effectiveLimit = limit <= 0 ? 50 : limit;
    const effectiveOffset = offset < 0 ? 0 : offset;

    const totalResult = await this.open().query(
      `SELECT COUNT(*) AS total FROM schedule_runs WHERE schedule_id = $1`,
      [scheduleId],
    );

    const result = await this.open().query(
      `SELECT schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at
       FROM schedule_runs
       WHERE schedule_id = $1
       ORDER BY nominal_fire_time DESC, origin DESC
       LIMIT $2 OFFSET $3`,
      [scheduleId, effectiveLimit, effectiveOffset],
    );

    return {
      total: Number((totalResult.rows[0] as { total: string | number }).total),
      runs: (
        result.rows as Array<{
          schedule_id: string;
          org: string;
          nominal_fire_time: string;
          origin: string;
          outcome: string;
          reason: string;
          execution_id: string;
          recorded_at: string;
          completed_at: string;
        }>
      ).map((row) => ({
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
    const result = await this.open().query(
      `DELETE FROM schedule_runs WHERE schedule_id = $1`,
      [scheduleId],
    );
    return result.rowCount ?? 0;
  }

  async pruneScheduleRuns(recordedBefore: string): Promise<number> {
    const result = await this.open().query(
      `DELETE FROM schedule_runs WHERE recorded_at < $1`,
      [recordedBefore],
    );
    return result.rowCount ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Search index (tsvector/tsquery — DD-009's Postgres rendering)
  // ---------------------------------------------------------------------------

  async upsertSearchIndex(
    kind: ApiResourceKind,
    resourceId: string,
    entry: SearchIndexEntry,
  ): Promise<void> {
    const kindName = apiResourceKindName(kind);

    // DELETE + INSERT in one transaction, not ON CONFLICT DO UPDATE: a
    // re-upserted row must take a fresh `seq`, keeping the list-mode
    // tie-break "newest write last-wins" — the same recency semantics the
    // sqlite driver gets from FTS5's delete+insert rowid.
    await this.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM search_index WHERE kind = $1 AND resource_id = $2`,
        [kindName, resourceId],
      );
      await client.query(
        `INSERT INTO search_index (kind, resource_id, name, description, tags, org, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          kindName,
          resourceId,
          entry.name,
          entry.description,
          entry.tags,
          entry.org,
          entry.visibility,
          entry.createdAt,
        ],
      );
    });
  }

  async deleteSearchIndex(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<void> {
    await this.open().query(
      `DELETE FROM search_index WHERE kind = $1 AND resource_id = $2`,
      [apiResourceKindName(kind), resourceId],
    );
  }

  async querySearchIndex(
    query: SearchIndexQuery,
  ): Promise<SearchIndexQueryResult> {
    // Search mode is "terms present", even when they sanitize to an empty
    // tsquery expression — to_tsquery's rejection of that expression is
    // the preserved behavior for such queries (see tsquery.ts; the FTS5
    // driver fails the same way on an empty MATCH).
    const searchMode = query.terms !== undefined;

    const args: unknown[] = [];
    const push = (value: unknown): string => {
      args.push(value);
      return `$${args.length}`;
    };

    let matchClause = "";
    if (query.terms !== undefined) {
      const param = push(renderTsQueryExpression(query.terms));
      matchClause = `search @@ to_tsquery('${TEXT_SEARCH_CONFIG}', ${param}) AND `;
    }

    // `::text[]` is load-bearing: node-pg serializes a JS array as a
    // Postgres array literal, but ANY() without the cast can fail to
    // infer the element type ("op ANY/ALL (array) requires array on
    // right side").
    const kindParam = `${push(query.kinds as string[])}::text[]`;

    // The scope-filter fragments — same composition as the sqlite driver's
    // port of Go's buildScopeFilter: org (strict or public-widened) and
    // the independent public subtraction.
    const scopeClauses: string[] = [];
    if (query.orgFilter !== "") {
      const orgParam = push(query.orgFilter);
      scopeClauses.push(
        query.crossOrgPublic
          ? `AND (org = ${orgParam} OR visibility = 'visibility_public')`
          : `AND org = ${orgParam}`,
      );
    }
    if (query.excludePublic) {
      scopeClauses.push(`AND visibility != 'visibility_public'`);
    }
    const scopeSql = scopeClauses.join("\n        ");

    // Statement 1 — full counts per kind (zero-count kinds never appear:
    // the counts come from GROUP BY over matches).
    const countResult = await this.open().query(
      `SELECT kind, COUNT(*) AS cnt
       FROM search_index
       WHERE ${matchClause}kind = ANY(${kindParam})
       ${scopeSql}
       GROUP BY kind`,
      args,
    );

    const countsByKind: Record<string, number> = {};
    let totalCount = 0;
    for (const row of countResult.rows as Array<{
      kind: string;
      cnt: string | number;
    }>) {
      const cnt = Number(row.cnt);
      countsByKind[row.kind] = cnt;
      totalCount += cnt;
    }

    // Count short-circuit before the page statement (contract-twin of the
    // sqlite driver's port of Go's EmptyResult).
    if (totalCount === 0) {
      return { countsByKind: {}, totalCount: 0, hits: [] };
    }

    // Statement 2 — the ranked page. Search mode: ts_rank over the
    // weighted document, higher = better, with explicit (kind,
    // resource_id) tie-breaks for the within-driver determinism DD-009
    // requires. List mode: score pinned exactly 1.0, newest first with the
    // seq tie-break (created_at is whole seconds — see migrations.ts).
    const limitParam = push(query.limit);
    const offsetParam = push(query.offset);
    const pageSql = searchMode
      ? `SELECT kind, resource_id, ts_rank(search, to_tsquery('${TEXT_SEARCH_CONFIG}', $1)) AS rank
         FROM search_index
         WHERE search @@ to_tsquery('${TEXT_SEARCH_CONFIG}', $1) AND kind = ANY(${kindParam})
         ${scopeSql}
         ORDER BY rank DESC, kind ASC, resource_id ASC
         LIMIT ${limitParam} OFFSET ${offsetParam}`
      : `SELECT kind, resource_id, 1.0 AS rank
         FROM search_index
         WHERE kind = ANY(${kindParam})
         ${scopeSql}
         ORDER BY created_at DESC, seq DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`;

    const pageResult = await this.open().query(pageSql, args);

    // The interface promises wire-ready scores: normalize ts_rank here;
    // list mode's score is pinned exactly 1.0 (P1 DD-001 — the driver
    // returns the wire score).
    const hits: SearchIndexHit[] = (
      pageResult.rows as Array<{
        kind: string;
        resource_id: string;
        rank: string | number;
      }>
    ).map((row) => ({
      kind: row.kind,
      resourceId: row.resource_id,
      score: searchMode ? normalizeTsRankScore(Number(row.rank)) : 1.0,
    }));

    return { countsByKind, totalCount, hits };
  }

  async clearSearchIndex(): Promise<void> {
    await this.open().query(`DELETE FROM search_index`);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.pool === undefined) {
      return; // already closed
    }
    const pool = this.pool;
    this.pool = undefined;
    await pool.end();
  }

  /** Live pool or the contract's "store is closed" error (both drivers). */
  private open(): Pool {
    if (this.pool === undefined) {
      throw new Error("store is closed");
    }
    return this.pool;
  }

  /**
   * BEGIN/COMMIT/ROLLBACK on one checked-out client — pg pools route each
   * query to any idle connection, so multi-statement transactions must pin
   * one. The rollback error (connection already broken) never masks the
   * original failure.
   */
  private async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.open().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        this.logger.warn("postgres transaction rollback failed", {
          error: String(rollbackError),
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

// =============================================================================
// Bootstrap state
// =============================================================================

class PostgresBootstrapStateStore implements BootstrapStateStore {
  constructor(private readonly open: () => Pool) {}

  async get(key: string): Promise<string> {
    const result = await this.open().query(
      `SELECT value FROM bootstrap_state WHERE key = $1`,
      [key],
    );
    const row = result.rows[0] as { value: string } | undefined;
    // Missing key → "" and NOT an error — the cross-driver contract.
    return row?.value ?? "";
  }

  async set(key: string, value: string): Promise<void> {
    await this.open().query(
      `INSERT INTO bootstrap_state (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [key, value],
    );
  }

  async getAll(): Promise<Map<string, string>> {
    const result = await this.open().query(
      `SELECT key, value FROM bootstrap_state`,
    );
    return new Map(
      (result.rows as Array<{ key: string; value: string }>).map((row) => [
        row.key,
        row.value,
      ]),
    );
  }

  async delete(key: string): Promise<void> {
    await this.open().query(`DELETE FROM bootstrap_state WHERE key = $1`, [
      key,
    ]);
  }

  async clear(): Promise<void> {
    await this.open().query(`DELETE FROM bootstrap_state`);
  }
}

// =============================================================================
// Signal dedupe
// =============================================================================

class PostgresSignalDedupeStore implements SignalDedupeStore {
  constructor(
    private readonly open: () => Pool,
    private readonly logger: StoreLogger,
  ) {}

  async claim(
    org: string,
    idempotencyKey: string,
    executionId: string,
    signalName: string,
    ttlMs: number,
  ): Promise<ClaimResult> {
    const pool = this.open();
    const id = buildDedupeKey(org, idempotencyKey);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    // Expired rows are cleaned before claiming so keys become reusable —
    // failure is non-critical (warn and continue), the cross-driver
    // contract.
    try {
      await pool.query(`DELETE FROM signal_dedupe WHERE expires_at < $1`, [
        now.toISOString(),
      ]);
    } catch (error) {
      this.logger.warn("failed to cleanup expired dedupe records", {
        error: String(error),
      });
    }

    // ON CONFLICT DO NOTHING instead of catch-the-unique-violation: same
    // first-claimer-wins outcome, no error-text sniffing.
    const result = await pool.query(
      `INSERT INTO signal_dedupe (id, org, idempotency_key, execution_id, signal_name, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'CLAIMED', $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [id, org, idempotencyKey, executionId, signalName, createdAt, expiresAt],
    );

    if ((result.rowCount ?? 0) === 1) {
      return { status: "SUCCESS" };
    }

    const record = await this.loadRecord(pool, id);
    if (record === undefined) {
      // The holder vanished between INSERT and SELECT — surface as a
      // claim failure rather than fabricating a record.
      throw new Error(`load existing record: ${id} disappeared`);
    }
    return { status: "DUPLICATE", record };
  }

  async markDelivered(org: string, idempotencyKey: string): Promise<void> {
    const id = buildDedupeKey(org, idempotencyKey);
    const now = new Date();

    // Extending expires_at here is the load-bearing half of the two-phase
    // hold: delivery earns DELIVERED_SIGNAL_DEDUPE_TTL_MS. The status guard
    // makes re-marking a no-op and keeps a takeover's fresh claim intact.
    const result = await this.open().query(
      `UPDATE signal_dedupe
       SET status = 'DELIVERED', delivered_at = $1, expires_at = $2
       WHERE id = $3 AND status = 'CLAIMED'`,
      [
        now.toISOString(),
        new Date(now.getTime() + DELIVERED_SIGNAL_DEDUPE_TTL_MS).toISOString(),
        id,
      ],
    );

    if ((result.rowCount ?? 0) === 0) {
      this.logger.warn(
        "no dedupe record updated - may be already delivered or doesn't exist",
        { id },
      );
    }
  }

  async release(org: string, idempotencyKey: string): Promise<void> {
    const id = buildDedupeKey(org, idempotencyKey);

    // Status-guarded DELETE: only an in-flight claim can be freed, so a
    // release racing markDelivered can never unblock a delivered key.
    await this.open().query(
      `DELETE FROM signal_dedupe WHERE id = $1 AND status = 'CLAIMED'`,
      [id],
    );
  }

  private async loadRecord(
    pool: Pool,
    id: string,
  ): Promise<SignalDedupeRecord | undefined> {
    const result = await pool.query(
      `SELECT id, org, idempotency_key, execution_id, signal_name, status, created_at, delivered_at, expires_at
       FROM signal_dedupe WHERE id = $1`,
      [id],
    );
    const row = result.rows[0] as
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
}

/** Composite dedupe key: "{org}:{idempotency_key}" (both drivers). */
function buildDedupeKey(org: string, idempotencyKey: string): string {
  return `${org}:${idempotencyKey}`;
}

// =============================================================================
// MCP OAuth grants
// =============================================================================

class PostgresOAuthGrantStore implements OAuthGrantStore {
  constructor(private readonly open: () => Pool) {}

  async upsert(grant: OAuthGrant): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const createdAt = grant.createdAt !== 0 ? grant.createdAt : now;

    await this.open().query(
      `INSERT INTO oauth_grant (
        identity_account_id, resource_id, resource_kind, org_id,
        access_token_expires_at, client_id, auth_method, token_endpoint,
        access_token_env_var, refresh_token_env_var, environment_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      [
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
      ],
    );
  }

  async find(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<OAuthGrant | undefined> {
    const result = await this.open().query(
      `SELECT identity_account_id, resource_id, resource_kind, org_id,
        access_token_expires_at, client_id, auth_method, token_endpoint,
        access_token_env_var, refresh_token_env_var, environment_id,
        created_at, updated_at
       FROM oauth_grant
       WHERE identity_account_id = $1 AND resource_id = $2 AND org_id = $3`,
      [identityAccountId, resourceId, orgId],
    );
    const row = result.rows[0] as
      | {
          identity_account_id: string;
          resource_id: string;
          resource_kind: string;
          org_id: string;
          access_token_expires_at: string | number;
          client_id: string;
          auth_method: string;
          token_endpoint: string;
          access_token_env_var: string;
          refresh_token_env_var: string;
          environment_id: string;
          created_at: string | number;
          updated_at: string | number;
        }
      | undefined;
    if (row === undefined) {
      return undefined; // no grant is a normal state, not an error
    }
    return {
      identityAccountId: row.identity_account_id,
      resourceId: row.resource_id,
      resourceKind: row.resource_kind,
      orgId: row.org_id,
      accessTokenExpiresAt: Number(row.access_token_expires_at),
      clientId: row.client_id,
      authMethod: row.auth_method,
      tokenEndpoint: row.token_endpoint,
      accessTokenEnvVar: row.access_token_env_var,
      refreshTokenEnvVar: row.refresh_token_env_var,
      environmentId: row.environment_id,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async delete(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<void> {
    await this.open().query(
      `DELETE FROM oauth_grant
       WHERE identity_account_id = $1 AND resource_id = $2 AND org_id = $3`,
      [identityAccountId, resourceId, orgId],
    );
  }

  async deleteByResourceId(resourceId: string, orgId: string): Promise<number> {
    const result = await this.open().query(
      `DELETE FROM oauth_grant
       WHERE resource_id = $1 AND org_id = $2`,
      [resourceId, orgId],
    );
    return result.rowCount ?? 0;
  }
}

// =============================================================================
// MCP pending OAuth state
// =============================================================================

class PostgresPendingOAuthStateStore implements PendingOAuthStateStore {
  constructor(private readonly open: () => Pool) {}

  async save(state: PendingOAuthState): Promise<void> {
    const createdAt =
      state.createdAt !== 0 ? state.createdAt : Math.floor(Date.now() / 1000);
    await this.open().query(
      `INSERT INTO pending_oauth_state (
        state, code_verifier, client_id, client_secret, token_endpoint,
        mcp_server_id, identity_account_id, target_env_var, auth_method,
        token_auth_method, redirect_uri, org, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
      ],
    );
  }

  async getAndDelete(
    stateParam: string,
  ): Promise<PendingOAuthState | undefined> {
    // DELETE ... RETURNING is the at-most-once redemption in one atomic
    // statement — the same contract sqlite implements as a read+delete
    // transaction.
    const result = await this.open().query(
      `DELETE FROM pending_oauth_state WHERE state = $1
       RETURNING state, code_verifier, client_id, client_secret, token_endpoint,
         mcp_server_id, identity_account_id, target_env_var, auth_method,
         token_auth_method, redirect_uri, org, created_at`,
      [stateParam],
    );
    const row = result.rows[0] as
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
          created_at: string | number;
        }
      | undefined;

    if (row === undefined) {
      return undefined;
    }

    const createdAt = Number(row.created_at);
    const ageMs = Date.now() - createdAt * 1000;
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
      createdAt,
    };
  }

  async cleanupExpired(): Promise<number> {
    const cutoff =
      Math.floor(Date.now() / 1000) - PENDING_OAUTH_STATE_TTL_MS / 1000;
    const result = await this.open().query(
      `DELETE FROM pending_oauth_state WHERE created_at < $1`,
      [cutoff],
    );
    return result.rowCount ?? 0;
  }
}

/** Escapes LIKE metacharacters so a prefix matches literally. */
function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
