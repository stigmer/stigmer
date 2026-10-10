/**
 * node:sqlite driver — ports backend/libs/go/store/sqlite/store.go
 * method-for-method: same database file, same pragmas, same
 * physical layout (kind = the enum's proto name, data = the marshaled
 * protobuf bytes), same full-scan semantics. Physical indexing is
 * deliberately NOT added here (it would couple behavior-port risk to
 * storage-redesign risk); the interface's named methods guarantee
 * indexability, which the Postgres driver uses.
 *
 * Write serialization: Go used a process-wide mutex around a pooled
 * connection. node:sqlite is synchronous on a single connection, which
 * gives the same serialization for free — the accepted trade-off
 * is that a large full-scan read blocks the event loop momentarily, fine
 * at laptop scale where Go ships the same scans. updateResource
 * additionally wraps its read-modify-write in BEGIN IMMEDIATE:
 * unlike the in-process mutex, the transaction also excludes OTHER
 * processes sharing the database file.
 *
 * Multi-statement operations (setAuditTag, upsertSearchIndex,
 * pendingOAuthStates.getAndDelete) run in explicit transactions exactly where Go used one. All code between BEGIN
 * and COMMIT is synchronous — nothing can interleave into an open
 * transaction on the sole connection.
 *
 * Proven by __tests__/ (migrations incl. the Go-database fixture,
 * per-method contracts, the permanent FTS5 probe) and end-to-end by
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
  PENDING_OAUTH_STATE_TTL_MS,
  ResourceNotFoundError,
} from "../interface.js";
import type {
  AuditRecord,
  BootstrapStateStore,
  ConnectAttemptRecord,
  ConnectAttemptStore,
  ConnectLinkRecord,
  ConnectLinkStore,
  OAuthClientRegistrationStore,
  ResourceNameClaim,
  ResourceNameEntry,
  ResourceNameKey,
  ResourceNameRename,
  ResourceNameRenamed,
  ResourceNameStore,
  PendingOAuthState,
  OrganizationDeletion,
  OrganizationDeletionStore,
  PendingOAuthStateStore,
  RawResourceDocument,
  ScheduleFireRecord,
  SearchIndexEntry,
  SearchIndexHit,
  SearchIndexQuery,
  SearchIndexQueryResult,
  Store,
  StoreOpenOptions,
} from "../interface.js";
import {
  ListIndexRegistry,
  assertListIndexLimit,
  listIndexFactsOf,
  matchesListIndexQuery,
  mergeListIndexRows,
  sameListKeyRows,
} from "../list-index.js";
import type {
  ListIndexDeclaration,
  ListIndexFacts,
  ListIndexQuery,
  ListIndexRow,
} from "../list-index.js";
import { NOOP_STORE_LOGGER } from "../logger.js";
import type { StoreLogger } from "../logger.js";
import { assertRenameMoves } from "../resource-names.js";
import {
  apiResourceKindName,
  filterRowsByField,
  filterRowsByLabel,
  scanForFieldMatch,
} from "../proto-fields.js";
import { rfc3339Seconds } from "../rfc3339.js";
import { normalizeBm25Score, renderFts5MatchExpression } from "./fts5.js";
import { runMigrations } from "./migrations.js";

// The logging seam lived here first; re-exported after its
// promotion to ../logger.ts (second consumer: the Postgres driver) so the
// import path stays stable for existing consumers.
export type { StoreLogger } from "../logger.js";

/**
 * `updated_at` and the list index's stamp, to the millisecond. Evaluated
 * twice in one statement it yields one value (sqlite fixes 'now' per
 * statement step), so a row this driver writes is stamped with exactly its
 * `updated_at`; a writer that does not know the index writes
 * `datetime('now')`, whole seconds, which never equals a stamp.
 */
const NOW = `strftime('%Y-%m-%d %H:%M:%f', 'now')`;

/** The one upsert every resource write goes through (postgres/store.ts's twin). */
const UPSERT_RESOURCE_SQL = `INSERT OR REPLACE INTO resources
  (kind, id, data, updated_at, list_org, list_created_at, list_index_revision, list_indexed_at)
  VALUES (?, ?, ?, ${NOW}, ?, ?, ?, ${NOW})`;

/**
 * The rows of a kind whose facts are not proven current under a revision
 * (list-index.ts; postgres/store.ts's twin). A row's list columns sit
 * after its blob in the record and sqlite reaches them only by walking the
 * blob's overflow pages, so any predicate checked per row of the kind
 * costs a read of every blob (measured: 11 ms, and 72 ms for an OR over
 * the revision, across 1,279 rows of 37 KB). Every arm is therefore one
 * index range that fetches a row only when it matches, and names its
 * index: without statistics the planner prefers the primary key for
 * `kind = ?`, and `INDEXED BY` fails the statement rather than fall back
 * to a scan. The arms overlap (an unstamped row has no revision either),
 * so the caller keeps one row per id. Parameters: kind, kind, kind,
 * revision, kind, revision.
 */
const UNPROVEN_ROWS_SQL = `
  SELECT id, data FROM resources INDEXED BY idx_resources_list_unproven
  WHERE kind = ? AND list_indexed_at IS NOT updated_at
  UNION ALL
  SELECT id, data FROM resources INDEXED BY idx_resources_list_revision
  WHERE kind = ? AND list_index_revision IS NULL
  UNION ALL
  SELECT id, data FROM resources INDEXED BY idx_resources_list_revision
  WHERE kind = ? AND list_index_revision < ?
  UNION ALL
  SELECT id, data FROM resources INDEXED BY idx_resources_list_revision
  WHERE kind = ? AND list_index_revision > ?`;

function unprovenRowsParams(
  kindName: string,
  revision: number,
): Array<string | number> {
  return [kindName, kindName, kindName, revision, kindName, revision];
}

/** Keeps the first row per id; the unproven arms overlap. */
function oneRowPerId<T extends { readonly id: string }>(
  rows: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>();
  return rows.filter((row) =>
    seen.has(row.id) ? false : (seen.add(row.id), true),
  );
}

/** How many unproven rows the reconciliation at open decodes per statement. */
const RECONCILE_BATCH = 500;

export class SqliteStore implements Store {
  readonly bootstrapState: BootstrapStateStore;
  readonly resourceNames: ResourceNameStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;
  readonly oauthClientRegistrations: OAuthClientRegistrationStore;
  readonly connectLinks: ConnectLinkStore;
  readonly connectAttempts: ConnectAttemptStore;
  readonly organizationDeletions: OrganizationDeletionStore;

  private db: DatabaseSync | undefined;
  private readonly dbPath: string;
  private readonly logger: StoreLogger;
  private readonly listIndexes: ListIndexRegistry;

  private constructor(
    db: DatabaseSync,
    dbPath: string,
    logger: StoreLogger,
    listIndexes: ListIndexRegistry,
  ) {
    this.db = db;
    this.dbPath = dbPath;
    this.logger = logger;
    this.listIndexes = listIndexes;
    this.bootstrapState = new SqliteBootstrapStateStore(() => this.open());
    this.resourceNames = new SqliteResourceNameStore(() => this.open());
    this.pendingOAuthStates = new SqlitePendingOAuthStateStore(() =>
      this.open(),
    );
    this.oauthClientRegistrations = new SqliteOAuthClientRegistrationStore(
      () => this.open(),
    );
    this.connectLinks = new SqliteConnectLinkStore(() => this.open());
    this.connectAttempts = new SqliteConnectAttemptStore(() => this.open());
    this.organizationDeletions = new SqliteOrganizationDeletionStore(() =>
      this.open(),
    );
  }

  /**
   * Opens (or creates) the database at dbPath, applies the pragmas in Go's
   * order, runs migrations — Go NewStore — and reconciles the list index
   * (derives the facts of every unproven row of a declared kind).
   */
  static open(
    dbPath: string,
    logger: StoreLogger = NOOP_STORE_LOGGER,
    options: StoreOpenOptions = {},
  ): SqliteStore {
    const listIndexes = new ListIndexRegistry(options.listIndexes ?? []);
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
      runMigrations(db, undefined, logger);
    } catch (error) {
      db.close();
      throw error;
    }

    const store = new SqliteStore(db, dbPath, logger, listIndexes);
    try {
      store.reconcileListIndexes();
    } catch (error) {
      db.close();
      throw error;
    }
    return store;
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
    const kindName = apiResourceKindName(kind);
    const facts = this.listIndexes.factsOf(kind, msg);
    if (facts === undefined) {
      db.prepare(UPSERT_RESOURCE_SQL).run(kindName, id, data, null, null, null);
      return;
    }
    db.exec("BEGIN");
    try {
      db.prepare(UPSERT_RESOURCE_SQL).run(
        kindName,
        id,
        data,
        facts.org,
        facts.createdAt,
        facts.revision,
      );
      replaceListKeys(db, kindName, id, facts);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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

    // BEGIN IMMEDIATE takes the write lock up front, so the
    // read-modify-write also excludes other PROCESSES on the same file —
    // strictly stronger than Go's in-process mutex. `modify` is synchronous
    // by contract (interface.ts): nothing can interleave into the open
    // transaction on this sole connection.
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare(
          `SELECT data, list_indexed_at IS updated_at AS stamped, list_index_revision
           FROM resources WHERE kind = ? AND id = ?`,
        )
        .get(kindName, id) as
        | {
            data: Uint8Array;
            stamped: number;
            list_index_revision: number | null;
          }
        | undefined;
      if (row === undefined) {
        throw new ResourceNotFoundError(`${kindName}/${id}`);
      }

      const msg = fromBinary(schema, row.data);
      const before = this.listIndexes.factsOf(kind, msg);
      modify(msg);
      const after = this.listIndexes.factsOf(kind, msg);

      const data = toBinary(schema, msg);
      db.prepare(UPSERT_RESOURCE_SQL).run(
        kindName,
        id,
        data,
        after?.org ?? null,
        after?.createdAt ?? null,
        after?.revision ?? null,
      );
      if (
        after !== undefined &&
        (row.stamped !== 1 ||
          row.list_index_revision !== after.revision ||
          before === undefined ||
          !sameListKeyRows(before, after))
      ) {
        replaceListKeys(db, kindName, id, after);
      }

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

  async queryResources<K extends string>(
    declaration: ListIndexDeclaration<K>,
    query: ListIndexQuery<K>,
  ): Promise<ListIndexRow[]> {
    this.listIndexes.require(declaration);
    assertListIndexLimit(query.limit);
    if (query.anyKey !== undefined && query.anyKey.length === 0) {
      return [];
    }
    const db = this.open();
    const kindName = apiResourceKindName(declaration.kind);

    // A key read is driven from the key table (CROSS JOIN fixes sqlite's
    // join order), so only the rows the key names are ever read; several
    // keys are one such read each, merged below (postgres/store.ts's twin).
    const reads =
      query.anyKey === undefined
        ? [provenReadSql(kindName, declaration.revision, query, undefined)]
        : query.anyKey.map((key) =>
            provenReadSql(kindName, declaration.revision, query, key),
          );
    const proven: ListIndexRow[] = [];
    for (const read of reads) {
      const rows = db.prepare(read.sql).all(...read.params) as Array<{
        id: string;
        data: Uint8Array;
        created_at: string;
      }>;
      for (const row of rows) {
        proven.push({
          id: row.id,
          data: row.data,
          cursor: { createdAt: row.created_at, id: row.id },
        });
      }
    }

    const unproven = oneRowPerId(
      db
        .prepare(UNPROVEN_ROWS_SQL)
        .all(...unprovenRowsParams(kindName, declaration.revision)) as Array<{
        id: string;
        data: Uint8Array;
      }>,
    );
    const unprovenRows: ListIndexRow[] = [];
    for (const row of unproven) {
      const facts = this.deriveAndRepair(declaration, row.id, row.data);
      if (facts !== undefined && matchesListIndexQuery(row.id, facts, query)) {
        unprovenRows.push({
          id: row.id,
          data: row.data,
          cursor: { createdAt: facts.createdAt, id: row.id },
        });
      }
    }
    return mergeListIndexRows(proven, unprovenRows, query.limit);
  }

  async deleteResource(kind: ApiResourceKind, id: string): Promise<void> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    db.prepare(`DELETE FROM resources WHERE kind = ? AND id = ?`).run(
      kindName,
      id,
    );
    db.prepare(`DELETE FROM resource_list_keys WHERE kind = ? AND id = ?`).run(
      kindName,
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

  async findAllByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
  ): Promise<Uint8Array[]> {
    const db = this.open();
    const rows = db
      .prepare(`SELECT data FROM resources WHERE kind = ?`)
      .all(apiResourceKindName(kind)) as Array<{ data: Uint8Array }>;
    return filterRowsByField(
      rows.map((row) => row.data),
      schema,
      fieldPath,
      value,
    );
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

  async findResourcesRawOrderedAfter(
    kind: ApiResourceKind,
    afterIdExclusive: string,
    limit: number,
  ): Promise<RawResourceDocument[]> {
    if (limit <= 0) {
      throw new Error(`limit must be positive, got ${limit}`);
    }
    const db = this.open();
    // Keyset pagination over the (kind, id) primary key — stable under
    // concurrent writes (the interface's maintenance-surface contract).
    return db
      .prepare(
        `SELECT id, data FROM resources WHERE kind = ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .all(apiResourceKindName(kind), afterIdExclusive, limit) as Array<{
      id: string;
      data: Uint8Array;
    }>;
  }

  async replaceResourceDataIfUnchanged(
    kind: ApiResourceKind,
    id: string,
    expectedData: Uint8Array,
    newData: Uint8Array,
  ): Promise<boolean> {
    const db = this.open();
    // BLOB equality in the WHERE clause makes the compare-and-swap one
    // atomic statement: zero rows changed means the row moved on (or was
    // deleted) since the read — a lost swap, never an upsert. The new bytes'
    // list facts ride the same statement; bytes a declared kind's schema
    // cannot decode leave the row unproven (stamp NULL), for a read to skip.
    const kindName = apiResourceKindName(kind);
    const declaration = this.listIndexes.declarationOf(kind);
    const facts =
      declaration === undefined
        ? undefined
        : factsOfBytes(declaration, newData);
    const swap = (): boolean =>
      Number(
        db
          .prepare(
            `UPDATE resources SET data = ?, updated_at = ${NOW},
               list_org = ?, list_created_at = ?, list_index_revision = ?,
               list_indexed_at = CASE WHEN ? THEN ${NOW} ELSE NULL END
             WHERE kind = ? AND id = ? AND data = ?`,
          )
          .run(
            newData,
            facts?.org ?? null,
            facts?.createdAt ?? null,
            facts?.revision ?? null,
            declaration === undefined || facts !== undefined ? 1 : 0,
            kindName,
            id,
            expectedData,
          ).changes,
      ) === 1;
    if (facts === undefined) {
      return swap();
    }
    db.exec("BEGIN");
    try {
      const swapped = swap();
      if (swapped) {
        replaceListKeys(db, kindName, id, facts);
      }
      db.exec("COMMIT");
      return swapped;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteResourcesByKind(kind: ApiResourceKind): Promise<number> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    const result = db
      .prepare(`DELETE FROM resources WHERE kind = ?`)
      .run(kindName);
    db.prepare(`DELETE FROM resource_list_keys WHERE kind = ?`).run(kindName);
    return Number(result.changes);
  }

  async deleteResourcesByIdPrefix(
    kind: ApiResourceKind,
    idPrefix: string,
  ): Promise<number> {
    const db = this.open();
    const kindName = apiResourceKindName(kind);
    // GLOB 'prefix*' uses the (kind, id) index where LIKE would not (Go).
    const result = db
      .prepare(`DELETE FROM resources WHERE kind = ? AND id GLOB ?`)
      .run(kindName, `${idPrefix}*`);
    db.prepare(
      `DELETE FROM resource_list_keys WHERE kind = ? AND id GLOB ?`,
    ).run(kindName, `${idPrefix}*`);
    return Number(result.changes);
  }

  // ---------------------------------------------------------------------------
  // The list index's repair (list-index.ts; postgres/store.ts's twin)
  // ---------------------------------------------------------------------------

  /**
   * An unproven row's facts, derived from its bytes, and the row repaired
   * when those bytes are still the stored ones. Undefined when the bytes
   * do not decode; the row stays unproven and is skipped.
   */
  private deriveAndRepair(
    declaration: ListIndexDeclaration,
    id: string,
    data: Uint8Array,
  ): ListIndexFacts | undefined {
    const kindName = apiResourceKindName(declaration.kind);
    const facts = factsOfBytes(declaration, data);
    if (facts === undefined) {
      this.logger.warn(
        "list index: an unproven row does not decode, skipping",
        {
          kind: kindName,
          id,
        },
      );
      return undefined;
    }
    const db = this.open();
    db.exec("BEGIN");
    try {
      const repaired = db
        .prepare(
          `UPDATE resources SET list_org = ?, list_created_at = ?,
             list_index_revision = ?, list_indexed_at = updated_at
           WHERE kind = ? AND id = ? AND data = ?`,
        )
        .run(facts.org, facts.createdAt, facts.revision, kindName, id, data);
      if (Number(repaired.changes) === 1) {
        replaceListKeys(db, kindName, id, facts);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      this.logger.warn("list index: repairing a row failed", {
        kind: kindName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return facts;
  }

  /**
   * Derives every unproven row of each declared kind and stamps every other
   * kind's unstamped rows, so the unproven set is empty once open returns.
   */
  private reconcileListIndexes(): void {
    const db = this.open();
    const declarations = this.listIndexes.declarations();
    for (const declaration of declarations) {
      const kindName = apiResourceKindName(declaration.kind);
      let after = "";
      let derived = 0;
      for (;;) {
        // Duplicates from overlapping arms sit side by side in id order and
        // the next batch starts after the last id, so none is repaired twice
        // across batches and the count still ends the loop.
        const rows = db
          .prepare(
            `SELECT id, data FROM (${UNPROVEN_ROWS_SQL}) WHERE id > ?
             ORDER BY id LIMIT ?`,
          )
          .all(
            ...unprovenRowsParams(kindName, declaration.revision),
            after,
            RECONCILE_BATCH,
          ) as Array<{
          id: string;
          data: Uint8Array;
        }>;
        for (const row of oneRowPerId(rows)) {
          if (
            this.deriveAndRepair(declaration, row.id, row.data) !== undefined
          ) {
            derived += 1;
          }
          after = row.id;
        }
        if (rows.length < RECONCILE_BATCH) {
          break;
        }
      }
      if (derived > 0) {
        this.logger.info("list index reconciled", {
          kind: kindName,
          rows: derived,
        });
      }
    }
    const declared = declarations.map((d) => apiResourceKindName(d.kind));
    db.prepare(
      `UPDATE resources SET list_indexed_at = updated_at
       WHERE list_indexed_at IS NOT updated_at
         AND kind NOT IN (${declared.map(() => "?").join(", ") || "''"})`,
    ).run(...declared);
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
    // Duplicates for one hash are legal — newest wins.
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
  // Schedule runs (fire ledger)
  // ---------------------------------------------------------------------------

  async upsertScheduleFire(record: ScheduleFireRecord): Promise<void> {
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

  async markLatestScheduleFireTerminal(
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

  async listScheduleFires(
    scheduleId: string,
    offset: number,
    limit: number,
  ): Promise<{ fires: ScheduleFireRecord[]; total: number }> {
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
      fires: rows.map((row) => ({
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

  async deleteScheduleFiresBySchedule(scheduleId: string): Promise<number> {
    const db = this.open();
    const result = db
      .prepare(`DELETE FROM schedule_runs WHERE schedule_id = ?`)
      .run(scheduleId);
    return Number(result.changes);
  }

  async deleteScheduleFiresByOrg(org: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM schedule_runs WHERE org = ?`)
      .run(org);
    return Number(result.changes);
  }

  async pruneScheduleFires(recordedBefore: string): Promise<number> {
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

  async deleteSearchIndexByOrg(org: string): Promise<number> {
    if (org === "") {
      return 0;
    }
    const result = this.open()
      .prepare(`DELETE FROM search_index WHERE org = ?`)
      .run(org);
    return Number(result.changes);
  }

  async querySearchIndex(
    query: SearchIndexQuery,
  ): Promise<SearchIndexQueryResult> {
    const db = this.open();

    const kindPlaceholders = query.kinds.map(() => "?").join(",");
    const kindArgs = [...query.kinds];

    // The scope-filter fragments: the org filter, strict (a row is in the
    // requested org or it is not; visibility never widens or narrows the
    // scope), then the authorized-id allowlist.
    const scopeClauses: string[] = [];
    const scopeArgs: string[] = [];
    if (query.orgFilter !== "") {
      scopeClauses.push(`AND org = ?`);
      scopeArgs.push(query.orgFilter);
    }
    if (query.authorizedIdsByKind !== undefined) {
      // The scoping arm: per-kind resource_id allowlists.
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
        kindClauses.length === 0
          ? `AND 1 = 0`
          : `AND (${kindClauses.join(" OR ")})`,
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

    // The interface promises wire-ready scores: normalize bm25
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

/**
 * A row's key rows made equal to its facts, on the caller's open
 * transaction (postgres/store.ts's twin).
 */
function replaceListKeys(
  db: DatabaseSync,
  kindName: string,
  id: string,
  facts: ListIndexFacts,
): void {
  db.prepare(`DELETE FROM resource_list_keys WHERE kind = ? AND id = ?`).run(
    kindName,
    id,
  );
  const insert = db.prepare(
    `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const entry of facts.keys) {
    insert.run(kindName, id, entry.key, entry.value, facts.createdAt);
  }
}

/**
 * One proven read of `queryResources` (postgres/store.ts's twin): through
 * one key's index range when `key` is given, else through the organization
 * index; only rows whose facts are proven current.
 */
function provenReadSql(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
  key: { readonly name: string; readonly value: string } | undefined,
): { sql: string; params: Array<string | number> } {
  const params: Array<string | number> = [];
  const created = key === undefined ? "r.list_created_at" : "k.created_at";
  const id = key === undefined ? "r.id" : "k.id";
  const where: string[] = [];
  let from = `resources AS r`;
  if (key === undefined) {
    where.push(`r.kind = ?`);
    params.push(kindName);
  } else {
    from = `resource_list_keys AS k CROSS JOIN resources AS r`;
    where.push(
      `k.kind = ?`,
      `k.key = ?`,
      `k.value = ?`,
      `r.kind = k.kind`,
      `r.id = k.id`,
    );
    params.push(kindName, key.name, key.value);
  }
  where.push(`r.list_indexed_at = r.updated_at`, `r.list_index_revision = ?`);
  params.push(revision);
  if (query.org !== undefined && query.org !== "") {
    where.push(`r.list_org = ?`);
    params.push(query.org);
  }
  if (query.createdAtOrAfter !== undefined) {
    where.push(`(${created} >= ? OR ${created} = '')`);
    params.push(query.createdAtOrAfter);
  }
  if (query.after !== undefined) {
    where.push(`(${created} < ? OR (${created} = ? AND ${id} < ?))`);
    params.push(query.after.createdAt, query.after.createdAt, query.after.id);
  }
  let limit = "";
  if (query.limit !== undefined) {
    limit = ` LIMIT ?`;
    params.push(query.limit);
  }
  return {
    sql: `SELECT r.id, r.data, ${created} AS created_at FROM ${from}
          WHERE ${where.join(" AND ")}
          ORDER BY ${created} DESC, ${id} DESC${limit}`,
    params,
  };
}

/** A declared kind's facts from stored bytes; undefined when they do not decode. */
function factsOfBytes(
  declaration: ListIndexDeclaration,
  data: Uint8Array,
): ListIndexFacts | undefined {
  try {
    return listIndexFactsOf(declaration, fromBinary(declaration.schema, data));
  } catch {
    return undefined;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("UNIQUE constraint failed")
  );
}

// =============================================================================
// Resource names
// =============================================================================

/** A name row as the driver reads it. */
interface ResourceNameRow {
  kind: string;
  org: string;
  name: string;
  id: string;
  state: string;
  claimed_at: string;
  expires_at: string;
}

const RESOURCE_NAME_COLUMNS =
  "kind, org, name, id, state, claimed_at, expires_at";

function resourceNameEntryOf(row: ResourceNameRow): ResourceNameEntry {
  return {
    kind: row.kind,
    org: row.org,
    name: row.name,
    id: row.id,
    state: row.state === "previous" ? "previous" : "current",
    claimedAt: row.claimed_at,
    expiresAt: row.expires_at,
  };
}

/**
 * The name store, the Postgres driver's in this engine's terms. Every
 * multi-statement write runs in BEGIN IMMEDIATE, which takes the write lock
 * up front, so it also excludes another process on the same file; nothing
 * awaits inside, so nothing interleaves on the one connection.
 */
class SqliteResourceNameStore implements ResourceNameStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async resolve(
    key: ResourceNameKey,
    now: string,
  ): Promise<ResourceNameEntry | undefined> {
    const row = this.open()
      .prepare(
        `SELECT ${RESOURCE_NAME_COLUMNS} FROM resource_names
         WHERE kind = ? AND org = ? AND name = ?
           AND (expires_at = '' OR expires_at > ?)`,
      )
      .get(key.kind, key.org, key.name, now) as ResourceNameRow | undefined;
    return row === undefined ? undefined : resourceNameEntryOf(row);
  }

  async current(
    kind: string,
    org: string,
    id: string,
  ): Promise<ResourceNameEntry | undefined> {
    const row = this.open()
      .prepare(
        `SELECT ${RESOURCE_NAME_COLUMNS} FROM resource_names
         WHERE kind = ? AND org = ? AND id = ? AND state = 'current'`,
      )
      .get(kind, org, id) as ResourceNameRow | undefined;
    return row === undefined ? undefined : resourceNameEntryOf(row);
  }

  async claim(
    key: ResourceNameKey,
    id: string,
    now: string,
  ): Promise<ResourceNameClaim> {
    return this.transaction((db) => {
      removeExpiredName(db, key, now);
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO resource_names (kind, org, name, id, state, claimed_at)
           VALUES (?, ?, ?, ?, 'current', ?)`,
        )
        .run(key.kind, key.org, key.name, id, now);
      if (Number(inserted.changes) === 1) {
        return {
          claimed: true,
          entry: { ...key, id, state: "current", claimedAt: now, expiresAt: "" },
        };
      }
      return { claimed: false, entry: nameHolderOf(db, key) };
    });
  }

  async rename(rename: ResourceNameRename): Promise<ResourceNameRenamed> {
    assertRenameMoves(rename);
    const to = { kind: rename.kind, org: rename.org, name: rename.to };
    return this.transaction((db) => {
      removeExpiredName(db, to, rename.now);
      const takenBack = db
        .prepare(
          `SELECT ${RESOURCE_NAME_COLUMNS} FROM resource_names
           WHERE kind = ? AND org = ? AND name = ? AND id = ?`,
        )
        .get(to.kind, to.org, to.name, rename.id) as ResourceNameRow | undefined;
      const row = db
        .prepare(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at)
           VALUES (?, ?, ?, ?, 'current', ?)
           ON CONFLICT (kind, org, name) DO UPDATE
             SET state = 'current', claimed_at = excluded.claimed_at, expires_at = ''
             WHERE resource_names.id = excluded.id
           RETURNING ${RESOURCE_NAME_COLUMNS}`,
        )
        .get(to.kind, to.org, to.name, rename.id, rename.now) as
        | ResourceNameRow
        | undefined;
      if (row === undefined) {
        return { claimed: false, entry: nameHolderOf(db, to) };
      }
      // Every other current name, not only `from`: a concurrent rename that
      // moved `from` first leaves its own new name current, and this one
      // demotes it too. A name equal to the id is never given an expiry.
      db.prepare(
        `UPDATE resource_names
         SET state = 'previous', claimed_at = ?,
             expires_at = CASE WHEN name = id THEN '' ELSE ? END
         WHERE kind = ? AND org = ? AND id = ?
           AND state = 'current' AND name <> ?`,
      ).run(
        rename.now,
        rename.fromExpiresAt,
        rename.kind,
        rename.org,
        rename.id,
        rename.to,
      );
      return takenBack === undefined
        ? { claimed: true, entry: resourceNameEntryOf(row) }
        : { claimed: true, entry: resourceNameEntryOf(row), takenBack: resourceNameEntryOf(takenBack) };
    });
  }

  async revertRename(
    rename: ResourceNameRename,
    takenBack?: ResourceNameEntry,
  ): Promise<void> {
    this.transaction((db) => {
      if (takenBack === undefined) {
        db.prepare(
          `DELETE FROM resource_names
           WHERE kind = ? AND org = ? AND name = ? AND id = ?`,
        ).run(rename.kind, rename.org, rename.to, rename.id);
      } else {
        db.prepare(
          `UPDATE resource_names SET state = ?, claimed_at = ?, expires_at = ?
           WHERE kind = ? AND org = ? AND name = ? AND id = ?`,
        ).run(
          takenBack.state,
          takenBack.claimedAt,
          takenBack.expiresAt,
          rename.kind,
          rename.org,
          rename.to,
          rename.id,
        );
      }
      // `from` is current again unless a rename that overlapped this one
      // made its own name current meanwhile (postgres/store.ts says why).
      db.prepare(
        `UPDATE resource_names SET state = 'current', expires_at = ''
         WHERE kind = ? AND org = ? AND name = ? AND id = ?
           AND NOT EXISTS (
             SELECT 1 FROM resource_names
             WHERE kind = ? AND org = ? AND id = ? AND state = 'current'
           )`,
      ).run(rename.kind, rename.org, rename.from, rename.id, rename.kind, rename.org, rename.id);
    });
  }

  async release(kind: string, org: string, id: string): Promise<void> {
    this.transaction((db) => {
      db.prepare(
        `DELETE FROM resource_names
         WHERE kind = ? AND org = ? AND id = ? AND name <> id`,
      ).run(kind, org, id);
      db.prepare(
        `UPDATE resource_names SET state = 'previous', expires_at = ''
         WHERE kind = ? AND org = ? AND id = ? AND name = id`,
      ).run(kind, org, id);
    });
  }

  async releaseName(key: ResourceNameKey, id: string): Promise<void> {
    this.open()
      .prepare(
        `DELETE FROM resource_names WHERE kind = ? AND org = ? AND name = ? AND id = ?`,
      )
      .run(key.kind, key.org, key.name, id);
  }

  private transaction<T>(fn: (db: DatabaseSync) => T): T {
    const db = this.open();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** Removes the name's row when it is a previous name that expired by `now`. */
function removeExpiredName(
  db: DatabaseSync,
  key: ResourceNameKey,
  now: string,
): void {
  db.prepare(
    `DELETE FROM resource_names
     WHERE kind = ? AND org = ? AND name = ?
       AND state = 'previous' AND expires_at <> '' AND expires_at <= ?`,
  ).run(key.kind, key.org, key.name, now);
}

/** The row that won a lost write, read inside the losing transaction. */
function nameHolderOf(db: DatabaseSync, key: ResourceNameKey): ResourceNameEntry {
  const row = db
    .prepare(
      `SELECT ${RESOURCE_NAME_COLUMNS} FROM resource_names
       WHERE kind = ? AND org = ? AND name = ?`,
    )
    .get(key.kind, key.org, key.name) as ResourceNameRow | undefined;
  if (row === undefined) {
    throw new Error(
      `resource name '${key.kind}/${key.org}/${key.name}': its holder disappeared during the write`,
    );
  }
  return resourceNameEntryOf(row);
}

// =============================================================================
// Sign-in pending state, registered clients and Connect links
// =============================================================================

const PENDING_OAUTH_STATE_COLUMNS = `state, code_verifier, client_id, client_secret, token_endpoint,
  identity_account_id, auth_method, token_auth_method, redirect_uri, org, vault_id,
  address, login_app, resource, client_registration, connect_link, provider_name,
  userinfo_url, created_at`;

interface PendingOAuthStateRow {
  state: string;
  code_verifier: string;
  client_id: string;
  client_secret: string;
  token_endpoint: string;
  identity_account_id: string;
  auth_method: string;
  token_auth_method: string;
  redirect_uri: string;
  org: string;
  vault_id: string;
  address: string;
  login_app: string;
  resource: string;
  client_registration: string;
  connect_link: string;
  provider_name: string;
  userinfo_url: string;
  created_at: number;
}

class SqlitePendingOAuthStateStore implements PendingOAuthStateStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async save(state: PendingOAuthState): Promise<void> {
    const createdAt =
      state.createdAt !== 0 ? state.createdAt : Math.floor(Date.now() / 1000);
    this.open()
      .prepare(
        `INSERT INTO pending_oauth_state (${PENDING_OAUTH_STATE_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.state,
        state.codeVerifier,
        state.clientId,
        state.clientSecret,
        state.tokenEndpoint,
        state.identityAccountId,
        state.authMethod,
        state.tokenAuthMethod,
        state.redirectUri,
        state.org,
        state.vaultId,
        state.address,
        state.loginApp,
        state.resource,
        state.clientRegistration,
        state.connectLink,
        state.providerName,
        state.userinfoUrl,
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
          `SELECT ${PENDING_OAUTH_STATE_COLUMNS} FROM pending_oauth_state WHERE state = ?`,
        )
        .get(stateParam) as PendingOAuthStateRow | undefined;

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
      return pendingOAuthStateOf(row);
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

  async deleteByOrg(org: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM pending_oauth_state WHERE org = ?`)
      .run(org);
    return Number(result.changes);
  }

  async deleteByConnectLink(tokenHash: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM pending_oauth_state WHERE connect_link = ?`)
      .run(tokenHash);
    return Number(result.changes);
  }
}

function pendingOAuthStateOf(row: PendingOAuthStateRow): PendingOAuthState {
  return {
    state: row.state,
    codeVerifier: row.code_verifier,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    tokenEndpoint: row.token_endpoint,
    identityAccountId: row.identity_account_id,
    authMethod: row.auth_method,
    tokenAuthMethod: row.token_auth_method,
    redirectUri: row.redirect_uri,
    org: row.org,
    vaultId: row.vault_id,
    address: row.address,
    loginApp: row.login_app,
    resource: row.resource,
    clientRegistration: row.client_registration,
    connectLink: row.connect_link,
    providerName: row.provider_name,
    userinfoUrl: row.userinfo_url,
    createdAt: row.created_at,
  };
}

class SqliteOAuthClientRegistrationStore
  implements OAuthClientRegistrationStore
{
  constructor(private readonly open: () => DatabaseSync) {}

  async find(loginServer: string, redirectUri: string): Promise<string | undefined> {
    const row = this.open()
      .prepare(
        `SELECT client_id FROM oauth_client_registration
         WHERE login_server = ? AND redirect_uri = ?`,
      )
      .get(loginServer, redirectUri) as { client_id: string } | undefined;
    return row?.client_id;
  }

  async save(
    loginServer: string,
    redirectUri: string,
    clientId: string,
    now: string,
  ): Promise<string> {
    const db = this.open();
    db.prepare(
      `INSERT OR IGNORE INTO oauth_client_registration
         (login_server, redirect_uri, client_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(loginServer, redirectUri, clientId, now);
    const kept = await this.find(loginServer, redirectUri);
    return kept ?? clientId;
  }

  async forget(loginServer: string, redirectUri: string, clientId: string): Promise<void> {
    this.open()
      .prepare(
        `DELETE FROM oauth_client_registration
         WHERE login_server = ? AND redirect_uri = ? AND client_id = ?`,
      )
      .run(loginServer, redirectUri, clientId);
  }

  async loginServersHolding(clientId: string): Promise<readonly string[]> {
    const rows = this.open()
      .prepare(`SELECT DISTINCT login_server FROM oauth_client_registration WHERE client_id = ?`)
      .all(clientId) as Array<{ login_server: string }>;
    return rows.map((row) => row.login_server);
  }
}

const CONNECT_LINK_COLUMNS =
  "token_hash, org, vault_id, address, return_url, created_by, created_by_class, created_by_bound_org, created_at, expires_at, used_at";

interface ConnectLinkRow {
  token_hash: string;
  org: string;
  vault_id: string;
  address: string;
  return_url: string;
  created_by: string;
  created_by_class: string;
  created_by_bound_org: string;
  created_at: number;
  expires_at: number;
  used_at: number;
}

class SqliteConnectLinkStore implements ConnectLinkStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async create(link: ConnectLinkRecord): Promise<void> {
    this.open()
      .prepare(
        `INSERT INTO connect_link (${CONNECT_LINK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        link.tokenHash,
        link.org,
        link.vaultId,
        link.address,
        link.returnUrl,
        link.createdBy,
        link.createdByClass,
        link.createdByBoundOrg,
        link.createdAt,
        link.expiresAt,
        link.usedAt,
      );
  }

  async findUsable(tokenHash: string, now: number): Promise<ConnectLinkRecord | undefined> {
    const row = this.open()
      .prepare(
        `SELECT ${CONNECT_LINK_COLUMNS} FROM connect_link
         WHERE token_hash = ? AND used_at = 0 AND expires_at > ?`,
      )
      .get(tokenHash, now) as ConnectLinkRow | undefined;
    return row === undefined ? undefined : connectLinkOf(row);
  }

  async spend(tokenHash: string, now: number): Promise<boolean> {
    const result = this.open()
      .prepare(
        `UPDATE connect_link SET used_at = ?
         WHERE token_hash = ? AND used_at = 0 AND expires_at > ?`,
      )
      .run(now, tokenHash, now);
    return Number(result.changes) === 1;
  }

  async restore(tokenHash: string, usedAt: number): Promise<void> {
    this.open()
      .prepare(`UPDATE connect_link SET used_at = 0 WHERE token_hash = ? AND used_at = ?`)
      .run(tokenHash, usedAt);
  }

  async deleteExpired(now: number): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM connect_link WHERE expires_at <= ?`)
      .run(now);
    return Number(result.changes);
  }

  async deleteByVault(vaultId: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM connect_link WHERE vault_id = ?`)
      .run(vaultId);
    return Number(result.changes);
  }

  async deleteByOrg(org: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM connect_link WHERE org = ?`)
      .run(org);
    return Number(result.changes);
  }
}

function connectLinkOf(row: ConnectLinkRow): ConnectLinkRecord {
  return {
    tokenHash: row.token_hash,
    org: row.org,
    vaultId: row.vault_id,
    address: row.address,
    returnUrl: row.return_url,
    createdBy: row.created_by,
    createdByClass: row.created_by_class,
    createdByBoundOrg: row.created_by_bound_org,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    usedAt: Number(row.used_at),
  };
}

const CONNECT_ATTEMPT_COLUMNS =
  "id, org, created_by, person, plugin_id, server, created_at, expires_at";

interface ConnectAttemptRow {
  id: string;
  org: string;
  created_by: string;
  person: string;
  plugin_id: string;
  server: string;
  created_at: number;
  expires_at: number;
}

class SqliteConnectAttemptStore implements ConnectAttemptStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async create(attempt: ConnectAttemptRecord): Promise<void> {
    this.open()
      .prepare(
        `INSERT INTO connect_attempt (${CONNECT_ATTEMPT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.org,
        attempt.createdBy,
        attempt.person,
        attempt.pluginId,
        attempt.server,
        attempt.createdAt,
        attempt.expiresAt,
      );
  }

  async findLive(id: string, now: number): Promise<ConnectAttemptRecord | undefined> {
    const row = this.open()
      .prepare(
        `SELECT ${CONNECT_ATTEMPT_COLUMNS} FROM connect_attempt WHERE id = ? AND expires_at > ?`,
      )
      .get(id, now) as ConnectAttemptRow | undefined;
    return row === undefined ? undefined : connectAttemptOf(row);
  }

  async delete(id: string): Promise<void> {
    this.open().prepare(`DELETE FROM connect_attempt WHERE id = ?`).run(id);
  }

  async deleteExpired(now: number): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM connect_attempt WHERE expires_at <= ?`)
      .run(now);
    return Number(result.changes);
  }

  async deleteByOrg(org: string): Promise<number> {
    const result = this.open()
      .prepare(`DELETE FROM connect_attempt WHERE org = ?`)
      .run(org);
    return Number(result.changes);
  }
}

function connectAttemptOf(row: ConnectAttemptRow): ConnectAttemptRecord {
  return {
    id: row.id,
    org: row.org,
    createdBy: row.created_by,
    person: row.person,
    pluginId: row.plugin_id,
    server: row.server,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

// =============================================================================
// Organization deletions (interface.ts, OrganizationDeletionStore)
// =============================================================================

const ORGANIZATION_DELETION_COLUMNS =
  "org, phase, marked_at, accepted_at, heartbeat_at, stage, last_error";

interface OrganizationDeletionRow {
  org: string;
  phase: string;
  marked_at: string;
  accepted_at: string;
  heartbeat_at: string;
  stage: string;
  last_error: string;
}

class SqliteOrganizationDeletionStore implements OrganizationDeletionStore {
  constructor(private readonly open: () => DatabaseSync) {}

  async mark(org: string, now: string): Promise<boolean> {
    const result = this.open()
      .prepare(
        `INSERT OR IGNORE INTO organization_deletions (org, phase, marked_at)
         VALUES (?, 'pending', ?)`,
      )
      .run(org, now);
    return Number(result.changes) === 1;
  }

  async accept(org: string, now: string): Promise<boolean> {
    const result = this.open()
      .prepare(
        `UPDATE organization_deletions SET phase = 'accepted', accepted_at = ?
         WHERE org = ? AND phase = 'pending'`,
      )
      .run(now, org);
    return Number(result.changes) === 1;
  }

  async unmark(org: string): Promise<boolean> {
    const result = this.open()
      .prepare(
        `DELETE FROM organization_deletions WHERE org = ? AND phase = 'pending'`,
      )
      .run(org);
    return Number(result.changes) === 1;
  }

  async isDeleting(org: string): Promise<boolean> {
    const row = this.open()
      .prepare(`SELECT 1 AS present FROM organization_deletions WHERE org = ?`)
      .get(org);
    return row !== undefined;
  }

  async get(org: string): Promise<OrganizationDeletion | undefined> {
    const row = this.open()
      .prepare(
        `SELECT ${ORGANIZATION_DELETION_COLUMNS} FROM organization_deletions WHERE org = ?`,
      )
      .get(org) as OrganizationDeletionRow | undefined;
    return row === undefined ? undefined : organizationDeletionOf(row);
  }

  async list(): Promise<OrganizationDeletion[]> {
    const rows = this.open()
      .prepare(
        `SELECT ${ORGANIZATION_DELETION_COLUMNS} FROM organization_deletions ORDER BY org`,
      )
      .all() as unknown as OrganizationDeletionRow[];
    return rows.map(organizationDeletionOf);
  }

  async heartbeat(org: string, stage: string, now: string): Promise<void> {
    this.open()
      .prepare(
        `UPDATE organization_deletions SET heartbeat_at = ?, stage = ?, last_error = ''
         WHERE org = ? AND phase = 'accepted'`,
      )
      .run(now, stage, org);
  }

  async recordError(
    org: string,
    stage: string,
    message: string,
    now: string,
  ): Promise<void> {
    this.open()
      .prepare(
        `UPDATE organization_deletions SET heartbeat_at = ?, stage = ?, last_error = ?
         WHERE org = ? AND phase = 'accepted'`,
      )
      .run(now, stage, message, org);
  }

  async release(org: string): Promise<void> {
    this.open()
      .prepare(`DELETE FROM organization_deletions WHERE org = ?`)
      .run(org);
  }
}

function organizationDeletionOf(
  row: OrganizationDeletionRow,
): OrganizationDeletion {
  return {
    org: row.org,
    phase: row.phase === "accepted" ? "accepted" : "pending",
    markedAt: row.marked_at,
    acceptedAt: row.accepted_at,
    heartbeatAt: row.heartbeat_at,
    stage: row.stage,
    lastError: row.last_error,
  };
}
