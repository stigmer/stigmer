/**
 * The resource-authorization lifecycle extension point (convergence
 * program C2, 20260827.10; plan-gate ruling Q2). The cloud edition writes
 * relationship tuples (OpenFGA) at three verified points of every
 * resource's life — creation, deletion, and visibility change — through
 * ONE driver seam, mirroring the Java service's config-driven
 * architecture (CreateAuthorizationTuplesStepV2 + cleanupIamPolicies +
 * VisibilityTupleReconciler, the shapes production trusts today).
 *
 * Division of labor (the ratified design): the OSS steps
 * (src/pipeline/steps/authorization-tuples.ts) resolve EVERYTHING
 * edition-neutral — the kind's AuthorizationConfig from proto metadata,
 * parent ids from spec fields, the visibility shape set-diff — and hand
 * the driver fully-resolved events. The driver owns only the tuple
 * writes. No driver composed = the steps no-op = OSS behavior is
 * byte-identical (the empty-default doctrine, DD-006 §2a).
 *
 * Failure semantics are part of the contract (Java parity, verified
 * against the cloud handlers 2026-08-27):
 *   - onResourceCreated: SYNCHRONOUS, post-persist; a throw FAILS the
 *     request (the resource row survives — half-created resources are an
 *     inherited real state, healed by retry).
 *   - onResourceDeleted: best-effort — the call site logs and continues;
 *     a throw never fails the delete (orphaned grants are inert once the
 *     resource row is gone; the cloud side owns convergence sweeps).
 *   - onVisibilityChanged: SYNCHRONOUS, post-persist; a throw fails the
 *     request (metadata may be persisted with tuples lagging — retrying
 *     the same transition converges, the set-diff is idempotent).
 *
 * Corrected 2026-09-13 (20260913.01, T01_1_review.md Q-OR-6, Q-OR-10):
 * "no driver composed = OSS behavior byte-identical" described the seam
 * while the only writer of authorization records was the cloud's tuple
 * driver. The seam now records authorization at lifecycle points in EVERY
 * edition: open source's built-in role lifecycle
 * (domain/iampolicy/role-lifecycle.ts, the entry's slice 4) writes
 * IamPolicy rows (the organization creator's `owner` row; cleanup on
 * delete), and a composed driver writes tuples too. The two POLICY hooks below are the
 * other direction of the same seam — the IamPolicy domain's one grant and
 * revoke path (domain/iampolicy/grant-path.ts) telling the driver that a
 * row was written or is about to be deleted, so a composition can mirror
 * the row as a tuple. Their order is the cloud#425 invariant, fixed by the
 * path and stated on each event:
 *   - onPolicyGranted: SYNCHRONOUS, AFTER the row is persisted; fires on
 *     the duplicate arm too (the inline heal for a row whose tuple never
 *     landed). A throw fails the request with the row in place — the
 *     caller's retry or a boot backfill heals it.
 *   - onPolicyRevoked: SYNCHRONOUS, BEFORE the row is deleted. A throw
 *     leaves row and tuple, so a retry converges; the reverse order was
 *     the fail-open incident class ("revoke" silently becoming "keep").
 *     On the absent arm (no row for the spec) it fires with the spec and
 *     no policy, so a composition can still delete a bare tuple written
 *     before the row mirror existed.
 * Absent method = no mirror is written (the OSS posture: rows are the
 * record).
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { CallerIdentity } from "./identity.js";

/**
 * The visibility tuple shapes of the shared FGA model, named
 * edition-neutrally. The driver maps each to its tuple:
 *   - org-viewer:      <kind>:<id>#viewer@organization:<org>#viewer
 *   - platform-viewer: <kind>:<id>#platform_viewer@identity_provider:<idp>#platform_user
 *     (fans out per IdP the org owns — the driver's lookup, not OSS's)
 * Every shape names a bounded set of readers; the model has no shape that
 * reaches every account.
 */
export type VisibilityTupleShape = "org-viewer" | "platform-viewer";

/**
 * One resolved structural link from the created resource to a parent
 * object — the scope link (relation `organization` for ORGANIZATION
 * scope, the configured relation for PARENT scope) and every configured
 * additional parent, in that order. Parent ids are extracted from the
 * resource's spec fields by the OSS resolution (the proto
 * ParentRelationConfig.spec_field contract).
 */
export interface ResolvedParentLink {
  /** The FGA relation on the created resource (e.g. "organization", "session", "subject"). */
  readonly relation: string;
  /** The parent object's kind. */
  readonly parentKind: ApiResourceKind;
  /** The parent object's resource id. */
  readonly parentId: string;
}

/**
 * The facts a stored row carries that its authorization tuples derive
 * from — the row-side vocabulary of `kind_meta.authorization`, read back
 * from a row rather than resolved at its create. The lifecycle derives a
 * `ResourceCreatedEvent` from the same facts on the way in; a list lane
 * offers them on every candidate (`ListEntryMeta`, list-read-scope.ts);
 * the built-in authorizer derives a loaded row's tuples from them. One
 * shape, read by one structural resolver
 * (pipeline/steps/authorization-facts.ts), so a driver that evaluates the
 * model over a candidate needs no second read of the row.
 *
 * Read-side facts are lenient where the create-time resolution is strict:
 * a legacy row that names no organization or no parent carries none (an
 * empty `org`, a link absent from `parentLinks`) and a stamp that names
 * nobody is the empty string — a fact about the row, never a fault of the
 * read.
 */
export interface RowAuthorizationFacts {
  readonly id: string;
  /** `metadata.org`; "" for kinds outside organization scope and for legacy rows that never named one. */
  readonly org: string;
  /** `metadata.visibility` as stored; unspecified when the row never set one. */
  readonly visibility: ApiResourceVisibility;
  /** `status.audit.spec_audit.created_by.id` as stamped; "" when absent. Classified by the reader, not here. */
  readonly createdBy: string;
  /**
   * The scope link and every configured additional parent, in the tuple
   * lifecycle's order, from the row's own fields; a parent the row does
   * not name is absent, never a fault.
   */
  readonly parentLinks: ReadonlyArray<ResolvedParentLink>;
}

/** Fired synchronously after a resource row is first persisted. */
export interface ResourceCreatedEvent {
  readonly kind: ApiResourceKind;
  readonly resourceId: string;
  /** metadata.org — empty for kinds outside org scope (e.g. organization itself). */
  readonly orgId: string;
  /** The authenticated creator — owner/creator tuples derive from it. */
  readonly caller: CallerIdentity;
  /**
   * The kind's owner attribution (proto AuthorizationConfig.owner_type):
   * DIRECT → owner tuple for the caller; SELF → owner tuple for the
   * resource's own id; INHERITED/NONE/UNSPECIFIED → no owner tuple.
   */
  readonly ownerAttribution: OwnerAttributionType;
  /** True only for kinds flagged requires_creator_tuple (immutable attribution). */
  readonly requiresCreatorTuple: boolean;
  /** Scope link + additional parents, fully resolved. */
  readonly parentLinks: ReadonlyArray<ResolvedParentLink>;
  /**
   * The creation-time visibility expansion (the Java reconciler's
   * `unspecified → level` transition), org floor included.
   */
  readonly visibilityShapes: ReadonlyArray<VisibilityTupleShape>;
}

/** Fired after a resource row is deleted (best-effort consumption). */
export interface ResourceDeletedEvent {
  readonly kind: ApiResourceKind;
  readonly resourceId: string;
  readonly orgId: string;
  readonly caller: CallerIdentity;
}

/** Fired synchronously after a visibility change is persisted. */
export interface VisibilityChangedEvent {
  readonly kind: ApiResourceKind;
  readonly resourceId: string;
  readonly orgId: string;
  /** Shapes present in the new level but not the old — to be written. */
  readonly shapesToCreate: ReadonlyArray<VisibilityTupleShape>;
  /** Shapes present in the old level but not the new — to be deleted. */
  readonly shapesToDelete: ReadonlyArray<VisibilityTupleShape>;
}

/**
 * Fired synchronously after a blueprint's `status.defaultInstanceId`
 * pointer is persisted (C2 Stage 3 — the default_of structural-
 * inheritance arm of the Java model). The invariant the driver upholds:
 * the `<instanceKind>:<instanceId>#default_of@<blueprintKind>:<blueprintId>`
 * tuple exists iff the pointer names the instance — written by the SAME
 * flows that persist the pointer, never derived from the client-
 * suppliable default-instance label. The tuple makes the default
 * instance exactly as reachable as its blueprint (viewer from
 * default_of); it never transitions and dies with the instance's normal
 * deletion cleanup.
 */
export interface DefaultInstanceLinkedEvent {
  readonly instanceKind: ApiResourceKind;
  readonly instanceId: string;
  readonly blueprintKind: ApiResourceKind;
  readonly blueprintId: string;
}

/**
 * Fired synchronously AFTER an IamPolicy row is persisted by the domain's
 * grant path — and on the duplicate arm, when the triple was already held
 * and no row was written, so a composition heals a row whose tuple never
 * landed (cloud#425's inline heal). `policy` is the row as stored: on the
 * duplicate arm the FIRST writer's row, whose id may be a legacy random
 * one on a composition that predates derived ids.
 */
export interface PolicyGrantedEvent {
  readonly policy: IamPolicy;
  /** True when the triple was already held and this grant wrote nothing. */
  readonly duplicate: boolean;
}

/**
 * Fired synchronously BEFORE an IamPolicy row is deleted by the domain's
 * grant path. `spec` is always the triple being revoked; `policy` is the
 * row found for it, or `undefined` on the absent arm — the spec alone is
 * enough to name the tuple a composition still deletes then.
 */
export interface PolicyRevokedEvent {
  readonly spec: IamPolicySpec;
  readonly policy: IamPolicy | undefined;
}

/**
 * The driver interface (single-instance point, registered via
 * ExtensionDrivers.resourceAuthorizationLifecycle). Implementations must
 * be idempotent per event — the surrounding chains retry whole requests,
 * and duplicate grants must converge, not error.
 */
export interface ResourceAuthorizationLifecycle {
  onResourceCreated(event: ResourceCreatedEvent): Promise<void>;
  onResourceDeleted(event: ResourceDeletedEvent): Promise<void>;
  onVisibilityChanged(event: VisibilityChangedEvent): Promise<void>;
  /**
   * OPTIONAL (added C2 Stage 3): synchronous, post-pointer-persist; a
   * throw fails the request (the pointer survives — retry converges, the
   * write is idempotent). Absent method = no structural link is written
   * (the OSS posture: local access control needs none).
   */
  onDefaultInstanceLinked?(event: DefaultInstanceLinkedEvent): Promise<void>;
  /**
   * OPTIONAL (added 20260913.01 slice 2): synchronous, AFTER the row
   * persist, on the duplicate arm too; a throw fails the grant with the
   * row in place. Absent method = rows are the record (the OSS posture).
   */
  onPolicyGranted?(event: PolicyGrantedEvent): Promise<void>;
  /**
   * OPTIONAL (added 20260913.01 slice 2): synchronous, BEFORE the row
   * delete; a throw leaves row and tuple for the retry. Absent method =
   * rows are the record (the OSS posture).
   */
  onPolicyRevoked?(event: PolicyRevokedEvent): Promise<void>;
}
