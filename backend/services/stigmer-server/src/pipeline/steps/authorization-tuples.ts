/**
 * Authorization-tuple lifecycle steps — the OSS half of the C2 seam
 * (convergence 20260827.10, ruling Q2). Ports the Java service's
 * config-driven tuple machinery: CreateAuthorizationTuplesStepV2 (create
 * chains, post-persist), DeleteOperationCleanupIamPoliciesStep (delete
 * chains, best-effort), and the VisibilityTupleReconciler's level→shape
 * policy with set-diff transitions (updateVisibility chains,
 * post-persist). Verified against the Java sources 2026-08-27; the
 * behavioral inventory lives in the sub-project's T01 records.
 *
 * Everything edition-neutral resolves HERE — the kind's proto
 * AuthorizationConfig (via kind_meta, the apiresource-meta idiom),
 * parent ids from spec fields (the ParentRelationConfig.spec_field
 * contract, proto reflection — zero hardcoded kind knowledge), and the
 * visibility shape diff (org floor included). The composed
 * ResourceAuthorizationLifecycle driver receives resolved events and
 * owns only the tuple writes. No driver = every step no-ops before any
 * resolution work — OSS behavior AND cost are byte-identical.
 *
 * Failure semantics (Java parity):
 *   - create: a resolution gap (missing parent id, missing org) or a
 *     driver throw FAILS the request as Internal — after persist, so a
 *     half-created resource is a real, retry-healed state (inherited).
 *   - delete cleanup: best-effort — log and continue, never fail the
 *     delete (Java's step swallows everything; orphaned grants are inert
 *     once the row is gone).
 *   - visibility: a driver throw fails the request as Internal — after
 *     persist; retrying the same transition converges (set-diff
 *     idempotency).
 *   - the PLATFORM scope arm is dead config in BOTH editions (no kind
 *     uses it; Java's switch falls through to a warn) — ported as the
 *     same conscious warn, never an implementation.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AuthorizationScopeType,
  OwnerAttributionType,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type {
  AuthorizationConfig,
  ParentRelationConfig,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  DefaultInstanceLinkedEvent,
  ResolvedParentLink,
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  VisibilityTupleShape,
} from "../../extensions/resource-authorization.js";

/**
 * Fires the driver's default-instance link event (C2 Stage 3 — the
 * default_of invariant). Called by the pointer-persist sites — every
 * flow that writes a blueprint's `status.defaultInstanceId` — AFTER the
 * pointer lands, so the tuple exists iff the pointer names the instance.
 * No driver (or a driver without the optional method) = no-op — OSS
 * behavior byte-identical. Synchronous: a throw fails the request; the
 * persisted pointer survives and a retry converges (idempotent write).
 */
export async function notifyDefaultInstanceLinked(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  event: DefaultInstanceLinkedEvent,
): Promise<void> {
  if (lifecycle?.onDefaultInstanceLinked === undefined) {
    return;
  }
  await lifecycle.onDefaultInstanceLinked(event);
}
import { getKindEnum, getKindMeta, getKindName } from "../apiresource-meta.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import type { HasMetadataShape } from "./shapes.js";
import { metadataOf } from "./shapes.js";

// ---------------------------------------------------------------------------
// Visibility shape policy — the reconciler's level→shape mapping, ported
// from the Java VisibilityTupleReconciler (its unit-test matrix is
// re-pinned in this module's tests).
// ---------------------------------------------------------------------------

/**
 * The tuple shapes a visibility level expands to for a kind. Levels the
 * kind does not support yield the empty set SILENTLY (Java parity — the
 * ValidateVisibility steps reject unsupported levels with
 * InvalidArgument before persist; this policy never doubles as
 * validation).
 *
 * The org floor: kinds flagged defaults_to_org_visibility (blueprints —
 * shared org assets) keep the org-viewer shape at public and platform
 * levels, so sharing a blueprint beyond the org never hides it from its
 * own org's catalog (ListObjects suppresses the public wildcard).
 */
export function visibilityShapesFor(
  kind: ApiResourceKind,
  level: ApiResourceVisibility,
): ReadonlySet<VisibilityTupleShape> {
  const config = getKindMeta(kind).authorization?.visibility;
  const shapes = new Set<VisibilityTupleShape>();
  const orgFloor =
    config?.defaultsToOrgVisibility === true && config.supportsOrg === true;
  switch (level) {
    case ApiResourceVisibility.visibility_org:
      if (config?.supportsOrg === true) {
        shapes.add("org-viewer");
      }
      break;
    case ApiResourceVisibility.visibility_public:
      if (config?.supportsPublic === true) {
        shapes.add("public-viewer");
        if (orgFloor) {
          shapes.add("org-viewer");
        }
      }
      break;
    case ApiResourceVisibility.visibility_platform:
      if (config?.supportsPlatform === true) {
        shapes.add("platform-viewer");
        if (orgFloor) {
          shapes.add("org-viewer");
        }
      }
      break;
    default:
      // private / unspecified / unknown → no visibility tuples.
      break;
  }
  return shapes;
}

/** The set-diff of a visibility transition; shared shapes stay untouched. */
export function diffVisibilityShapes(
  kind: ApiResourceKind,
  oldLevel: ApiResourceVisibility,
  newLevel: ApiResourceVisibility,
): {
  readonly shapesToCreate: ReadonlyArray<VisibilityTupleShape>;
  readonly shapesToDelete: ReadonlyArray<VisibilityTupleShape>;
} {
  if (oldLevel === newLevel) {
    return { shapesToCreate: [], shapesToDelete: [] };
  }
  const oldShapes = visibilityShapesFor(kind, oldLevel);
  const newShapes = visibilityShapesFor(kind, newLevel);
  return {
    shapesToCreate: [...newShapes].filter((shape) => !oldShapes.has(shape)),
    shapesToDelete: [...oldShapes].filter((shape) => !newShapes.has(shape)),
  };
}

// ---------------------------------------------------------------------------
// Parent-id resolution — the ParentIdExtractorRegistry port. Zero
// hardcoded kind knowledge: the proto config names the spec field, this
// module reads it structurally (protobuf-es spec messages are plain
// objects whose properties are the camelCase proto field names).
// ---------------------------------------------------------------------------

/** proto snake_case field name → the generated property name. */
function camelCaseFieldName(specField: string): string {
  return specField.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Extracts the parent id named by the config from the resource's spec.
 * Returns "" for every miss (no spec, no field, non-string value) — the
 * caller decides whether that is fatal, exactly as Java's registry
 * returns null and the service throws.
 */
function extractParentId(resource: Message, specField: string): string {
  // Structural access is the shapes.ts idiom: spec messages are plain
  // objects; the property name is the camelCase form of the proto field.
  const spec = (resource as unknown as { spec?: Record<string, unknown> }).spec;
  if (spec === undefined) {
    return "";
  }
  const value = spec[camelCaseFieldName(specField)];
  return typeof value === "string" ? value : "";
}

function resolveParentLink(
  kind: ApiResourceKind,
  resource: Message,
  parentConfig: ParentRelationConfig,
): ResolvedParentLink {
  const parentId = extractParentId(resource, parentConfig.specField);
  if (parentId === "") {
    // Java: "Parent ID required for X but not found" → the request fails.
    throw internalError(
      new Error(
        `parent id for relation '${parentConfig.relation}' (spec field '${parentConfig.specField}') is missing on ${getKindName(kind)}`,
      ),
      "failed to create authorization tuples",
    );
  }
  return {
    relation: parentConfig.relation,
    parentKind: getKindEnum(parentConfig.kind),
    parentId,
  };
}

/**
 * The scope link + additional parents for a created resource — resolved
 * in Java's order (scope first, additional parents after).
 */
function resolveParentLinks(
  kind: ApiResourceKind,
  config: AuthorizationConfig,
  resource: Message,
  orgId: string,
  logger: Logger,
): ReadonlyArray<ResolvedParentLink> {
  const links: ResolvedParentLink[] = [];
  switch (config.scopeType) {
    case AuthorizationScopeType.ORGANIZATION: {
      if (orgId === "") {
        throw internalError(
          new Error(
            `organization id is required to create authorization tuples for ${getKindName(kind)}`,
          ),
          "failed to create authorization tuples",
        );
      }
      links.push({
        relation: "organization",
        parentKind: getKindEnum("organization"),
        parentId: orgId,
      });
      break;
    }
    case AuthorizationScopeType.PARENT: {
      if (config.parent === undefined) {
        throw internalError(
          new Error(
            `${getKindName(kind)} declares PARENT scope without a parent config`,
          ),
          "failed to create authorization tuples",
        );
      }
      links.push(resolveParentLink(kind, resource, config.parent));
      break;
    }
    case AuthorizationScopeType.OWNER_ONLY:
      break;
    case AuthorizationScopeType.PLATFORM:
      // Dead config in both editions — Java's switch warns and writes no
      // scope link (organization/identity_account are OWNER_ONLY in the
      // shipped config). Ported as the same conscious warn.
      logger.warn("unhandled PLATFORM authorization scope — no scope link", {
        kind: getKindName(kind),
      });
      break;
    default:
      break;
  }
  for (const parent of config.additionalParents) {
    links.push(resolveParentLink(kind, resource, parent));
  }
  return links;
}

// ---------------------------------------------------------------------------
// The steps.
// ---------------------------------------------------------------------------

/**
 * Resolves the creation event for a just-persisted resource, or
 * undefined for kinds whose scope is NONE/UNSPECIFIED (Java's early
 * return — no owner tuple, no visibility either). Shared by the generic
 * create step and the domain-local lanes whose pipeline message is not
 * the resource (skill push rides SKILL_KEY).
 */
export function resolveResourceCreatedEvent(
  kind: ApiResourceKind,
  resource: Message,
  caller: CallerIdentity,
  logger: Logger,
): ResourceCreatedEvent | undefined {
  const config = getKindMeta(kind).authorization;
  if (
    config === undefined ||
    config.scopeType === AuthorizationScopeType.NONE ||
    config.scopeType === AuthorizationScopeType.UNSPECIFIED
  ) {
    return undefined;
  }
  const metadata = metadataOf(resource);
  if (metadata === undefined || metadata.id === "") {
    throw internalError(
      new Error("resource metadata missing after persist"),
      "failed to create authorization tuples",
    );
  }
  return {
    kind,
    resourceId: metadata.id,
    orgId: metadata.org,
    caller,
    ownerAttribution: config.ownerType,
    requiresCreatorTuple: config.requiresCreatorTuple,
    parentLinks: resolveParentLinks(
      kind,
      config,
      resource,
      metadata.org,
      logger,
    ),
    // Creation is the unspecified→level transition (Java models it the
    // same way through the reconciler).
    visibilityShapes: [...visibilityShapesFor(kind, metadata.visibility)],
  };
}

/**
 * CreateAuthorizationTuples — post-persist in every create chain (apply
 * delegates to create, so the apply lane is covered by construction).
 */
export function newCreateAuthorizationTuplesStep<Desc extends DescMessage>(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CreateAuthorizationTuples",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (lifecycle === undefined) {
        return;
      }
      const event = resolveResourceCreatedEvent(
        ctx.apiResourceKind,
        ctx.newState,
        ctx.callerIdentity,
        logger,
      );
      if (event === undefined) {
        return;
      }
      try {
        await lifecycle.onResourceCreated(event);
      } catch (error) {
        throw internalError(error, "failed to create authorization tuples");
      }
    },
  };
}

/**
 * CleanupIamPolicies — after the store delete in every delete chain.
 * Best-effort by contract: a driver failure is logged and the delete
 * succeeds (Java's DeleteOperationCleanupIamPoliciesStep swallows all —
 * the cloud side owns convergence for orphaned grants).
 */
export function newCleanupIamPoliciesStep<Desc extends DescMessage>(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CleanupIamPolicies",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (lifecycle === undefined) {
        return;
      }
      const deleted = ctx.get(EXISTING_RESOURCE_KEY) as
        | HasMetadataShape
        | undefined;
      const metadata = deleted?.metadata;
      if (metadata === undefined || metadata.id === "") {
        return;
      }
      try {
        await lifecycle.onResourceDeleted({
          kind: ctx.apiResourceKind,
          resourceId: metadata.id,
          orgId: metadata.org,
          caller: ctx.callerIdentity,
        });
      } catch (error) {
        logger.warn(
          "authorization cleanup failed — orphaned IAM policies may remain",
          {
            kind: getKindName(ctx.apiResourceKind),
            resourceId: metadata.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

/** Context key for the pre-update visibility level. */
export const OLD_VISIBILITY_KEY = "authorizationOldVisibility";

/**
 * RecordVisibilityBeforeUpdate — captures the loaded resource's current
 * level BEFORE the Set*Visibility step mutates it in place. Splices
 * after the domain's load step; `resourceKey` names the domain-local
 * context key holding the loaded resource.
 */
export function newRecordVisibilityBeforeUpdateStep<Desc extends DescMessage>(
  resourceKey: string,
): PipelineStep<Desc> {
  return {
    name: "RecordVisibilityBeforeUpdate",
    execute(ctx: RequestContext<Desc>): void {
      const resource = ctx.get(resourceKey) as HasMetadataShape | undefined;
      ctx.set(
        OLD_VISIBILITY_KEY,
        resource?.metadata?.visibility ??
          ApiResourceVisibility.api_resource_visibility_unspecified,
      );
    },
  };
}

/**
 * UpdateVisibilityTuples — post-persist in every updateVisibility chain
 * (and the skill push lanes, which set visibility at creation time
 * through the create step instead). A driver failure fails the request
 * (Java parity: metadata persisted, tuples lagging, retry converges).
 */
export function newUpdateVisibilityTuplesStep<Desc extends DescMessage>(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  resourceKey: string,
): PipelineStep<Desc> {
  return {
    name: "UpdateVisibilityTuples",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (lifecycle === undefined) {
        return;
      }
      const resource = ctx.get(resourceKey) as HasMetadataShape | undefined;
      const metadata = resource?.metadata;
      if (metadata === undefined || metadata.id === "") {
        return;
      }
      const oldLevel =
        (ctx.get(OLD_VISIBILITY_KEY) as ApiResourceVisibility | undefined) ??
        ApiResourceVisibility.api_resource_visibility_unspecified;
      const { shapesToCreate, shapesToDelete } = diffVisibilityShapes(
        ctx.apiResourceKind,
        oldLevel,
        metadata.visibility,
      );
      if (shapesToCreate.length === 0 && shapesToDelete.length === 0) {
        return;
      }
      try {
        await lifecycle.onVisibilityChanged({
          kind: ctx.apiResourceKind,
          resourceId: metadata.id,
          orgId: metadata.org,
          shapesToCreate,
          shapesToDelete,
        });
      } catch (error) {
        throw internalError(error, "failed to update visibility tuples");
      }
    },
  };
}
