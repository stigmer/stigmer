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
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";

import type { CallerIdentity } from "./identity.js";

/**
 * The visibility tuple shapes of the shared FGA model, named
 * edition-neutrally. The driver maps each to its tuple:
 *   - org-viewer:      <kind>:<id>#viewer@organization:<org>#viewer
 *   - public-viewer:   <kind>:<id>#viewer@identity_account:* (conditional)
 *   - platform-viewer: <kind>:<id>#platform_viewer@identity_provider:<idp>#platform_user
 *     (fans out per IdP the org owns — the driver's lookup, not OSS's)
 */
export type VisibilityTupleShape =
  | "org-viewer"
  | "public-viewer"
  | "platform-viewer";

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
 * The driver interface (single-instance point, registered via
 * ExtensionDrivers.resourceAuthorizationLifecycle). Implementations must
 * be idempotent per event — the surrounding chains retry whole requests,
 * and duplicate grants must converge, not error.
 */
export interface ResourceAuthorizationLifecycle {
  onResourceCreated(event: ResourceCreatedEvent): Promise<void>;
  onResourceDeleted(event: ResourceDeletedEvent): Promise<void>;
  onVisibilityChanged(event: VisibilityChangedEvent): Promise<void>;
}
