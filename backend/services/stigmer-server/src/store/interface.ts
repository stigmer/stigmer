/**
 * Storage contract — ports backend/libs/go/store/interface.go
 * surface-for-surface (D2 §3, DD-003).
 *
 * The interface is async even though the phase-1 node:sqlite driver is
 * synchronous: the phase-2 Postgres driver is async by nature, and the
 * contract must be implementable by both (D2 §3, Postgres-reserved seams).
 * The sqlite driver simply resolves immediately.
 *
 * Mechanics are idiomatic TS where Go's are Go-specific: methods RETURN
 * values instead of filling out-params, and message-typed methods take the
 * protobuf-es schema (`DescMessage`) where Go relied on the out-param's
 * runtime type. Method NAMES and semantics mirror Go exactly — during
 * coexistence the Go interface is the behavioral reference, and matching
 * names keep every "is this what Go does?" review one hop away.
 *
 * Three surfaces that Go kept OUTSIDE store.Store are deliberate members
 * here (D2 §3 — the `DB()` escape hatch is not ported; OD-3):
 *   - bootstrapState  — concrete-type-only methods in Go (sqlite/store.go)
 *   - signalDedupe    — pkg/domain/workflowexecution/dedupe (via DB())
 *   - oauthGrants / pendingOAuthStates — pkg/domain/mcpserver/oauth (via DB())
 * They are grouped sub-stores rather than flat methods so their Go method
 * names (claim, markDelivered, release, upsert, find, save, getAndDelete…)
 * survive verbatim for the #19/#20 domain ports.
 *
 * Proven by the driver unit tests (sqlite/__tests__/) and, end-to-end, by
 * every conformance suite on CONFORMANCE_TARGET=local.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

// =============================================================================
// Sentinel errors
// =============================================================================

/**
 * A resource does not exist in the store. Go: store.ErrNotFound, checked
 * with errors.Is; consumers here check with `instanceof`.
 */
export class ResourceNotFoundError extends Error {
  constructor(detail: string) {
    super(`resource not found: ${detail}`);
    this.name = "ResourceNotFoundError";
  }
}

/**
 * An audit record does not exist. Go: store.ErrAuditNotFound.
 */
export class AuditNotFoundError extends Error {
  constructor(detail: string) {
    super(`audit record not found: ${detail}`);
    this.name = "AuditNotFoundError";
  }
}

// =============================================================================
// Record types (interface.go:409-495)
// =============================================================================

/**
 * One archived version, pairing the serialized snapshot with the version's
 * authoritative tag — read from the indexed tag column, never the embedded
 * snapshot (the snapshot's tag is only correct as of archival time; the
 * column stays correct after a SetAuditTag move).
 */
export interface AuditRecord {
  /** Marshaled protobuf snapshot of the archived resource. */
  readonly data: Uint8Array;
  /** SHA256 content hash identifying this version. */
  readonly versionHash: string;
  /** The version's current tag from the tag column ("" when untagged). */
  readonly tag: string;
}

/** Storage representation of a workflow execution event. */
export interface WorkflowExecutionEventRecord {
  readonly executionId: string;
  readonly sequenceNumber: number;
  readonly eventType: string;
  readonly taskName: string;
  /** protobuf-serialized WorkflowExecutionEvent. */
  readonly data: Uint8Array;
  readonly createdAt: string;
}

/**
 * One recorded schedule fire — a fire-ledger row. Outcome and Origin carry
 * the lowercase names of the ai.stigmer.agentic.schedule.v1 enum values
 * ("started", "refused", "cron", "manual", …); timestamps are RFC-3339 UTC
 * strings compared lexicographically (the house convention).
 */
export interface ScheduleRunRecord {
  readonly scheduleId: string;
  readonly org: string;
  /**
   * The fire's identity instant (cron: the scheduled time; manual: the
   * trigger time), whole seconds.
   */
  readonly nominalFireTime: string;
  /** "cron" or "manual". */
  readonly origin: string;
  /**
   * The fire's current verdict: "started", "refused", "target_missing",
   * "skipped", then terminal "completed", "failed", or "timed_out".
   */
  readonly outcome: string;
  /** The refusing gate's or terminal verdict's copy verbatim; empty for healthy outcomes. */
  readonly reason: string;
  /** The created execution, empty when none was created. */
  readonly executionId: string;
  /** When the fire's row was first written ("" lets the driver stamp now). */
  readonly recordedAt: string;
  /**
   * When the terminal outcome landed; empty while the run is in flight (or
   * forever, for fires that created no run — those are terminal at insert
   * and carry their insert time here).
   */
  readonly completedAt: string;
}

/**
 * Searchable fields extracted from a resource for the search index.
 * Extraction is per-domain (each domain registers its extractor); the
 * store only persists what it is handed.
 */
export interface SearchIndexEntry {
  /** Display name (metadata.name) — every driver weights it highest for relevance. */
  readonly name: string;
  /** Description; source field varies by resource type. */
  readonly description: string;
  /** Space-separated tags (metadata.tags) — the index carries one tags string. */
  readonly tags: string;
  /** Owning org (metadata.org) — org-scoped filtering. */
  readonly org: string;
  /**
   * Visibility enum NAME (e.g. "visibility_public"); scope filtering only
   * special-cases "visibility_public", all other levels are org-scoped.
   */
  readonly visibility: string;
  /** Unix seconds creation time — sorting in list mode (no query). */
  readonly createdAt: number;
}

/**
 * Parameters for one search-index read, stated engine-neutrally (DD-009:
 * each driver renders its own engine's query syntax; OD-3: the SQL lives
 * in the driver, the search service composes criteria). The caller
 * guarantees `kinds` is non-empty — the empty effective-kind set
 * short-circuits ABOVE the store (stigmer/stigmer#440), never as an
 * `IN ()` syntax accident here.
 */
export interface SearchIndexQuery {
  /** Kind NAME strings (the search_index.kind column values). */
  readonly kinds: readonly string[];
  /**
   * The user's whitespace-tokenized query terms (search mode), or
   * undefined for list mode (created_at ordering, score pinned 1.0).
   * Declared semantics every driver implements: each term matches as a
   * token (engine tokenization/stemming is driver-relative); a SINGLE
   * term is a prefix match; multiple terms compose with AND. Rendering
   * the engine's syntax — including sanitizing hostile term content — is
   * the driver's job (sqlite: `sqlite/fts5.ts`).
   */
  readonly terms: readonly string[] | undefined;
  /** Org scope; "" = no org filter. */
  readonly orgFilter: string;
  /** With orgFilter: also admit visibility_public rows from ANY org. */
  readonly crossOrgPublic: boolean;
  /** Independent subtraction: drop visibility_public rows from any scope. */
  readonly excludePublic: boolean;
  readonly limit: number;
  readonly offset: number;
}

/** One page row of a search-index read, in result order. */
export interface SearchIndexHit {
  /** Kind NAME string as stored (parsed back to the enum by the caller). */
  readonly kind: string;
  readonly resourceId: string;
  /**
   * Wire-ready relevance: 0–1, higher = better, exactly 1.0 in list
   * mode. Each driver normalizes from its own engine's ranking; absolute
   * values and cross-driver ordering are NOT contract — only
   * deterministic ordering WITHIN a driver is (DD-009; the driver-side
   * normalization is this sub-project's DD-001).
   */
  readonly score: number;
}

/** A search-index read: full counts plus the requested page. */
export interface SearchIndexQueryResult {
  /** Total matches per kind NAME (GROUP BY kind — zero-count kinds absent). */
  readonly countsByKind: Record<string, number>;
  /** Sum of countsByKind values. */
  readonly totalCount: number;
  /** The requested page, empty when totalCount is 0 (count short-circuit). */
  readonly hits: readonly SearchIndexHit[];
}

// =============================================================================
// Bootstrap state (Go: concrete-type methods, sqlite/store.go:1480-1611)
// =============================================================================

/**
 * Key-value state for idempotent seedpack bootstrap. Common keys:
 * "seedpack_version", "bootstrap_status", "skill:<name>", "agent:<name>".
 */
export interface BootstrapStateStore {
  /** Returns "" (not an error) when the key does not exist — Go's contract. */
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
  getAll(): Promise<Map<string, string>>;
  /** No error if the key does not exist. */
  delete(key: string): Promise<void>;
  /** Removes all entries (testing / forced re-bootstrap). */
  clear(): Promise<void>;
}

// =============================================================================
// Signal dedupe (Go: pkg/domain/workflowexecution/dedupe, Gap B2 / oss#442)
// =============================================================================

/**
 * How long a claim holds an idempotency key while its delivery is in
 * flight (5 minutes).
 *
 * Derived, not guessed (Go signal_dedupe_store.go:452-463): both Temporal
 * SDKs retry client RPCs internally for up to 1 minute by default, and
 * neither edition overrides it — so a send that ultimately fails can still
 * be in flight ~60s after the claim landed. Five minutes gives 5x margin.
 * Shortening this below the SDKs' retry expiration would let a retry claim
 * a key whose original send is still in flight — the double delivery this
 * store exists to prevent.
 */
export const IN_FLIGHT_CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * How long a DELIVERED key blocks duplicates, anchored at delivery time
 * (24 hours) — markDelivered extends the record's expiry to this window
 * (the dedupe window is EARNED at delivery, oss#442). Matches industry
 * standards like Stripe's idempotency key retention.
 */
export const DELIVERED_SIGNAL_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

export type SignalDedupeStatus = "CLAIMED" | "DELIVERED";

/** A deduplicated signal record (id = "{org}:{idempotency_key}"). */
export interface SignalDedupeRecord {
  readonly id: string;
  readonly org: string;
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly signalName: string;
  readonly status: SignalDedupeStatus;
  /** RFC-3339 claim time. */
  readonly createdAt: string;
  /** RFC-3339 delivery time; "" if not yet delivered. */
  readonly deliveredAt: string;
  /** RFC-3339 expiry after which the key can be reused. */
  readonly expiresAt: string;
}

export type ClaimStatus = "SUCCESS" | "DUPLICATE";

export interface ClaimResult {
  readonly status: ClaimStatus;
  /** The existing record when status is DUPLICATE; undefined on SUCCESS. */
  readonly record?: SignalDedupeRecord;
}

/**
 * Two-phase idempotency-key hold (oss#442, shared contract with the cloud
 * edition): a claim holds the key only for IN_FLIGHT_CLAIM_TTL_MS;
 * markDelivered extends the winner to DELIVERED_SIGNAL_DEDUPE_TTL_MS. A
 * delivery that fails or crashes frees the key when the short hold lapses
 * (expired-row cleanup is the recovery path) instead of poisoning it
 * against the caller's retry for 24 hours.
 */
export interface SignalDedupeStore {
  /**
   * Atomically claims an idempotency key. On conflict returns the existing
   * record — the caller branches on its status (a live CLAIMED holder means
   * an in-flight conflict; DELIVERED means a true duplicate).
   */
  claim(
    org: string,
    idempotencyKey: string,
    executionId: string,
    signalName: string,
    ttlMs: number,
  ): Promise<ClaimResult>;
  /**
   * Flips a CLAIMED record to DELIVERED and extends its hold to
   * DELIVERED_SIGNAL_DEDUPE_TTL_MS from now. Tolerant: a missing or
   * already-delivered record is a no-op (keeps a takeover's fresh claim
   * intact in either commit order of a pathologically late mark racing a
   * takeover).
   */
  markDelivered(org: string, idempotencyKey: string): Promise<void>;
  /**
   * Frees a CLAIMED key whose delivery failed so the caller's retry can
   * claim immediately. Status-guarded: a DELIVERED record (or a missing
   * one) is a tolerant no-op — a misplaced release can never unblock a key
   * that was actually delivered.
   */
  release(org: string, idempotencyKey: string): Promise<void>;
}

// =============================================================================
// MCP OAuth (Go: pkg/domain/mcpserver/oauth, tables consolidated by v7 / OD-3)
// =============================================================================

/**
 * OAuth grant infrastructure record — not an API resource; keyed by
 * (identityAccountId, resourceId, orgId). Resource-agnostic: resourceId can
 * refer to any kind that requires OAuth credentials.
 */
export interface OAuthGrant {
  readonly identityAccountId: string;
  readonly resourceId: string;
  /** e.g. "mcp_server", "workflow". */
  readonly resourceKind: string;
  readonly orgId: string;
  /** Unix seconds. */
  readonly accessTokenExpiresAt: number;
  readonly clientId: string;
  /** "mcp_oauth" or "vendor_oauth". */
  readonly authMethod: string;
  readonly tokenEndpoint: string;
  readonly accessTokenEnvVar: string;
  readonly refreshTokenEnvVar: string;
  readonly environmentId: string;
  /** Unix seconds; 0 lets the driver stamp now on first insert. */
  readonly createdAt: number;
  /** Unix seconds; the driver stamps now on every upsert. */
  readonly updatedAt: number;
}

export interface OAuthGrantStore {
  upsert(grant: OAuthGrant): Promise<void>;
  /** Returns undefined (not an error) when no grant exists. */
  find(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<OAuthGrant | undefined>;
  delete(
    identityAccountId: string,
    resourceId: string,
    orgId: string,
  ): Promise<void>;
}

/**
 * How long a pending OAuth state survives between initiateOAuthConnect and
 * completeOAuthConnect (10 minutes, Go pending_state_store.go).
 */
export const PENDING_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Ephemeral state between initiateOAuthConnect and completeOAuthConnect.
 * codeVerifier and clientSecret rest SEALED (enc:v1:) — the controllers
 * seal/unseal at their seams (oss#394); the store persists whatever bytes
 * it is handed, byte-faithfully.
 */
export interface PendingOAuthState {
  /** Random; lookup key + CSRF protection. */
  readonly state: string;
  /** PKCE verifier, needed for token exchange; sealed at rest. */
  readonly codeVerifier: string;
  readonly clientId: string;
  /** Empty for DCR/public clients; sealed at rest when non-empty. */
  readonly clientSecret: string;
  readonly tokenEndpoint: string;
  readonly mcpServerId: string;
  readonly identityAccountId: string;
  readonly targetEnvVar: string;
  /** "mcp_oauth" or "vendor_oauth". */
  readonly authMethod: string;
  /** RFC 8414 string from OAuthAppSpec; empty for DCR. */
  readonly tokenAuthMethod: string;
  readonly redirectUri: string;
  /** Caller's org for personal environment resolution. */
  readonly org: string;
  /** Unix seconds; 0 lets the driver stamp now. */
  readonly createdAt: number;
}

export interface PendingOAuthStateStore {
  save(state: PendingOAuthState): Promise<void>;
  /**
   * Atomically retrieves and deletes a state by its state parameter.
   * Returns undefined when no state exists OR it has expired (an expired
   * row is deleted on the way out).
   */
  getAndDelete(stateParam: string): Promise<PendingOAuthState | undefined>;
  /** Removes all expired states; returns the count removed. */
  cleanupExpired(): Promise<number>;
}

// =============================================================================
// The store contract
// =============================================================================

/**
 * Contract for resource persistence. Two distinct areas: live resources
 * (saveResource/getResource/…) and immutable audit snapshots
 * (saveAudit/getAuditByHash/…). "Cascade" cleanup of audit records is
 * EXPLICIT via deleteAuditByResourceId — despite historical comments, no
 * foreign key exists on resource_audit (verified in Go's v2 DDL).
 */
export interface Store {
  // ---------------------------------------------------------------------------
  // Resource operations (live/current state)
  // ---------------------------------------------------------------------------

  /** Upserts a resource (INSERT OR REPLACE on (kind, id)). */
  saveResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
    msg: MessageShape<Desc>,
  ): Promise<void>;

  /** Retrieves a resource; throws ResourceNotFoundError if absent. */
  getResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>>;

  /**
   * Atomic read-modify-write: reads the resource, applies `modify` (which
   * mutates the message in place), persists the result — all inside a
   * write transaction (BEGIN IMMEDIATE) so concurrent updates never
   * overwrite each other (D2 §2; load-then-save stays banned in status
   * paths carrying append-only event streams).
   *
   * `modify` MUST be synchronous: the sqlite driver holds an open write
   * transaction on the sole connection while it runs, and an `await` in
   * the middle would let interleaved statements from other requests join
   * that transaction. Throwing from `modify` skips the write and
   * propagates the error. Throws ResourceNotFoundError if absent.
   * Returns the persisted message.
   */
  updateResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
    modify: (msg: MessageShape<Desc>) => void,
  ): Promise<MessageShape<Desc>>;

  /**
   * All resources of a kind as marshaled protobuf bytes; empty array (not
   * undefined) when none exist. Live resources only, never audit records.
   */
  listResources(kind: ApiResourceKind): Promise<Uint8Array[]>;

  /** Removes a resource; NO error if it does not exist. */
  deleteResource(kind: ApiResourceKind, id: string): Promise<void>;

  /**
   * Finds a single resource whose field at `fieldPath` (dot notation, e.g.
   * "spec.executionId"; camelCase parts fall back to snake_case) equals
   * `value`. Full-scan + proto reflection, exactly as Go — indexability is
   * guaranteed at the interface, physical indexing is the phase-2 driver's
   * concern (D2 §3). Throws ResourceNotFoundError if none match.
   */
  findByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>>;

  /**
   * Go-parity quirk, preserved deliberately (sub-project DD-001): despite
   * the name, this returns ALL rows of the kind, UNFILTERED — Go's driver
   * cannot unmarshal without the concrete type, so every Go caller filters
   * client-side and the TS ports of those callers translate mechanically
   * only if this driver behaves identically (verified Go behavior,
   * sqlite/store.go:896-899). A both-editions fix is filed for after
   * cutover, when Go stops being the translation reference.
   */
  findAllByField(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
  ): Promise<Uint8Array[]>;

  /**
   * All resources whose metadata.labels[labelKey] === labelValue, as
   * marshaled bytes. There is deliberately no single-result variant: the
   * scan has no ordering, so "first match" is row-insertion-order
   * nondeterminism in disguise (stigmer/stigmer#356). Callers that need
   * one winner own an explicit, documented tie-break over the full set.
   */
  findAllByLabel<Desc extends DescMessage>(
    kind: ApiResourceKind,
    labelKey: string,
    labelValue: string,
    schema: Desc,
  ): Promise<Uint8Array[]>;

  /** Removes all resources of a kind; returns the count deleted. */
  deleteResourcesByKind(kind: ApiResourceKind): Promise<number>;

  /**
   * Removes resources whose id starts with idPrefix (GLOB).
   * @deprecated Legacy prefix-key compatibility only — use audit methods.
   */
  deleteResourcesByIdPrefix(
    kind: ApiResourceKind,
    idPrefix: string,
  ): Promise<number>;

  // ---------------------------------------------------------------------------
  // Audit operations (version history)
  // ---------------------------------------------------------------------------

  /** Archives an immutable snapshot; every call creates a new record. */
  saveAudit<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    schema: Desc,
    msg: MessageShape<Desc>,
    versionHash: string,
    tag: string,
  ): Promise<void>;

  /** Snapshot by exact hash; throws AuditNotFoundError if absent. */
  getAuditByHash<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>>;

  /** Most recent snapshot holding the tag; throws AuditNotFoundError if absent. */
  getAuditByTag<Desc extends DescMessage>(
    kind: ApiResourceKind,
    resourceId: string,
    tag: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>>;

  /** All snapshots, newest first; empty array when none exist. */
  listAuditHistory(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<Uint8Array[]>;

  /** Removes all audit records for a resource; returns the count. */
  deleteAuditByResourceId(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<number>;

  /** Count of audit records; 0 (not an error) when none exist. */
  countAuditEntries(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<number>;

  /**
   * Version hash of the most recent audit record (archived_at DESC, id
   * DESC tiebreak); throws AuditNotFoundError if none exist.
   */
  getLatestAuditHash(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<string>;

  /**
   * Moves a tag to a specific archived version, atomically — the ONE
   * primitive through which a resource's tag is ever (re)assigned (used by
   * both apply-time tagging and the tagVersion RPC, so the two paths can
   * never diverge into an "append vs. single-holder" split). Clears the
   * tag from its prior holder and assigns it to the target in a single
   * transaction; the tag COLUMN (not the snapshot blob) is the source of
   * truth. Throws AuditNotFoundError when no record has versionHash — the
   * rollback leaves the prior holder untouched, so a missing target never
   * orphans the tag (#341 head-repoint semantics).
   */
  setAuditTag(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
    tag: string,
  ): Promise<void>;

  /**
   * All archived versions, newest first, each carrying its authoritative
   * tag from the tag column. Prefer this over listAuditHistory when the
   * caller needs the tag.
   */
  listAuditRecords(
    kind: ApiResourceKind,
    resourceId: string,
  ): Promise<AuditRecord[]>;

  /**
   * Single archived version by exact hash, authoritative tag included.
   * Duplicate rows for one (kind, resourceId, versionHash) are LEGAL data
   * (skill re-push archives prior content as a fresh row; pre-#341
   * workflow rows) — newest wins, matching every other audit read
   * (stigmer/stigmer-cloud#191). Throws AuditNotFoundError if absent.
   */
  getAuditRecordByHash(
    kind: ApiResourceKind,
    resourceId: string,
    versionHash: string,
  ): Promise<AuditRecord>;

  /**
   * The archived version currently holding the tag (single-holder
   * invariant; archived_at DESC is a defensive tiebreak for legacy
   * multi-holder data). Throws AuditNotFoundError if absent.
   */
  getAuditRecordByTag(
    kind: ApiResourceKind,
    resourceId: string,
    tag: string,
  ): Promise<AuditRecord>;

  // ---------------------------------------------------------------------------
  // Workflow execution events
  // ---------------------------------------------------------------------------

  /**
   * Appends events insert-or-skip, first-writer-wins: an event whose
   * (executionId, sequenceNumber) is already persisted is silently skipped
   * while the rest of the batch lands. Retried batches are idempotent (the
   * runner assigns sequence numbers deterministically) and out-of-order
   * arrival from parallel branches is valid, not stale — replaces the
   * all-or-nothing stale-sequence rejection that dropped whole batches on
   * retry (oss#308); same contract as the cloud edition's ON CONFLICT DO
   * NOTHING. Returns the number actually inserted.
   */
  appendWorkflowExecutionEvents(
    executionId: string,
    events: readonly WorkflowExecutionEventRecord[],
  ): Promise<number>;

  /**
   * Cursor-paginated events: sequenceNumber > afterSequence, optional
   * eventType / taskName filters ("" = all), limit <= 0 defaults to 100.
   */
  getWorkflowExecutionEvents(
    executionId: string,
    afterSequence: number,
    eventType: string,
    taskName: string,
    limit: number,
  ): Promise<WorkflowExecutionEventRecord[]>;

  /** Highest sequenceNumber for an execution; 0 when no events exist. */
  getMaxEventSequence(executionId: string): Promise<number>;

  // ---------------------------------------------------------------------------
  // Schedule runs (fire ledger — every fire leaves a row, incl. fires that
  // created no execution: the only durable trace of a refused launch gate
  // below the auto-pause threshold; stigmer-cloud project DD-017 D-7)
  // ---------------------------------------------------------------------------

  /**
   * Inserts or updates the fire's ledger row, keyed on (scheduleId,
   * nominalFireTime, origin). Terminal-immutable: a row whose completedAt
   * is set is never downgraded — a replayed "started" write after the
   * verdict landed is a no-op by construction (the ON CONFLICT guard).
   */
  upsertScheduleRun(record: ScheduleRunRecord): Promise<void>;

  /**
   * Stamps the terminal verdict on the schedule's NEWEST non-terminal row
   * of the given origin. Keyed on (schedule, origin) by design: the
   * verdict-writing activities receive only the schedule id (signatures
   * pinned by recorded Temporal histories), and the artifact's SKIP
   * overlap plus the spanning tick guarantee at most one in-flight CRON
   * run per schedule. The origin filter is load-bearing: manual fires are
   * untracked, so without it a newer manual row would steal a cron run's
   * verdict. Silent no-op when no matching non-terminal row exists.
   */
  markLatestScheduleRunTerminal(
    scheduleId: string,
    origin: string,
    outcome: string,
    reason: string,
    completedAt: string,
  ): Promise<void>;

  /** Recorded fires, newest first, plus the total count for pagination. */
  listScheduleRuns(
    scheduleId: string,
    offset: number,
    limit: number,
  ): Promise<{ runs: ScheduleRunRecord[]; total: number }>;

  /** Delete-cascade twin, called after the resource row delete succeeds. */
  deleteScheduleRunsBySchedule(scheduleId: string): Promise<number>;

  /**
   * Removes ledger rows recorded before the cutoff (RFC-3339, compared
   * lexicographically) — the retention policy the table was born with.
   */
  pruneScheduleRuns(recordedBefore: string): Promise<number>;

  // ---------------------------------------------------------------------------
  // Search index
  // ---------------------------------------------------------------------------

  /**
   * Inserts or replaces a resource's search-index row (how "replace" is
   * implemented is driver-internal). Maintained explicitly by the write
   * pipelines (IndexSearch step), decoupled from the resources table.
   */
  upsertSearchIndex(
    kind: ApiResourceKind,
    resourceId: string,
    entry: SearchIndexEntry,
  ): Promise<void>;

  /** Removes a resource's search-index row (post-delete). */
  deleteSearchIndex(kind: ApiResourceKind, resourceId: string): Promise<void>;

  /**
   * One search-index read: full counts per kind, short-circuiting to an
   * empty page at zero matches, then the ranked page — order is
   * deterministic within the driver (relevance in search mode, newest
   * first in list mode). Engine query syntax and score normalization are
   * rendered INSIDE the driver from the structured query (DD-009; OD-3:
   * no DB() escape hatch — the driver owns the SQL, the search service
   * owns criteria and conversion).
   */
  querySearchIndex(query: SearchIndexQuery): Promise<SearchIndexQueryResult>;

  /**
   * Empties the search index (RebuildIndex's wipe before re-indexing from
   * the resources table — Go's `DELETE FROM search_index`).
   */
  clearSearchIndex(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Consolidated sub-stores (D2 §3 — inside the boundary, no DB() hatch)
  // ---------------------------------------------------------------------------

  readonly bootstrapState: BootstrapStateStore;
  readonly signalDedupe: SignalDedupeStore;
  readonly oauthGrants: OAuthGrantStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Releases all resources; every other method errors afterwards. */
  close(): Promise<void>;
}
