/**
 * Agent controller — ports pkg/domain/agent/controller (command + query
 * sides): the agent BLUEPRINT surface. Create provisions the agent's
 * default instance through the in-process agentinstance client (the
 * agent↔agentinstance mutual edge, wired as a lazy provider in the
 * composition root — sub-project DD-002); delete cascades ALL instances
 * (oss#611) and same-org shares before the agent row; GetDefault serves
 * the platform default-agent resolution (defaultagent.ts).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by agent.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/agent.test.ts.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (no multi-tenant auth, IAM/FGA, or event publishing here).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  AgentId,
  GetDefaultAgentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
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
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
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
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { agentSearchExtractor } from "./search-extractor.js";
import {
  newCascadeDeleteInstancesStep,
  newCascadeDeleteSharesStep,
  newCreateDefaultInstanceStep,
  newLoadDefaultAgentStep,
  newMergeMcpServerEnvSpecsStep,
  newUpdateAgentStatusWithDefaultInstanceStep,
  newValidateEnabledToolsStep,
} from "./steps.js";
import type { AgentInstanceApplierProvider } from "./steps.js";

export interface AgentControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /**
   * The agentinstance in-process edge — a lazy provider because
   * agent↔agentinstance is a true dependency cycle (DD-002; the ratified
   * DI story breaks cycles with `() => client` closures resolved at call
   * time, never at construction).
   */
  readonly agentInstanceApplier: AgentInstanceApplierProvider;
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
  });
  router.service(AgentQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getDefault: (req, ctx) => getDefault(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline: the default instance is
 * applied AFTER Persist (children need the parent's id), then the agent's
 * status.default_instance_id is written in an explicit second persist.
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
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store))
    .addStep(newValidateEnabledToolsStep(deps.store))
    .addStep(newMergeMcpServerEnvSpecsStep(deps.store, deps.logger))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(
      newCreateDefaultInstanceStep(deps.agentInstanceApplier, deps.logger),
    )
    .addStep(
      newUpdateAgentStatusWithDefaultInstanceStep(deps.store, deps.logger),
    )
    .addStep(newIndexSearchStep(deps.store, agentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline. */
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
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store))
    .addStep(newValidateEnabledToolsStep(deps.store))
    .addStep(newMergeMcpServerEnvSpecsStep(deps.store, deps.logger))
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, agentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline decides
 * existence, then delegates to Create or Update with the ORIGINAL request
 * message (Go delegates `agent`, not the pipeline's mutated clone).
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
    : update(deps, agent, ctx);
}

/**
 * Delete — cascades children before the parent (delete_cascade.go):
 * ALL instances, then same-org shares, then the agent row and its index
 * entry. Returns the deleted agent (the audit-trail convention).
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
    .addStep(newCascadeDeleteInstancesStep(deps.store, deps.logger))
    .addStep(newCascadeDeleteSharesStep(deps.store, deps.logger))
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
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_AGENT_KEY))
    .addStep(newValidateVisibilityUpdateStep())
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

/** Loads the agent by resource_id; ANY load failure → NotFound. */
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
      } catch {
        throw notFoundError("agent", input.resourceId);
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

/** GetByReference — slug+org lookup. */
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
    .addStep(newLoadByReferenceStep(deps.store, AgentSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Agent;
}

/**
 * GetDefault — the platform default agent (label + visibility_public,
 * incumbent-wins). Used by frontends for the session-first UX where users
 * start a conversation without explicitly selecting an agent.
 */
async function getDefault(
  deps: AgentControllerDeps,
  req: GetDefaultAgentRequest,
  ctx: HandlerContext,
): Promise<Agent> {
  const reqCtx = new RequestContext(
    AgentQueryController.method.getDefault.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentQueryController.method.getDefault.input>(
    "agent-get-default",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(AgentQueryController.method.getDefault, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadDefaultAgentStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Agent;
}
