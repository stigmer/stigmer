/**
 * Storage contract — ports backend/libs/go/store/interface.go
 * surface-for-surface.
 *
 * The interface is async even though the node:sqlite driver is
 * synchronous: the Postgres driver is async by nature, and the contract
 * must be implementable by both.
 * The sqlite driver simply resolves immediately.
 *
 * Mechanics are idiomatic TS where Go's are Go-specific: methods RETURN
 * values instead of filling out-params, and message-typed methods take the
 * protobuf-es schema (`DescMessage`) where Go relied on the out-param's
 * runtime type. Method NAMES and semantics mirror Go exactly — during
 * coexistence the Go interface is the behavioral reference, and matching
 * names keep every "is this what Go does?" review one hop away.
 *
 * Two surfaces that Go kept OUTSIDE store.Store are deliberate members
 * here (the `DB()` escape hatch is not ported):
 *   - bootstrapState  — concrete-type-only methods in Go (sqlite/store.go)
 *   - pendingOAuthStates — pkg/domain/mcpserver/oauth (via DB())
 * They are grouped sub-stores rather than flat methods so their Go method
 * names (upsert, find, save, getAndDelete…) survive verbatim for the
 * domain ports.
 *
 * Proven by the driver unit tests (sqlite/__tests__/) and, end-to-end, by
 * every conformance suite on CONFORMANCE_TARGET=local.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  ListIndexDeclaration,
  ListIndexQuery,
  ListIndexRow,
} from "./list-index.js";

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

/**
 * One recorded schedule fire — a fire-ledger row. Outcome and Origin carry
 * the lowercase names of the ai.stigmer.agentic.schedule.v1 enum values
 * ("started", "refused", "cron", "manual", …); timestamps are RFC-3339 UTC
 * strings compared lexicographically (the house convention).
 */
export interface ScheduleFireRecord {
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
   * Visibility enum NAME (e.g. "visibility_org"), carried for display;
   * scope filtering is by org and by the authorized-id map, never by
   * this column.
   */
  readonly visibility: string;
  /** Unix seconds creation time — sorting in list mode (no query). */
  readonly createdAt: number;
}

/**
 * Parameters for one search-index read, stated engine-neutrally (each
 * driver renders its own engine's query syntax; the SQL lives in the
 * driver, the search service composes criteria). The caller
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
  /**
   * Optional per-kind authorized-id allowlist (kind NAME → ids) — the
   * multi-tenant list-read scoping arm: a listed kind
   * matches only rows whose resource_id is in its set, and an EMPTY set
   * matches nothing for that kind (each driver renders it without ever
   * emitting an `IN ()` accident); kinds absent from the map are
   * unrestricted. Undefined = no scoping — byte-identical to the
   * pre-seam query. The filter must apply to BOTH statements (counts and
   * page), exactly like the org/visibility scope fragments.
   */
  readonly authorizedIdsByKind?:
    | ReadonlyMap<string, ReadonlySet<string>>
    | undefined;
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
   * deterministic ordering WITHIN a driver is.
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
 * Key-value state for one-shot boot work that must run once per database.
 * Two writers today: the membership rules' reconciliations
 * (`iampolicy/constants.ts` ROLES_RECONCILED_KEY and
 * SERVER_ORGANIZATION_ROLES_KEY) and the boot step that makes a
 * one-organization server's organization (`domain/organization/limit.ts`
 * SINGLE_ORG_KEY). A database migrated
 * from the Go server carries that server's bootstrap keys too; the
 * migration preserves them (see sqlite/__tests__/migrations.test.ts) and
 * nothing reads them.
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
// Resource names (the names a resource answers to)
// =============================================================================

/** Whether a name is what its resource is called now, or what it was called before a rename. */
export type ResourceNameState = "current" | "previous";

/** Where a name is unique: a kind, and the organization it is unique in ("" across the server). */
export interface ResourceNameKey {
  /** The kind's enum name, as the `resources` table's `kind` column holds it ("organization"). */
  readonly kind: string;
  /** The owning organization's id, or "" for a name unique across the server (an organization's own). */
  readonly org: string;
  readonly name: string;
}

/**
 * One name a resource answers to. A resource has one `current` name, its
 * slug, and any `previous` names its renames left, each held until
 * `expiresAt` so the old name keeps resolving to it and nobody else can
 * take it meanwhile.
 */
export interface ResourceNameEntry extends ResourceNameKey {
  /** The resource the name resolves to. */
  readonly id: string;
  readonly state: ResourceNameState;
  /** RFC-3339 time the name was taken, or, for a previous name, the rename that left it. */
  readonly claimedAt: string;
  /** RFC-3339 time a previous name stops resolving and is free; "" for a current name and for one held for good. */
  readonly expiresAt: string;
}

/** A claim's outcome: won with its entry, or lost to the entry that holds the name. */
export type ResourceNameClaim =
  | { readonly claimed: true; readonly entry: ResourceNameEntry }
  | { readonly claimed: false; readonly entry: ResourceNameEntry };

/**
 * A rename's outcome, as a claim's. A won rename that took back one of the
 * resource's own previous names carries that name as it stood before
 * (`takenBack`), so a move back can restore it rather than let it go.
 */
export type ResourceNameRenamed =
  | {
      readonly claimed: true;
      readonly entry: ResourceNameEntry;
      readonly takenBack?: ResourceNameEntry;
    }
  | { readonly claimed: false; readonly entry: ResourceNameEntry };

/** One rename: `id`'s current name `from` becomes `to`. */
export interface ResourceNameRename {
  readonly kind: string;
  readonly org: string;
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /**
   * When the names this rename demotes stop resolving; "" holds them for
   * good. A name equal to `id` is held for good whatever this says: it is
   * the id an earlier release filed the resource's rows under.
   */
  readonly fromExpiresAt: string;
  /** RFC-3339 now, the instant expiry is judged against. */
  readonly now: string;
}

/**
 * The names resources answer to, and which resource each resolves to.
 * Only organizations write it today: their slugs are names here, unique
 * across the server, while the organization is filed under its minted id.
 *
 * The table, not the resource row, decides "taken". A claim is a create's
 * uniqueness guarantee, which the row cannot give: `saveResource` upserts,
 * so two creates that both read "absent" would otherwise both write, the
 * second over the first.
 *
 * Expiry is lazy: an expired previous name is ignored by `resolve` and
 * removed by the write that takes it, so nothing sweeps. Every time is
 * passed in as an RFC-3339 string, so a caller (and a test) decides "now".
 */
export interface ResourceNameStore {
  /** The name's live entry at `now` (current, or previous and unexpired), or undefined when nothing holds it. */
  resolve(key: ResourceNameKey, now: string): Promise<ResourceNameEntry | undefined>;
  /** The current name `id` holds in the kind and scope, or undefined when it holds none. */
  current(kind: string, org: string, id: string): Promise<ResourceNameEntry | undefined>;
  /**
   * Takes the name as `id`'s current name when nothing holds it at `now`,
   * atomically: of concurrent claims, exactly one wins, and an expired
   * previous name is removed in the same write. A loser receives the entry
   * that holds the name.
   */
  claim(key: ResourceNameKey, id: string, now: string): Promise<ResourceNameClaim>;
  /**
   * Moves `id`'s current name from `from` to `to` in one transaction: `to`
   * becomes current (taken fresh, or taken back when it is one of `id`'s
   * own previous names) and every other current name of `id`, `from`
   * included, becomes previous until `fromExpiresAt`, so `id` is left with
   * exactly one current name however renames interleave. Lost, with
   * nothing changed, when another resource holds `to`.
   */
  rename(rename: ResourceNameRename): Promise<ResourceNameRenamed>;
  /**
   * Undoes a rename whose resource write failed: `to` is let go, or, when
   * the rename took it back (`takenBack`, from the rename's outcome),
   * restored to that earlier state; and `from` is current again, unless a
   * rename that overlapped this one has made its own name current since,
   * which stands. Idempotent.
   */
  revertRename(rename: ResourceNameRename, takenBack?: ResourceNameEntry): Promise<void>;
  /**
   * Lets go of every name `id` holds in the kind and scope (its delete, or a
   * create whose row never landed). A name equal to `id` is kept, as a
   * previous name that never expires: a resource from an earlier release
   * was filed under it. Idempotent.
   */
  release(kind: string, org: string, id: string): Promise<void>;
  /** Lets go of one name while `id` holds it (a resource that holds several and drops one). Idempotent. */
  releaseName(key: ResourceNameKey, id: string): Promise<void>;
}

// =============================================================================
// Organization deletions (the organizations being deleted)
// =============================================================================

/**
 * Where an organization's delete stands. `pending`: its delete request
 * has marked it and is still running its refusals and its revocations;
 * `accepted`: the request answered, and the purge owns it until the
 * row is gone.
 */
export type OrganizationDeletionPhase = "pending" | "accepted";

/** One organization being deleted, as its row in the deletion table holds it. */
export interface OrganizationDeletion {
  readonly org: string;
  readonly phase: OrganizationDeletionPhase;
  /** RFC-3339 time the delete marked it. */
  readonly markedAt: string;
  /** RFC-3339 time the delete was accepted; "" while pending. */
  readonly acceptedAt: string;
  /** RFC-3339 time a purge last reported progress; "" before one took it. */
  readonly heartbeatAt: string;
  /** The purge stage last reported; "" before one took it. */
  readonly stage: string;
  /** The last fault's fixed copy; "" when the last pass succeeded. */
  readonly lastError: string;
}

/**
 * The organizations being deleted, one row each, kept apart from the
 * organization's own row on purpose: request-path writes to a resource
 * row are upserts of what the chain loaded, so a deleting state written
 * into the organization's row would be erased by any update that loaded
 * it first. Nothing but the delete and the purge writes this table, and
 * every transition is one conditional statement, so of two racing
 * writers exactly one wins.
 *
 * The whole table is the set of organizations that answer "not found".
 * A row goes when the purge has removed everything else, last.
 */
export interface OrganizationDeletionStore {
  /** Marks `org` pending; false, with nothing changed, when a row for it exists. */
  mark(org: string, now: string): Promise<boolean>;
  /** Moves `org` from pending to accepted; false when it is not pending. */
  accept(org: string, now: string): Promise<boolean>;
  /** Removes `org`'s row while it is pending (a refused or failed delete); false when it is not pending. */
  unmark(org: string): Promise<boolean>;
  /** Whether `org` has a row, in either phase: one primary-key read. */
  isDeleting(org: string): Promise<boolean>;
  /** `org`'s row, or undefined. */
  get(org: string): Promise<OrganizationDeletion | undefined>;
  /** Every organization being deleted, in either phase, ordered by org. */
  list(): Promise<OrganizationDeletion[]>;
  /** Records a purge's progress on an accepted row: the stage and the time; clears the last error. No-op on any other row. */
  heartbeat(org: string, stage: string, now: string): Promise<void>;
  /** Records a purge fault's fixed copy on an accepted row, with the time. No-op on any other row. */
  recordError(org: string, stage: string, message: string, now: string): Promise<void>;
  /** Removes `org`'s row whatever its phase: the purge's last write. Idempotent. */
  release(org: string): Promise<void>;
}

// =============================================================================
// MCP OAuth (Go: pkg/domain/mcpserver/oauth, tables consolidated by migration v7;
// the grant table retired when sign-ins moved into vault connections)
// =============================================================================

/**
 * How long a pending OAuth state survives between a sign-in's start and
 * its completion (10 minutes, Go pending_state_store.go).
 */
export const PENDING_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Ephemeral state between a sign-in's start and its completion
 * (domain/vault/sign-in/start.ts and complete.ts). codeVerifier and
 * clientSecret rest SEALED (enc:v1:): the sign-in seals and unseals at its
 * seams (oss#394); the store persists whatever bytes it is handed,
 * byte-faithfully.
 */
export interface PendingOAuthState {
  /** Random; lookup key + CSRF protection. */
  readonly state: string;
  /** PKCE verifier, needed for token exchange; sealed at rest. */
  readonly codeVerifier: string;
  readonly clientId: string;
  /** Empty for a public client; sealed at rest when non-empty. */
  readonly clientSecret: string;
  readonly tokenEndpoint: string;
  /** The signer: the caller who started the sign-in; "" for a Connect link's, which has none. */
  readonly identityAccountId: string;
  /** "mcp_oauth" (the address's own login server) or "vendor_oauth" (a login app). */
  readonly authMethod: string;
  /** RFC 8414 string for a login app's secret; empty for a public client. */
  readonly tokenAuthMethod: string;
  readonly redirectUri: string;
  /** The organization the vault the sign-in saves into belongs to. */
  readonly org: string;
  /**
   * The vault the sign-in saves into, by id; "" saves into the signer's My
   * vault in `org`. Recorded at start, re-authorized at completion.
   */
  readonly vaultId: string;
  /** The normalized address the login is saved at (domain/vault/address.ts). */
  readonly address: string;
  /** The login app used ("org:<id>", "stigmer:<key>"), "" for a public client of the address's own login server. */
  readonly loginApp: string;
  /** The `resource` sent to the login server (RFC 8707), sent again at the exchange; "" through a login app. */
  readonly resource: string;
  /** The login server a cached registered client belongs to, so a client it has forgotten is dropped; "" when none was used. */
  readonly clientRegistration: string;
  /** The SHA-256 of the Connect link that started the sign-in; "" for a person's. */
  readonly connectLink: string;
  /** Who the sign-in is with, for the saved login's description. */
  readonly providerName: string;
  /** The login app's account endpoint, read once with the new token; "" for none. */
  readonly userinfoUrl: string;
  /** Unix seconds; 0 lets the driver stamp now. */
  readonly createdAt: number;
}

/**
 * One OAuth client Stigmer registered with a login server (RFC 7591), kept
 * so every later sign-in reuses it: keyed by the login server and the
 * redirect URI it was registered with. Only public clients are registered,
 * so nothing secret is kept, and one row serves every organization.
 */
export interface OAuthClientRegistrationStore {
  /** The client registered with `loginServer` for `redirectUri`, or undefined. */
  find(loginServer: string, redirectUri: string): Promise<string | undefined>;
  /**
   * Keeps `clientId` when nothing is kept for the pair yet, and answers the
   * client kept: of two registrations racing, the first kept wins and the
   * other is never used.
   */
  save(loginServer: string, redirectUri: string, clientId: string, now: string): Promise<string>;
  /** Drops the pair's client while it is still `clientId` (one the login server has forgotten). Idempotent. */
  forget(loginServer: string, redirectUri: string, clientId: string): Promise<void>;
  /** Whether `clientId` is a client Stigmer keeps with any login server. */
  holds(clientId: string): Promise<boolean>;
}

/** A Connect link as stored: its secret only as a SHA-256. Times are Unix seconds. */
export interface ConnectLinkRecord {
  /** base64url SHA-256 of the link's secret: the key. */
  readonly tokenHash: string;
  readonly org: string;
  readonly vaultId: string;
  /** The normalized address the link signs in to. */
  readonly address: string;
  readonly returnUrl: string;
  /** The identity account that made the link, recorded as the saver of the login. */
  readonly createdBy: string;
  /** The maker's caller class, so the maker's standing is re-checked as the caller that made the link. */
  readonly createdByClass: string;
  /** The organization the maker's credential was bound to; empty when it named none. */
  readonly createdByBoundOrg: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** When the link was spent; 0 while unused. */
  readonly usedAt: number;
}

export interface ConnectLinkStore {
  create(link: ConnectLinkRecord): Promise<void>;
  /** The link when it exists, is unused and expires after `now`; undefined otherwise. */
  findUsable(tokenHash: string, now: number): Promise<ConnectLinkRecord | undefined>;
  /** Marks a usable link used at `now`, atomically: true for the one call that spent it. */
  spend(tokenHash: string, now: number): Promise<boolean>;
  /** Makes a link spent at `usedAt` usable again (its sign-in failed after spending it). */
  restore(tokenHash: string, usedAt: number): Promise<void>;
  /** Removes the links that expired before `now`; returns the count. */
  deleteExpired(now: number): Promise<number>;
  /** Removes every link to a vault (its delete); returns the count. */
  deleteByVault(vaultId: string): Promise<number>;
  /** Removes every link of an organization (its purge); returns the count. */
  deleteByOrg(org: string): Promise<number>;
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
  /** Removes every state begun in an organization (its purge); returns the count. */
  deleteByOrg(org: string): Promise<number>;
}

/**
 * One live row as stored — the id plus the EXACT marshaled bytes, for the
 * maintenance surface (the Java RawDocument shape): a sweep reads pages of
 * these, transforms, and swaps back with replaceResourceDataIfUnchanged
 * guarding on the same bytes.
 */
export interface RawResourceDocument {
  readonly id: string;
  readonly data: Uint8Array;
}

/**
 * What a driver opens with beyond its connection. `listIndexes` is the
 * composition root's one list of list-index declarations
 * (boot/list-indexes.ts); a store opened without it keeps no list index
 * and refuses every `queryResources`.
 */
export interface StoreOpenOptions {
  readonly listIndexes?: ReadonlyArray<ListIndexDeclaration>;
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
   * overwrite each other (load-then-save stays banned in status paths
   * carrying append-only event streams).
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

  /**
   * The rows of a list-indexed kind that match the query, newest first on
   * (creation instant, id) compared as bytes, strictly after
   * `query.after`, at most `query.limit` of them (list-index.ts states the
   * order and the predicates). Fewer than `limit` rows means there are no
   * more.
   *
   * EXACT whoever wrote the rows: a row whose index facts are proven
   * current is answered through the index; every other row of the kind —
   * one written by a binary that does not know the index, or under
   * another revision of the declaration — is evaluated from its bytes with
   * the declaration, and repaired by a compare-and-set on those bytes so a
   * newer write is never overwritten. An unproven row that cannot be
   * decoded is skipped and logged, as the list lanes skip one.
   *
   * Throws when `declaration` is not the one this store was opened with,
   * or on a limit that is not a positive integer.
   */
  queryResources<K extends string>(
    declaration: ListIndexDeclaration<K>,
    query: ListIndexQuery<K>,
  ): Promise<ListIndexRow[]>;

  /** Removes a resource; NO error if it does not exist. */
  deleteResource(kind: ApiResourceKind, id: string): Promise<void>;

  /**
   * Finds a single resource whose field at `fieldPath` (dot notation, e.g.
   * "spec.executionId"; camelCase parts fall back to snake_case) equals
   * `value`. Full-scan + proto reflection, exactly as Go — indexability is
   * guaranteed at the interface, physical indexing is each driver's
   * concern. Throws ResourceNotFoundError if none match.
   */
  findByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
  ): Promise<MessageShape<Desc>>;

  /**
   * All resources whose field at `fieldPath` (the `findByField` notation)
   * equals `value`, as their stored bytes; empty when none match. The scan
   * has no ordering, so a caller that needs one row owns what two mean
   * (the `findAllByLabel` rule, stigmer/stigmer#356). It returned the whole
   * kind unfiltered while the Go server was the translation reference (Go's
   * driver could not decode without the concrete type); `schema` is that
   * type.
   */
  findAllByField<Desc extends DescMessage>(
    kind: ApiResourceKind,
    fieldPath: string,
    value: string,
    schema: Desc,
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

  // ---------------------------------------------------------------------------
  // The maintenance surface — the
  // secret-convergence sweep's storage contract, mirroring the cloud
  // repository primitives (AbstractPostgresApiResourceRepository.
  // findRawOrderedAfter / replaceDataIfUnchanged). Blessed exports:
  // maintenance flows visit every row and persist only when nothing
  // interleaved — never through the RPC surfaces (update handlers
  // re-trigger side effects, and the ***REDACTED*** round-trip copies
  // stored ciphertext back, making upgrades impossible through that
  // door) and never through extension SQL against this schema.
  // ---------------------------------------------------------------------------

  /**
   * One keyset page of a kind as raw documents — id plus the exact stored
   * bytes, which is what replaceResourceDataIfUnchanged guards on. Keyset
   * pagination on the id is stable under concurrent writes, where
   * LIMIT/OFFSET paging is not (the Java findRawOrderedAfter rationale).
   * Pass "" to start from the first row (ids are non-empty text, so every
   * id sorts above it), then the last id of each page. Throws on a
   * non-positive limit.
   */
  findResourcesRawOrderedAfter(
    kind: ApiResourceKind,
    afterIdExclusive: string,
    limit: number,
  ): Promise<RawResourceDocument[]>;

  /**
   * Whole-document compare-and-swap: replaces the stored bytes ONLY when
   * they still equal `expectedData` — the exact bytes the row was read
   * with (the TS analogue of Java's bound-JSON-text replaceDataIfUnchanged;
   * BYTEA equality is exact by construction, no canonicalization games).
   *
   * @returns true when the swap applied; false when the row changed OR
   *   was deleted since the read (a lost swap, never an upsert) — the
   *   caller retries from a fresh read or lets the next scheduled pass
   *   pick the row up. Concurrent request-path writers always win.
   */
  replaceResourceDataIfUnchanged(
    kind: ApiResourceKind,
    id: string,
    expectedData: Uint8Array,
    newData: Uint8Array,
  ): Promise<boolean>;

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
  countAuditEntries(kind: ApiResourceKind, resourceId: string): Promise<number>;

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
   * (skill re-push archives prior content as a fresh row) — newest wins,
   * matching every other audit read.
   * Throws AuditNotFoundError if absent.
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
  // Schedule runs (fire ledger — every fire leaves a row, incl. fires that
  // created no execution: the only durable trace of a refused launch gate
  // below the auto-pause threshold)
  // ---------------------------------------------------------------------------

  /**
   * Inserts or updates the fire's ledger row, keyed on (scheduleId,
   * nominalFireTime, origin). Terminal-immutable: a row whose completedAt
   * is set is never downgraded — a replayed "started" write after the
   * verdict landed is a no-op by construction (the ON CONFLICT guard).
   */
  upsertScheduleFire(record: ScheduleFireRecord): Promise<void>;

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
  markLatestScheduleFireTerminal(
    scheduleId: string,
    origin: string,
    outcome: string,
    reason: string,
    completedAt: string,
  ): Promise<void>;

  /** Recorded fires, newest first, plus the total count for pagination. */
  listScheduleFires(
    scheduleId: string,
    offset: number,
    limit: number,
  ): Promise<{ fires: ScheduleFireRecord[]; total: number }>;

  /** Delete-cascade twin, called after the resource row delete succeeds. */
  deleteScheduleFiresBySchedule(scheduleId: string): Promise<number>;

  /** Removes every ledger row of an organization's schedules (its purge's sweep); returns the count. */
  deleteScheduleFiresByOrg(org: string): Promise<number>;

  /**
   * Removes ledger rows recorded before the cutoff (RFC-3339, compared
   * lexicographically) — the retention policy the table was born with.
   */
  pruneScheduleFires(recordedBefore: string): Promise<number>;

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

  /** Removes every search-index row of an organization's resources (its purge's sweep); returns the count. */
  deleteSearchIndexByOrg(org: string): Promise<number>;

  /**
   * One search-index read: full counts per kind, short-circuiting to an
   * empty page at zero matches, then the ranked page — order is
   * deterministic within the driver (relevance in search mode, newest
   * first in list mode). Engine query syntax and score normalization are
   * rendered INSIDE the driver from the structured query (no DB() escape
   * hatch — the driver owns the SQL, the search service owns criteria
   * and conversion).
   */
  querySearchIndex(query: SearchIndexQuery): Promise<SearchIndexQueryResult>;

  /**
   * Empties the search index (RebuildIndex's wipe before re-indexing from
   * the resources table — Go's `DELETE FROM search_index`).
   */
  clearSearchIndex(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Consolidated sub-stores (inside the boundary, no DB() hatch)
  // ---------------------------------------------------------------------------

  readonly bootstrapState: BootstrapStateStore;
  readonly resourceNames: ResourceNameStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;
  readonly oauthClientRegistrations: OAuthClientRegistrationStore;
  readonly connectLinks: ConnectLinkStore;
  readonly organizationDeletions: OrganizationDeletionStore;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Releases all resources; every other method errors afterwards. */
  close(): Promise<void>;
}
