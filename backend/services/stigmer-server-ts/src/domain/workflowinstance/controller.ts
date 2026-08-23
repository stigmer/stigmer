/**
 * WorkflowInstance controller — ports
 * pkg/domain/workflowinstance/controller (command + query sides): the
 * configured-materialization surface for workflows. Create loads the
 * parent workflow through the in-process workflow client (the other
 * direction of the mutual edge) and enforces the same-org rule; Update
 * enforces spec.workflow_id immutability (oss#646); UpdateVisibility
 * rejects default instances (oss#556, the FAILED_PRECONDITION wins over
 * the level check as in Cloud); UpdateExecutionVisibility persists the
 * run-observability axis faithfully (no FGA in OSS — the Cloud edition
 * reconciles the execution_viewer relation); Delete deliberately does NOT
 * cascade executions (oss#582 — run history survives its instance).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by workflowinstance.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and the family test
 * ../workflow/__tests__/workflow.test.ts (the mutual edge makes the two
 * domains one testable unit).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import type {
  UpdateExecutionVisibilityInput,
  WorkflowInstanceId,
} from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import { WorkflowInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { WorkflowInstanceListSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import type { GetWorkflowInstancesByWorkflowRequest, WorkflowInstanceList } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newBuildNewStateStep, setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
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
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../../pipeline/steps/load-existing.js";
import { SHOULD_CREATE_KEY, newLoadForApplyStep } from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { workflowInstanceSearchExtractor } from "./search-extractor.js";
import {
  newLoadParentWorkflowStep,
  newRejectDefaultWorkflowInstanceVisibilityUpdateStep,
  newValidateInstanceUpdateStep,
  newValidateSameOrgBusinessRuleStep,
} from "./steps.js";
import type { ParentWorkflowLoaderProvider } from "./steps.js";

export interface WorkflowInstanceControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The workflow in-process edge — a lazy provider because
   * workflow↔workflowinstance is a true dependency cycle (DD-002).
   */
  readonly parentWorkflowLoader: ParentWorkflowLoaderProvider;
}

/** Registers both workflowinstance services on the router (routes stage). */
export function registerWorkflowInstanceServices(
  router: ConnectRouter,
  deps: WorkflowInstanceControllerDeps,
): void {
  router.service(WorkflowInstanceCommandController, {
    apply: (instance, ctx) => apply(deps, instance, ctx),
    create: (instance, ctx) => createInstance(deps, instance, ctx),
    update: (instance, ctx) => update(deps, instance, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    updateExecutionVisibility: (input, ctx) =>
      updateExecutionVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteInstance(deps, id, ctx),
  });
  router.service(WorkflowInstanceQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getByWorkflow: (req, ctx) => getByWorkflow(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ---------------------------------------------------------------------------
// Command side
// ---------------------------------------------------------------------------

/** Create — chain per Go buildCreatePipeline (9 steps). */
async function createInstance(
  deps: WorkflowInstanceControllerDeps,
  instance: WorkflowInstance,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(WorkflowInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof WorkflowInstanceSchema>(
    "workflow-instance-create",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadParentWorkflowStep(deps.parentWorkflowLoader, deps.logger))
    .addStep(newValidateSameOrgBusinessRuleStep(deps.logger))
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, workflowInstanceSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline (#646 immutability guard). */
async function update(
  deps: WorkflowInstanceControllerDeps,
  instance: WorkflowInstance,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(WorkflowInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof WorkflowInstanceSchema>(
    "workflow-instance-update",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateInstanceUpdateStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, workflowInstanceSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Apply — kubectl-style create-or-update, delegating the ORIGINAL request. */
async function apply(
  deps: WorkflowInstanceControllerDeps,
  instance: WorkflowInstance,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(WorkflowInstanceSchema, instance, kindOf(ctx));
  await newPipeline<typeof WorkflowInstanceSchema>(
    "workflow-instance-apply",
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

/**
 * Delete — NO execution cascade (oss#582: run history survives its
 * instance; executions carry a denormalized workflow_id and remain
 * viewable). Returns the deleted instance.
 */
async function deleteInstance(
  deps: WorkflowInstanceControllerDeps,
  instanceId: WorkflowInstanceId,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(
    WorkflowInstanceCommandController.method.delete.input,
    instanceId,
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowInstanceCommandController.method.delete.input>(
    "workflow-instance-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, WorkflowInstanceSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted workflow instance not found in context"),
      "deleted workflow instance not found in context",
    );
  }
  return deleted as WorkflowInstance;
}

// ---------------------------------------------------------------------------
// updateVisibility — update_visibility.go: targeted metadata update with
// the default-instance guard FIRST (FAILED_PRECONDITION wins over the
// level check, as in Cloud), then the level check (after load: NOT_FOUND
// wins, as in Cloud).
// ---------------------------------------------------------------------------

const UPDATE_VISIBILITY_INSTANCE_KEY = "updateVisibilityInstance";

type UpdateVisibilityDesc =
  typeof WorkflowInstanceCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: WorkflowInstanceControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(
    WorkflowInstanceCommandController.method.updateVisibility.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "workflow-instance-update-visibility",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(
      newLoadInstanceStep<UpdateVisibilityDesc>(
        deps.store,
        UPDATE_VISIBILITY_INSTANCE_KEY,
        "LoadInstanceForVisibilityUpdate",
        (c) => c.input.resourceId,
      ),
    )
    .addStep(
      newRejectDefaultWorkflowInstanceVisibilityUpdateStep(
        deps.store,
        UPDATE_VISIBILITY_INSTANCE_KEY,
      ),
    )
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newSetInstanceVisibilityStep())
    .addStep(
      newPersistInstanceStep(
        deps.store,
        UPDATE_VISIBILITY_INSTANCE_KEY,
        "PersistInstanceForVisibilityUpdate",
      ),
    )
    .addStep(
      newIndexInstanceStep(
        deps.store,
        deps.logger,
        UPDATE_VISIBILITY_INSTANCE_KEY,
        "IndexInstanceAfterVisibilityUpdate",
      ),
    )
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as WorkflowInstance;
}

/** Sets metadata.visibility and refreshes the status-audit fields. */
function newSetInstanceVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetInstanceVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const input = ctx.input;
      const instance = ctx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as WorkflowInstance;

      instance.metadata!.visibility = input.visibility;

      try {
        setAuditFieldsForUpdate(WorkflowInstanceSchema, instance, "status_audit");
      } catch (error) {
        throw new Error(
          `failed to set audit fields: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      ctx.set(UPDATE_VISIBILITY_INSTANCE_KEY, instance);
    },
  };
}

// ---------------------------------------------------------------------------
// updateExecutionVisibility — update_execution_visibility.go: a targeted
// spec update (only spec.execution_visibility changes). In this edition
// there is a single local user and no fine-grained authorization engine,
// so run observability has no multi-user effect: the setting persists
// faithfully (the shared web/desktop UI reads it back) with no
// authorization tuples. Deliberately NOT guarded for default instances —
// cloud allows it on them too; do not "fix" that.
// ---------------------------------------------------------------------------

const UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY = "updateExecutionVisibilityInstance";

type UpdateExecutionVisibilityDesc =
  typeof WorkflowInstanceCommandController.method.updateExecutionVisibility.input;

async function updateExecutionVisibility(
  deps: WorkflowInstanceControllerDeps,
  input: UpdateExecutionVisibilityInput,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(
    WorkflowInstanceCommandController.method.updateExecutionVisibility.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<UpdateExecutionVisibilityDesc>(
    "workflow-instance-update-execution-visibility",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(
      newLoadInstanceStep<UpdateExecutionVisibilityDesc>(
        deps.store,
        UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY,
        "LoadInstanceForExecutionVisibilityUpdate",
        (c) => c.input.resourceId,
      ),
    )
    .addStep(newSetInstanceExecutionVisibilityStep())
    .addStep(
      newPersistInstanceStep(
        deps.store,
        UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY,
        "PersistInstanceForExecutionVisibilityUpdate",
      ),
    )
    .addStep(
      newIndexInstanceStep(
        deps.store,
        deps.logger,
        UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY,
        "IndexInstanceAfterExecutionVisibilityUpdate",
      ),
    )
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY) as WorkflowInstance;
}

/** Sets spec.execution_visibility and refreshes the status-audit fields. */
function newSetInstanceExecutionVisibilityStep(): PipelineStep<UpdateExecutionVisibilityDesc> {
  return {
    name: "SetInstanceExecutionVisibility",
    execute(ctx: RequestContext<UpdateExecutionVisibilityDesc>): void {
      const input = ctx.input;
      const instance = ctx.get(
        UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY,
      ) as WorkflowInstance;

      instance.spec ??= create(WorkflowInstanceSpecSchema);
      instance.spec.executionVisibility = input.executionVisibility;

      try {
        setAuditFieldsForUpdate(WorkflowInstanceSchema, instance, "status_audit");
      } catch (error) {
        throw new Error(
          `failed to set audit fields: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      ctx.set(UPDATE_EXECUTION_VISIBILITY_INSTANCE_KEY, instance);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared targeted-update plumbing (the load/persist/index trio both
// targeted updates use; Go duplicates these per pipeline — one generic
// definition per concern suffices here since the bodies are identical).
// ---------------------------------------------------------------------------

/**
 * Loads the instance by resource_id; ANY load failure → NotFound. The
 * accessor keeps the input shape compiler-checked (both targeted-update
 * inputs carry resource_id, but the compiler should prove it, not a cast).
 */
function newLoadInstanceStep<Desc extends DescMessage>(
  store: Store,
  instanceKey: string,
  stepName: string,
  resourceIdOf: (ctx: RequestContext<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const resourceId = resourceIdOf(ctx);
      let instance: WorkflowInstance;
      try {
        instance = await store.getResource(
          ApiResourceKind.workflow_instance,
          resourceId,
          WorkflowInstanceSchema,
        );
      } catch {
        throw notFoundError("workflow instance", resourceId);
      }
      ctx.set(instanceKey, instance);
    },
  };
}

function newPersistInstanceStep<Desc extends DescMessage>(
  store: Store,
  instanceKey: string,
  stepName: string,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const instance = ctx.get(instanceKey) as WorkflowInstance;
      try {
        await store.saveResource(
          ApiResourceKind.workflow_instance,
          instance.metadata?.id ?? "",
          WorkflowInstanceSchema,
          instance,
        );
      } catch (error) {
        throw internalError(error, "failed to save workflow instance");
      }
    },
  };
}

/** Best-effort reindex after a targeted update (Go warns, never fails). */
function newIndexInstanceStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
  instanceKey: string,
  stepName: string,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const instance = ctx.get(instanceKey) as WorkflowInstance;
      const entry = workflowInstanceSearchExtractor.getSearchIndexEntry(instance);
      if (entry === undefined) {
        logger.warn(`${stepName}: extractor returned nil, skipping`, {
          id: instance.metadata?.id ?? "",
        });
        return;
      }
      try {
        await store.upsertSearchIndex(
          ApiResourceKind.workflow_instance,
          instance.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn(`${stepName}: failed (best-effort)`, {
          error: error instanceof Error ? error.message : String(error),
          id: instance.metadata?.id ?? "",
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Query side
// ---------------------------------------------------------------------------

async function get(
  deps: WorkflowInstanceControllerDeps,
  instanceId: WorkflowInstanceId,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(
    WorkflowInstanceQueryController.method.get.input,
    instanceId,
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowInstanceQueryController.method.get.input>(
    "workflow-instance-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, WorkflowInstanceSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as WorkflowInstance;
}

async function getByReference(
  deps: WorkflowInstanceControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<WorkflowInstance> {
  const reqCtx = new RequestContext(
    WorkflowInstanceQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowInstanceQueryController.method.getByReference.input>(
    "workflow-instance-get-by-reference",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, WorkflowInstanceSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as WorkflowInstance;
}

/**
 * getByWorkflow — query.go: all instances of a workflow (the
 * auto-provisioned default included), filtered in-memory by
 * spec.workflow_id and — when the request carries one — by metadata.org
 * (a multi-org caller asking for one org's instances must not see another
 * org's instances of the same workflow). Cloud runs a combined
 * MongoDB/authorized-ids query; the in-memory sweep is this edition's
 * documented posture.
 */
const WORKFLOW_INSTANCE_LIST_KEY = "workflow_instance_list";

type GetByWorkflowDesc =
  typeof WorkflowInstanceQueryController.method.getByWorkflow.input;

async function getByWorkflow(
  deps: WorkflowInstanceControllerDeps,
  request: GetWorkflowInstancesByWorkflowRequest,
  ctx: HandlerContext,
): Promise<WorkflowInstanceList> {
  const reqCtx = new RequestContext(
    WorkflowInstanceQueryController.method.getByWorkflow.input,
    request,
    kindOf(ctx),
  );
  await newPipeline<GetByWorkflowDesc>(
    "workflow-instance-get-by-workflow",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByWorkflowStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const list = reqCtx.get(WORKFLOW_INSTANCE_LIST_KEY);
  if (list === undefined) {
    return create(WorkflowInstanceListSchema);
  }
  return list as WorkflowInstanceList;
}

function newLoadByWorkflowStep(
  store: Store,
  logger: Logger,
): PipelineStep<GetByWorkflowDesc> {
  return {
    name: "LoadByWorkflow",
    async execute(ctx: RequestContext<GetByWorkflowDesc>): Promise<void> {
      const request = ctx.input;
      const workflowId = request.workflowId;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ctx.apiResourceKind);
      } catch (error) {
        logger.error("failed to list workflow instances", {
          error: error instanceof Error ? error.message : String(error),
          workflowId,
        });
        throw internalError(error, "failed to list workflow instances");
      }

      const filtered: WorkflowInstance[] = [];
      for (const data of rows) {
        let instance: WorkflowInstance;
        try {
          instance = fromBinary(WorkflowInstanceSchema, data);
        } catch (error) {
          logger.warn("failed to unmarshal workflow instance, skipping", {
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (instance.spec?.workflowId !== workflowId) {
          continue;
        }
        if (request.org !== "" && instance.metadata?.org !== request.org) {
          continue;
        }
        filtered.push(instance);
      }

      logger.info("found workflow instances for workflow", {
        workflowId,
        count: filtered.length,
      });

      ctx.set(
        WORKFLOW_INSTANCE_LIST_KEY,
        create(WorkflowInstanceListSchema, { entries: filtered }),
      );
    },
  };
}
