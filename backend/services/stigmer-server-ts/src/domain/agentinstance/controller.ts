/**
 * AgentInstance controller — ports pkg/domain/agentinstance/controller
 * (command + query sides): configured materializations of an agent
 * blueprint. Create validates the parent agent through the in-process
 * agent client (the agent↔agentinstance mutual edge — sub-project DD-002);
 * update enforces the immutable spec.agent_id (oss#646); updateVisibility
 * refuses default instances outright (stigmer/stigmer#556).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by agentinstance.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/agentinstance.test.ts.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize (FGA
 * can_create_instance on the parent agent), CreateIamPolicies, and Publish
 * steps. Deliberately NO same-org rule on create, unlike WorkflowInstance:
 * an agent is a shareable blueprint, and one agent legitimately has
 * instances in several orgs (the marketplace case) — cloud governs
 * cross-org creation with FGA on the parent agent; OSS has no
 * authorization layer, so cross-org creation is allowed.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type {
  AgentInstanceId,
  AgentInstanceList,
  GetAgentInstancesByAgentRequest,
  ListAgentInstancesRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
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
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { agentInstanceSearchExtractor } from "./search-extractor.js";
import {
  INSTANCE_LIST_KEY,
  LIST_RESULT_KEY,
  UPDATE_VISIBILITY_INSTANCE_KEY,
  newListByOrgAndLabelsStep,
  newLoadByAgentStep,
  newLoadParentAgentStep,
  newRejectDefaultInstanceVisibilityUpdateStep,
  newValidateInstanceUpdateStep,
} from "./steps.js";
import type { ParentAgentLoaderProvider } from "./steps.js";

export interface AgentInstanceControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The agent in-process edge — a lazy provider because
   * agent↔agentinstance is a true dependency cycle (DD-002; the ratified
   * DI story breaks cycles with `() => client` closures resolved at call
   * time, never at construction).
   */
  readonly parentAgentLoader: ParentAgentLoaderProvider;
}

/** Registers both agentinstance services on the router (routes stage). */
export function registerAgentInstanceServices(
  router: ConnectRouter,
  deps: AgentInstanceControllerDeps,
): void {
  router.service(AgentInstanceCommandController, {
    apply: (instance, ctx) => apply(deps, instance, ctx),
    create: (instance, ctx) => createInstance(deps, instance, ctx),
    update: (instance, ctx) => update(deps, instance, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteInstance(deps, id, ctx),
  });
  router.service(AgentInstanceQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline: the parent agent is loaded
 * (and an unknown spec.agent_id rejected, oss#645) BEFORE the duplicate
 * check, exactly Go's order.
 */
async function createInstance(
  deps: AgentInstanceControllerDeps,
  instance: AgentInstance,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(AgentInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof AgentInstanceSchema>(
    "agent-instance-create",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadParentAgentStep(deps.parentAgentLoader, deps.logger))
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, agentInstanceSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline (agent_id immutable). */
async function update(
  deps: AgentInstanceControllerDeps,
  instance: AgentInstance,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(AgentInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof AgentInstanceSchema>(
    "agent-instance-update",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateInstanceUpdateStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, agentInstanceSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update; delegates with the ORIGINAL
 * request message. The create route is the default-instance path (the
 * agent controller's CreateDefaultInstance applies through here); the
 * update route is the self-heal for pre-cascade legacy orphans.
 */
async function apply(
  deps: AgentInstanceControllerDeps,
  instance: AgentInstance,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(AgentInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof AgentInstanceSchema>(
    "agent-instance-apply",
    deps.logger,
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
    ? createInstance(deps, instance, ctx)
    : update(deps, instance, ctx);
}

/** Delete — no cascade of its own; returns the deleted instance. */
async function deleteInstance(
  deps: AgentInstanceControllerDeps,
  instanceId: AgentInstanceId,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(
    AgentInstanceCommandController.method.delete.input,
    instanceId,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentInstanceCommandController.method.delete.input>(
    "agent-instance-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentInstanceSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted agent instance not found in context"),
      "deleted agent instance not found in context",
    );
  }
  return deleted as AgentInstance;
}

// ---------------------------------------------------------------------------
// updateVisibility — update_visibility.go. Step order is contract: the
// default-instance guard runs FIRST after load (FAILED_PRECONDITION wins
// over the level check, as in Cloud), then the shared level validation
// (after load: NOT_FOUND wins, as in Cloud).
// ---------------------------------------------------------------------------

type UpdateVisibilityDesc =
  typeof AgentInstanceCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: AgentInstanceControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(
    AgentInstanceCommandController.method.updateVisibility.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "agent-instance-update-visibility",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadInstanceForVisibilityUpdateStep(deps.store))
    .addStep(newRejectDefaultInstanceVisibilityUpdateStep(deps.store))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newSetInstanceVisibilityStep())
    .addStep(newPersistInstanceForVisibilityUpdateStep(deps.store))
    .addStep(newIndexInstanceAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as AgentInstance;
}

/** Loads the agent instance by resource_id; ANY load failure → NotFound. */
function newLoadInstanceForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadInstanceForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let instance: AgentInstance;
      try {
        instance = await store.getResource(
          ApiResourceKind.agent_instance,
          input.resourceId,
          AgentInstanceSchema,
        );
      } catch {
        throw notFoundError("agent instance", input.resourceId);
      }
      ctx.set(UPDATE_VISIBILITY_INSTANCE_KEY, instance);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetInstanceVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetInstanceVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const instance = ctx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as AgentInstance;
      if (instance.metadata !== undefined) {
        instance.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(AgentInstanceSchema, instance, "status_audit");
    },
  };
}

/** Persists the visibility change. */
function newPersistInstanceForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistInstanceForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const instance = ctx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as AgentInstance;
      try {
        await store.saveResource(
          ApiResourceKind.agent_instance,
          instance.metadata?.id ?? "",
          AgentInstanceSchema,
          instance,
        );
      } catch (error) {
        throw internalError(error, "failed to save agent instance");
      }
    },
  };
}

/**
 * Re-indexes after the visibility change (visibility is an indexed field).
 * Domain-local because the shared IndexSearch reads newState, which is the
 * UpdateVisibilityInput here, not the instance. Best-effort by contract.
 */
function newIndexInstanceAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexInstanceAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const instance = ctx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as AgentInstance;
      const entry = agentInstanceSearchExtractor.getSearchIndexEntry(instance);
      if (entry === undefined) {
        logger.warn(
          "IndexInstanceAfterVisibilityUpdate: extractor returned nil, skipping",
          { id: instance.metadata?.id ?? "" },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ApiResourceKind.agent_instance,
          instance.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn(
          "IndexInstanceAfterVisibilityUpdate: failed (best-effort)",
          {
            id: instance.metadata?.id ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

/** Get — ExtractResourceId + LoadTarget, exactly Go's (3-step) chain. */
async function get(
  deps: AgentInstanceControllerDeps,
  id: AgentInstanceId,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(
    AgentInstanceQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentInstanceQueryController.method.get.input>(
    "agent-instance-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, AgentInstanceSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentInstance;
}

/** GetByReference — slug+org lookup. */
async function getByReference(
  deps: AgentInstanceControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<AgentInstance> {
  const reqCtx = new RequestContext(
    AgentInstanceQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentInstanceQueryController.method.getByReference.input
  >("agent-instance-get-by-reference", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, AgentInstanceSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentInstance;
}

/** GetByAgent — all instances of one agent, optionally org-scoped. */
async function getByAgent(
  deps: AgentInstanceControllerDeps,
  req: GetAgentInstancesByAgentRequest,
  ctx: HandlerContext,
): Promise<AgentInstanceList> {
  const reqCtx = new RequestContext(
    AgentInstanceQueryController.method.getByAgent.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentInstanceQueryController.method.getByAgent.input
  >("agent-instance-get-by-agent", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadByAgentStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(INSTANCE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("instance list not found in context"),
      "instance list not found in context",
    );
  }
  return result as AgentInstanceList;
}

/** List — org + labels filter (AND semantics), newest first. */
async function list(
  deps: AgentInstanceControllerDeps,
  req: ListAgentInstancesRequest,
  ctx: HandlerContext,
): Promise<AgentInstanceList> {
  const reqCtx = new RequestContext(
    AgentInstanceQueryController.method.list.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentInstanceQueryController.method.list.input>(
    "agent-instance-list",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("agent instance list not found in context"),
      "agent instance list not found in context",
    );
  }
  return result as AgentInstanceList;
}
