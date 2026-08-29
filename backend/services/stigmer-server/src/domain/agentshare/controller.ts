/**
 * AgentShare controller — ports pkg/domain/agentshare/controller (command +
 * query sides): the first-class sharing channel promoted out of
 * Agent.spec.sharing (decision 011). A share carries everything a hosted
 * chat link needs — audience, embed origins, visitor-facing messages,
 * guest tool credentials (environment_refs), and the rotatable link token.
 * Share operations never modify the referenced agent.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character. NOT
 * search-indexed by design (the kind declares not_search_indexed — a share
 * is channel configuration reached through its agent, not a library
 * artifact), so no index steps appear in any chain. The agent-delete
 * cascade of same-org shares lives in the AGENT domain (ported with #6);
 * share delete itself cascades nothing.
 *
 * Authorization posture (OSS): single-user and local, so handlers perform
 * no authorization — a documented no-op, not a silent divergence. The
 * cloud edition enforces the same contracts via FGA plus app-level gates
 * for the anonymous resolution paths.
 *
 * Proven by agentshare.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/agentshare.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/status_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { AgentShareQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/query_pb";
import { AgentShareListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import type {
  AgentShareId,
  AgentShareList,
  GetAgentSharesByAgentRequest,
  GetSharedProfileRequest,
  ListAgentSharesRequest,
  RotateShareLinkInput,
  SharedAgentProfile,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import {
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  compareCreatedAtDesc,
  matchesAllLabels,
} from "../../pipeline/steps/helpers.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { ORG_REQUIRED_FOR_LOOKUP_MESSAGE } from "./constants.js";
import {
  buildSharedAgentProfile,
  findShareByOrgAndSlug,
  generateShareLinkToken,
  newResolveShareDefaultsStep,
  newStampAgentPinStep,
  newValidateShareUpdateStep,
  sharedNotFound,
  sharingLinkTokenAllowed,
} from "./steps.js";

export interface AgentShareControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Registers both agentshare services on the router (routes stage). */
export function registerAgentShareServices(
  router: ConnectRouter,
  deps: AgentShareControllerDeps,
): void {
  router.service(AgentShareCommandController, {
    apply: (share, ctx) => apply(deps, share, ctx),
    create: (share, ctx) => createShare(deps, share, ctx),
    update: (share, ctx) => update(deps, share, ctx),
    rotateShareLink: (input, ctx) => rotateShareLink(deps, input, ctx),
    delete: (shareId, ctx) => deleteShare(deps, shareId, ctx),
  });
  router.service(AgentShareQueryController, {
    get: (shareId, ctx) => get(deps, shareId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    getSharedProfile: (req, ctx) => getSharedProfile(deps, req, ctx),
    getSharedProfileForMember: (ref, ctx) =>
      getSharedProfileForMember(deps, ref, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. StampAgentPin runs AFTER
 * BuildNewState so the wipe of client-provided status cannot erase the
 * rebind pin; with the agent-slug default, CheckDuplicate structurally
 * caps shares at one canonical link per agent per org.
 */
async function createShare(
  deps: AgentShareControllerDeps,
  share: AgentShare,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareSchema,
    share,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareSchema>("agent-share-create", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveShareDefaultsStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newStampAgentPinStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline. The spec is replaced
 * wholesale (declarative semantics); status is preserved verbatim from the
 * existing share, which is the guarantee that keeps
 * status.share_link_token immune to declarative clobber (rotateShareLink
 * is its sole writer).
 */
async function update(
  deps: AgentShareControllerDeps,
  share: AgentShare,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareSchema,
    share,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareSchema>("agent-share-update", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateShareUpdateStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update. Delegates with the pipeline's
 * CLONED state (Go delegates reqCtx.NewState(), NOT the original input —
 * unlike channelapp/session): the canonical-share manifest legitimately
 * omits both name and slug, and the defaulted slug/name (from
 * ResolveShareDefaults) and the populated id (from LoadForApply) live only
 * on the clone.
 */
async function apply(
  deps: AgentShareControllerDeps,
  share: AgentShare,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareSchema,
    share,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareSchema>("agent-share-apply", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareCommandController.method.apply,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveShareDefaultsStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  const resolved = reqCtx.newState;
  return shouldCreate
    ? createShare(deps, resolved, ctx)
    : update(deps, resolved, ctx);
}

// ---------------------------------------------------------------------------
// rotateShareLink — Go rotate_share_link.go: this handler is the token's
// SOLE writer; clients never supply it. The token lives in STATUS — not
// spec — so manifest applies can never wipe it and silently fail open to
// the plain guessable URL.
// ---------------------------------------------------------------------------

const ROTATE_SHARE_KEY = "rotateShareLinkShare";

type RotateDesc =
  typeof AgentShareCommandController.method.rotateShareLink.input;

async function rotateShareLink(
  deps: AgentShareControllerDeps,
  input: RotateShareLinkInput,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareCommandController.method.rotateShareLink.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RotateDesc>("agent-share-rotate-share-link", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareCommandController.method.rotateShareLink,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadShareForLinkRotationStep(deps.store))
    .addStep(newRotateShareLinkTokenStep())
    .addStep(newPersistShareForLinkRotationStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(ROTATE_SHARE_KEY) as AgentShare;
}

/** Loads the share by resource_id; ANY load failure → NotFound (Go). */
function newLoadShareForLinkRotationStep(
  store: Store,
): PipelineStep<RotateDesc> {
  return {
    name: "LoadShareForLinkRotation",
    async execute(ctx: RequestContext<RotateDesc>): Promise<void> {
      let share: AgentShare;
      try {
        share = await store.getResource(
          ctx.apiResourceKind,
          ctx.input.resourceId,
          AgentShareSchema,
        );
      } catch {
        throw notFoundError("AgentShare", ctx.input.resourceId);
      }
      ctx.set(ROTATE_SHARE_KEY, share);
    },
  };
}

/**
 * Sets status.share_link_token to fresh entropy, preserving the rest of
 * status and stamping the StatusAudit slot — the same status-preserving
 * discipline as the update pipeline. Go wraps a stamping failure as a
 * PLAIN error (not grpclib) — the wire then carries the sanitized
 * "internal server error", exactly what the pipeline's non-Connect
 * fallback produces here.
 */
function newRotateShareLinkTokenStep(): PipelineStep<RotateDesc> {
  return {
    name: "RotateShareLinkToken",
    execute(ctx: RequestContext<RotateDesc>): void {
      const share = ctx.get(ROTATE_SHARE_KEY) as AgentShare;
      // Go wraps an entropy failure as Internal "failed to rotate share
      // link" (practically unreachable, but the arm's copy is contract).
      let token: string;
      try {
        token = generateShareLinkToken();
      } catch (error) {
        throw internalError(error, "failed to rotate share link");
      }
      const status = share.status ?? create(AgentShareStatusSchema);
      status.shareLinkToken = token;
      share.status = status;
      setAuditFieldsForUpdate(
        AgentShareSchema,
        share,
        "status_audit",
        ctx.callerIdentity,
      );
    },
  };
}

/** Saves the rotated share. */
function newPersistShareForLinkRotationStep(
  store: Store,
): PipelineStep<RotateDesc> {
  return {
    name: "PersistShareForLinkRotation",
    async execute(ctx: RequestContext<RotateDesc>): Promise<void> {
      const share = ctx.get(ROTATE_SHARE_KEY) as AgentShare;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          share.metadata?.id ?? "",
          AgentShareSchema,
          share,
        );
      } catch (error) {
        throw internalError(error, "failed to save agent share");
      }
    },
  };
}

/**
 * Delete — the channel's full teardown: the hosted link stops resolving
 * and the share's configuration is gone (disable via update is the
 * config-preserving pause). The referenced agent is untouched; share
 * delete cascades nothing.
 */
async function deleteShare(
  deps: AgentShareControllerDeps,
  shareId: AgentShareId,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareCommandController.method.delete.input,
    shareId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareCommandController.method.delete.input>(
    "agent-share-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentShareCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentShareSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted agent share not found in context"),
      "deleted agent share not found in context",
    );
  }
  return deleted as AgentShare;
}

/** Get — LoadTarget by id-wrapper input (AgentShareId). */
async function get(
  deps: AgentShareControllerDeps,
  shareId: AgentShareId,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.get.input,
    shareId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareQueryController.method.get.input>(
    "agent-share-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(AgentShareQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, AgentShareSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentShare;
}

/** GetByReference — org/slug lookup. */
async function getByReference(
  deps: AgentShareControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<AgentShare> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentShareQueryController.method.getByReference.input
  >("agent-share-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, AgentShareSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentShare;
}

const SHARE_LIST_KEY = "agentShareList";

/**
 * GetByAgent — all shares of one agent, optionally org-scoped. This is how
 * the Share dialog and CLI resolve an agent's existing share regardless of
 * its slug (rename-by-recreate, decision 011 D2). A nonexistent agent
 * yields an EMPTY list, not an error — "no shares" is the useful answer
 * either way. The org filter is contract parity, not authorization: a
 * multi-org caller asking for one org's channels must not see another
 * org's cross-org shares of the same agent.
 */
async function getByAgent(
  deps: AgentShareControllerDeps,
  req: GetAgentSharesByAgentRequest,
  ctx: HandlerContext,
): Promise<AgentShareList> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.getByAgent.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareQueryController.method.getByAgent.input>(
    "agent-share-get-by-agent",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentShareQueryController.method.getByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadSharesByAgentStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(SHARE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("agent share list not found in context"),
      "agent share list not found in context",
    );
  }
  return result as AgentShareList;
}

/**
 * LoadSharesByAgent — Go loadSharesByAgentStep: resolves the agent by ID
 * to its org+slug identity (shares reference agents by org+slug while
 * this RPC is keyed on the stable agent ID), then filters shares whose
 * spec.agent_ref matches.
 */
function newLoadSharesByAgentStep(
  store: Store,
): PipelineStep<typeof AgentShareQueryController.method.getByAgent.input> {
  return {
    name: "LoadSharesByAgent",
    async execute(
      ctx: RequestContext<
        typeof AgentShareQueryController.method.getByAgent.input
      >,
    ): Promise<void> {
      const req = ctx.input;
      const emptyList = create(AgentShareListSchema, {
        totalCount: 0,
        items: [],
      });

      let agentOrg: string;
      let agentSlug: string;
      try {
        const agent = await store.getResource(
          ApiResourceKind.agent,
          req.agentId,
          AgentSchema,
        );
        agentOrg = agent.metadata?.org ?? "";
        agentSlug = agent.metadata?.slug ?? "";
      } catch {
        ctx.set(SHARE_LIST_KEY, emptyList);
        return;
      }

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_share);
      } catch (error) {
        throw internalError(error, "failed to list agent shares");
      }

      const shares: AgentShare[] = [];
      for (const bytes of rows) {
        let share: AgentShare;
        try {
          share = fromBinary(AgentShareSchema, bytes);
        } catch {
          continue;
        }
        const ref = share.spec?.agentRef;
        if ((ref?.org ?? "") !== agentOrg || (ref?.slug ?? "") !== agentSlug) {
          continue;
        }
        if (req.org !== "" && (share.metadata?.org ?? "") !== req.org) {
          continue;
        }
        shares.push(share);
      }

      ctx.set(
        SHARE_LIST_KEY,
        create(AgentShareListSchema, {
          totalCount: shares.length,
          items: shares,
        }),
      );
    },
  };
}

const LIST_RESULT_KEY = "listResult";

/**
 * List — org + labels filter (AND semantics), newest first. Versus Cloud,
 * OSS excludes authorization filtering AND pagination, exactly as Go's
 * list.go records.
 */
async function list(
  deps: AgentShareControllerDeps,
  req: ListAgentSharesRequest,
  ctx: HandlerContext,
): Promise<AgentShareList> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentShareQueryController.method.list.input>(
    "agent-share-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(AgentShareQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("agent share list not found in context"),
      "agent share list not found in context",
    );
  }
  return result as AgentShareList;
}

/** ListByOrgAndLabels — Go listByOrgAndLabelsStep, warn-and-skip rows. */
function newListByOrgAndLabelsStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof AgentShareQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof AgentShareQueryController.method.list.input>,
    ): Promise<void> {
      const { org, labels: filterLabels } = ctx.input;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ctx.apiResourceKind);
      } catch (error) {
        throw internalError(error, "failed to list agent shares");
      }

      const shares: AgentShare[] = [];
      for (const bytes of rows) {
        let share: AgentShare;
        try {
          share = fromBinary(AgentShareSchema, bytes);
        } catch {
          logger.warn("Failed to unmarshal agent share, skipping");
          continue;
        }
        if ((share.metadata?.org ?? "") !== org) {
          continue;
        }
        if (!matchesAllLabels(share.metadata?.labels ?? {}, filterLabels)) {
          continue;
        }
        shares.push(share);
      }

      shares.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(
        LIST_RESULT_KEY,
        create(AgentShareListSchema, {
          totalCount: shares.length,
          items: shares,
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The profile lanes — Go get_shared_profile.go. GetSharedProfile is the
// ANONYMOUS resolution path for the hosted chat page; visitors resolve a
// shared link to the trimmed SharedAgentProfile — never the full Agent,
// whose spec carries the system prompt. GetSharedProfileForMember is the
// tokenless authenticated twin: in OSS the one principal IS the
// organization, so membership always holds and it resolves any enabled
// share — with ONE exception mirrored from cloud (see below).
// ---------------------------------------------------------------------------

const RESOLVED_SHARE_KEY = "resolvedAgentShare";
const SHARED_PROFILE_KEY = "sharedAgentProfile";

type ProfileDesc =
  typeof AgentShareQueryController.method.getSharedProfile.input;
type MemberProfileDesc =
  typeof AgentShareQueryController.method.getSharedProfileForMember.input;

async function getSharedProfile(
  deps: AgentShareControllerDeps,
  req: GetSharedProfileRequest,
  ctx: HandlerContext,
): Promise<SharedAgentProfile> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.getSharedProfile.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ProfileDesc>("agent-share-get-shared-profile", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentShareQueryController.method.getSharedProfile,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadShareForProfileStep(deps.store))
    .addStep(newProjectSharedProfileStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(SHARED_PROFILE_KEY) as SharedAgentProfile;
}

async function getSharedProfileForMember(
  deps: AgentShareControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<SharedAgentProfile> {
  const reqCtx = new RequestContext(
    AgentShareQueryController.method.getSharedProfileForMember.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<MemberProfileDesc>(
    "agent-share-get-shared-profile-for-member",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentShareQueryController.method.getSharedProfileForMember,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadShareForMemberProfileStep(deps.store))
    .addStep(newProjectMemberSharedProfileStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(SHARED_PROFILE_KEY) as SharedAgentProfile;
}

/**
 * Loads the share by org+slug for the anonymous path. Org is required —
 * an empty org would mean "match slug across all orgs", an enumeration
 * hazard on this public endpoint.
 */
function newLoadShareForProfileStep(store: Store): PipelineStep<ProfileDesc> {
  return {
    name: "LoadShareForProfile",
    async execute(ctx: RequestContext<ProfileDesc>): Promise<void> {
      const req = ctx.input;
      if (req.org === "") {
        throw invalidArgumentError(ORG_REQUIRED_FOR_LOOKUP_MESSAGE);
      }
      const share = await findShareByOrgAndSlug(store, req.org, req.slug);
      if (share === undefined) {
        throw sharedNotFound(req.slug);
      }
      ctx.set(RESOLVED_SHARE_KEY, share);
    },
  };
}

/** The member path's loader — same org-required contract, same refusal. */
function newLoadShareForMemberProfileStep(
  store: Store,
): PipelineStep<MemberProfileDesc> {
  return {
    name: "LoadShareForMemberProfile",
    async execute(ctx: RequestContext<MemberProfileDesc>): Promise<void> {
      const ref = ctx.input;
      if (ref.org === "") {
        throw invalidArgumentError(ORG_REQUIRED_FOR_LOOKUP_MESSAGE);
      }
      const share = await findShareByOrgAndSlug(store, ref.org, ref.slug);
      if (share === undefined) {
        throw sharedNotFound(ref.slug);
      }
      ctx.set(RESOLVED_SHARE_KEY, share);
    },
  };
}

/**
 * Gates on spec.enabled, the audience, and the live link token, then
 * projects the trimmed public profile. A disabled share, an org-audience
 * share, and a locked link with a wrong or absent token are ALL
 * indistinguishable from a nonexistent share — a rotated (killed) link
 * must look exactly like one that never existed, and a members-only
 * share URL must leak nothing to non-members (they resolve via
 * getSharedProfileForMember instead). Check order mirrors the cloud
 * AgentShareGetSharedProfileHandler: exists → enabled → audience → token.
 */
function newProjectSharedProfileStep(store: Store): PipelineStep<ProfileDesc> {
  return {
    name: "ProjectSharedProfile",
    async execute(ctx: RequestContext<ProfileDesc>): Promise<void> {
      const share = ctx.get(RESOLVED_SHARE_KEY) as AgentShare;
      const req = ctx.input;

      if (share.spec?.enabled !== true) {
        throw sharedNotFound(req.slug);
      }
      // The audience arm (SharingAudiencePolicy.admitsGuests): only an
      // EXPLICIT org audience refuses — unspecified means public by
      // contract (shares created before the audience field existed are
      // anyone-with-link shares). Closes the recorded C2 close-out gap:
      // this anonymous lane resolved org-audience shares the proto
      // contract says must collapse.
      if (share.spec.audience === AgentShareAudience.org) {
        throw sharedNotFound(req.slug);
      }
      if (
        !sharingLinkTokenAllowed(
          req.linkToken,
          share.status?.shareLinkToken ?? "",
        )
      ) {
        throw sharedNotFound(req.slug);
      }

      ctx.set(SHARED_PROFILE_KEY, await buildSharedAgentProfile(store, share));
    },
  };
}

/**
 * The member path's projection: gates on spec.enabled and refuses
 * token-locked PUBLIC-audience shares — this tokenless path must not
 * reveal a killed (rotated) link's profile; such shares resolve only
 * through GetSharedProfile with the matching token. Org-audience shares
 * are unaffected — their gate is membership, not the link token.
 */
function newProjectMemberSharedProfileStep(
  store: Store,
): PipelineStep<MemberProfileDesc> {
  return {
    name: "ProjectMemberSharedProfile",
    async execute(ctx: RequestContext<MemberProfileDesc>): Promise<void> {
      const share = ctx.get(RESOLVED_SHARE_KEY) as AgentShare;

      if (share.spec?.enabled !== true) {
        throw sharedNotFound(ctx.input.slug);
      }

      const isOrgAudience = share.spec.audience === AgentShareAudience.org;
      if (!isOrgAudience && (share.status?.shareLinkToken ?? "") !== "") {
        throw sharedNotFound(ctx.input.slug);
      }

      ctx.set(SHARED_PROFILE_KEY, await buildSharedAgentProfile(store, share));
    },
  };
}
