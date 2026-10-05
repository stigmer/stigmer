/**
 * Agent controller — ports pkg/domain/agent/controller (command + query
 * sides): the agent BLUEPRINT surface. A conversation names an agent
 * directly (session spec.agent_ref); delete cascades same-org shares
 * before the agent row, and leaves the sessions that pin it, whose next
 * turn fails naming the agent that is gone. There is no default agent to
 * serve: a session with no agent runs the built-in assistant.
 *
 * Agents are versioned (versions.ts): every create and update hashes the
 * stored spec, records a version when the spec is new to the agent, points
 * back at an earlier one when it reproduces it, and archives nothing when
 * it is unchanged; delete drops the version rows with the agent.
 * getByReference resolves a tag or hash through the shared ladder;
 * listVersions, getVersion and tagVersion serve the history.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by agent.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/agent.test.ts and __tests__/store-faults.test.ts.
 *
 * Every chain opens with Authorize; create, delete and updateVisibility run
 * the shared tuple-lifecycle steps against the composed lifecycle;
 * getByReference loads, then authorizes the loaded agent exactly as `get`
 * would (AuthorizeResolvedTarget); listVersions authorizes the resolved
 * agent as `get` would; getVersion evaluates its annotation through
 * authorizeDirect. The kind has no list RPC. Per-RPC
 * posture: docs/authorization-coverage.md §6.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentId } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import type {
  AgentVersionEntry,
  GetAgentVersionInput,
  ListAgentVersionsInput,
  ListAgentVersionsResponse,
  TagAgentVersionInput,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  authorizeDirect,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
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
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import { newGuardPluginManagedStep } from "../../pipeline/steps/guard-plugin-managed.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  collectSpecReferences,
  newGuardReferenceFloorOnEscalationStep,
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
  getVersionEntry,
  versionHistoryTarget,
} from "../../pipeline/steps/version-history.js";
import {
  newRefuseChildOrgsVisibilityInChildStep,
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { agentSearchExtractor } from "./search-extractor.js";
import {
  newCascadeDeleteSharesStep,
  newMergeMcpServerEnvSpecsStep,
  newValidateHooksStep,
} from "./steps.js";
import {
  TAG_VERSION_AGENT_KEY,
  TAG_VERSION_RESULT_KEY,
  agentVersionBinding,
  newComputeAgentVersionHashStep,
  newDeleteAgentVersionsStep,
  newLoadAgentByReferenceStep,
  newLoadAgentForTagVersionStep,
  newLoadAndMapAgentVersionsStep,
  newPopulateAgentVersionStep,
  newResolveAgentBySlugStep,
  newSaveAgentVersionStep,
  newTagAgentVersionStep,
} from "./versions.js";

export interface AgentControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Registers both agent services on the router (routes stage). */
export function registerAgentServices(
  router: ConnectRouter,
  deps: AgentControllerDeps,
): void {
  router.service(AgentCommandController, {
    apply: (agent, ctx) => apply(deps, agent, ctx),
    create: (agent, ctx) => createAgent(deps, agent, ctx),
    update: (agent, ctx) => update(deps, agent, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteAgent(deps, id, ctx),
    tagVersion: (input, ctx) => tagVersion(deps, input, ctx),
  });
  router.service(AgentQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listVersions: (input, ctx) => listVersions(deps, input, ctx),
    getVersion: (input, ctx) => getVersion(deps, input, callerIdentityOf(ctx)),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. The first version is hashed
 * before Persist and archived after it, so its snapshot carries the
 * persisted row; the archive re-persists a revert because no write follows
 * it.
 */
async function createAgent(
  deps: AgentControllerDeps,
  agent: Agent,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentSchema,
    agent,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentSchema>("agent-create", deps.logger)
    .addStep(
      newAuthorizeStep(AgentCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newRefuseChildOrgsVisibilityInChildStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateHooksStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newMergeMcpServerEnvSpecsStep(deps.store, deps.logger))
    .addStep(newComputeAgentVersionHashStep())
    .addStep(newPopulateAgentVersionStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newSaveAgentVersionStep(deps.store, deps.logger, true))
    .addStep(newIndexSearchStep(deps.store, agentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline. The stored spec is hashed
 * after the MCP env merge; a new spec records a version, a reproduced one
 * points back at it, an unchanged one records none and still moves a newly
 * named tag. Persist follows the archive and flushes any revert.
 */
async function update(
  deps: AgentControllerDeps,
  agent: Agent,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentSchema,
    agent,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentSchema>("agent-update", deps.logger)
    .addStep(
      newAuthorizeStep(AgentCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    // A resource a plugin materialised is the plugin's to redefine; a client
    // write is refused naming the plugin (GuardPluginManaged, keyed on the
    // STORED labels and the plugin row's existence).
    .addStep(newGuardPluginManagedStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateHooksStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newMergeMcpServerEnvSpecsStep(deps.store, deps.logger))
    .addStep(newComputeAgentVersionHashStep())
    .addStep(newPopulateAgentVersionStep())
    .addStep(newSaveAgentVersionStep(deps.store, deps.logger, false))
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, agentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline decides
 * existence, then delegates to Create or Update with the ORIGINAL request
 * message (Go delegates `agent`, not the pipeline's mutated clone);
 * the update arm carries the resolved id via withResolvedApplyId.
 */
async function apply(
  deps: AgentControllerDeps,
  agent: Agent,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentSchema,
    agent,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentSchema>("agent-apply", deps.logger)
    .addStep(
      newAuthorizeStep(AgentCommandController.method.apply, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
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
  return shouldCreate
    ? createAgent(deps, agent, ctx)
    : update(deps, withResolvedApplyId(AgentSchema, agent, reqCtx), ctx);
}

/**
 * Delete — cascades children before the parent (delete_cascade.go):
 * same-org shares, each one's access cleaned with its row, then the agent's version rows (best-effort), the agent row, its
 * access and its index entry. Returns the deleted agent (the audit-trail
 * convention).
 */
async function deleteAgent(
  deps: AgentControllerDeps,
  agentId: AgentId,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentCommandController.method.delete.input,
    agentId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentCommandController.method.delete.input>(
    "agent-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(AgentCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentSchema))
    .addStep(newGuardPluginManagedStep(deps.store))
    .addStep(
      newCascadeDeleteSharesStep(
        deps.store,
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newDeleteAgentVersionsStep(deps.store, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted agent not found in context"),
      "deleted agent not found in context",
    );
  }
  return deleted as Agent;
}

// ---------------------------------------------------------------------------
// updateVisibility — update_visibility.go: a targeted metadata update (only
// metadata.visibility changes; spec/status untouched). The level check runs
// AFTER load, preserving the cross-edition error precedence: unknown id +
// bad level = NOT_FOUND on both editions.
// ---------------------------------------------------------------------------

const UPDATE_VISIBILITY_AGENT_KEY = "updateVisibilityAgent";

type UpdateVisibilityDesc =
  typeof AgentCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: AgentControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "agent-update-visibility",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentCommandController.method.updateVisibility,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadAgentForVisibilityUpdateStep(deps.store))
    .addStep(
      newGuardPluginManagedStep(deps.store, {
        existingKey: UPDATE_VISIBILITY_AGENT_KEY,
      }),
    )
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_AGENT_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newRefuseChildOrgsVisibilityInChildUpdateStep(deps.store, UPDATE_VISIBILITY_AGENT_KEY))
    // The reference floor's second door: an agent may not be raised above
    // the skills and MCP servers it runs with.
    .addStep(
      newGuardReferenceFloorOnEscalationStep(
        deps.store,
        UPDATE_VISIBILITY_AGENT_KEY,
        [(row) => collectSpecReferences(AgentSchema, row)],
      ),
    )
    .addStep(newSetAgentVisibilityStep())
    .addStep(newPersistAgentForVisibilityUpdateStep(deps.store))
    .addStep(
      newUpdateVisibilityTuplesStep(
        deps.authorizationLifecycle,
        UPDATE_VISIBILITY_AGENT_KEY,
      ),
    )
    .addStep(newIndexAgentAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_VISIBILITY_AGENT_KEY) as Agent;
}

/** Loads the agent by resource_id; a missing one answers NotFound, a store fault Internal. */
function newLoadAgentForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadAgentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let agent: Agent;
      try {
        agent = await store.getResource(
          ApiResourceKind.agent,
          input.resourceId,
          AgentSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("agent", input.resourceId);
        }
        throw internalError(error, "failed to load agent");
      }
      ctx.set(UPDATE_VISIBILITY_AGENT_KEY, agent);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetAgentVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetAgentVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const agent = ctx.get(UPDATE_VISIBILITY_AGENT_KEY) as Agent;
      if (agent.metadata !== undefined) {
        agent.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(
        AgentSchema,
        agent,
        "status_audit",
        ctx.callerIdentity,
      );
    },
  };
}

/** Persists the visibility change. */
function newPersistAgentForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistAgentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const agent = ctx.get(UPDATE_VISIBILITY_AGENT_KEY) as Agent;
      try {
        await store.saveResource(
          ApiResourceKind.agent,
          agent.metadata?.id ?? "",
          AgentSchema,
          agent,
        );
      } catch (error) {
        throw internalError(error, "failed to save agent");
      }
    },
  };
}

/**
 * Re-indexes after the visibility change (visibility is an indexed field).
 * Domain-local because the shared IndexSearch reads newState, which is the
 * UpdateVisibilityInput here, not the agent. Best-effort by contract.
 */
function newIndexAgentAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexAgentAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const agent = ctx.get(UPDATE_VISIBILITY_AGENT_KEY) as Agent;
      const entry = agentSearchExtractor.getSearchIndexEntry(agent);
      if (entry === undefined) {
        logger.warn(
          "IndexAgentAfterVisibilityUpdate: extractor returned nil, skipping",
          { id: agent.metadata?.id ?? "" },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ApiResourceKind.agent,
          agent.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn("IndexAgentAfterVisibilityUpdate: failed (best-effort)", {
          id: agent.metadata?.id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** Get — LoadTarget by id (Go's chain has no ExtractResourceId here). */
async function get(
  deps: AgentControllerDeps,
  id: AgentId,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentQueryController.method.get.input>(
    "agent-get",
    deps.logger,
  )
    .addStep(newAuthorizeStep(AgentQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, AgentSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Agent;
}

/**
 * GetByReference — slug+org lookup with the version ladder (empty or
 * "latest" is the head, a 64-hex hash or a tag an archived version), then
 * the loaded row authorized exactly as `get` is; an archived snapshot
 * shares the head's id.
 */
async function getByReference(
  deps: AgentControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentQueryController.method.getByReference.input>(
    "agent-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadAgentByReferenceStep(deps.store))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(AgentQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Agent;
}

// ---------------------------------------------------------------------------
// Versions — the history, one version by hash, and the tag move, on the
// shared version machinery (versions.ts).
// ---------------------------------------------------------------------------

type ListVersionsDesc = typeof AgentQueryController.method.listVersions.input;

/**
 * listVersions — the version history, newest first, offset-paginated.
 * is_current marks the version whose hash is the live head's. The input
 * names org+slug, so the annotation skips and the resolved agent is
 * authorized mid-chain as `get` would be; an unknown slug is NotFound
 * first.
 */
async function listVersions(
  deps: AgentControllerDeps,
  input: ListAgentVersionsInput,
  ctx: HandlerContext,
): Promise<ListAgentVersionsResponse> {
  const reqCtx = new RequestContext(
    AgentQueryController.method.listVersions.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListVersionsDesc>("agent-list-versions", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentQueryController.method.listVersions,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveAgentBySlugStep(deps.store))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        versionHistoryTarget(
          ApiResourceKind.agent,
          "unauthorized to view agent version history",
        ),
        "AuthorizeResolvedAgent",
      ),
    )
    .addStep(newLoadAndMapAgentVersionsStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_VERSIONS_RESPONSE_KEY) as ListAgentVersionsResponse;
}

/**
 * getVersion — one version by hash, with its full spec: what a turn
 * recorded on that version runs. The validation interceptor has already
 * refused an empty agent_id and a hash that is not 64 hex characters (the
 * input's field rules); the annotation's can_view on agent_id is evaluated
 * here (the lane has no pipeline).
 */
async function getVersion(
  deps: AgentControllerDeps,
  req: GetAgentVersionInput,
  identity: CallerIdentity,
): Promise<AgentVersionEntry> {
  await authorizeDirect(
    AgentQueryController.method.getVersion,
    deps.authorizer,
    identity,
    req,
  );
  return getVersionEntry(deps.store, agentVersionBinding, {
    resourceId: req.agentId,
    versionHash: req.versionHash,
  });
}

type TagVersionDesc = typeof AgentCommandController.method.tagVersion.input;

/**
 * tagVersion — moves a tag single-holder onto a version the agent has, then
 * reconciles the head's live tag with its version's. A plugin-managed
 * agent's tags are its plugin's, so a client is refused naming it.
 */
async function tagVersion(
  deps: AgentControllerDeps,
  input: TagAgentVersionInput,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentCommandController.method.tagVersion.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<TagVersionDesc>("agent-tag-version", deps.logger)
    .addStep(
      newAuthorizeStep(AgentCommandController.method.tagVersion, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadAgentForTagVersionStep(deps.store))
    .addStep(
      newGuardPluginManagedStep(deps.store, {
        existingKey: TAG_VERSION_AGENT_KEY,
      }),
    )
    .addStep(newTagAgentVersionStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TAG_VERSION_RESULT_KEY) as Agent;
}
