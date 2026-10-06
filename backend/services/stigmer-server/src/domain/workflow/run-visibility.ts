/**
 * A workflow's run audience: who may observe its runs (executions), kept
 * apart from who may see and run the workflow itself. The level is
 * `spec.execution_visibility`; open source authorizes run reads from the
 * row at check time (authorization/model/execution-viewer.ts), and an
 * edition that stores tuples hears the audience the level names through
 * `onExecutionVisibilityChanged`.
 *
 * The level's lifecycle:
 *   - create stores whatever the request carried and, when the level names
 *     an audience, tells the driver (CreateExecutionVisibilityTuples);
 *   - update and apply keep the stored level whatever the request carried
 *     (PreserveExecutionVisibility), the rule metadata.visibility follows
 *     (oss#573): the level has its own door, so a stale manifest value is
 *     routine and must not fail the update;
 *   - updateRunVisibility is that door: it asks can_manage_audience
 *     (the owner's, never an editor's), stores the level and tells the
 *     driver the audience it names, every time.
 *
 * The level is part of the spec but not of the workflow's version: the
 * version hash clears it (steps.ts `workflowVersionHash`), so this module
 * never touches the version machinery and a toggle mints no version.
 *
 * Proven by workflow.conformance.test.ts (the run-visibility arms,
 * CONFORMANCE_TARGET=local) and __tests__/execution-visibility.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type {
  RunVisibilityChangedEvent,
  ResourceAuthorizationLifecycle,
} from "../../extensions/resource-authorization.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  runAudienceShapes,
  notifyExecutionVisibilityChanged,
} from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { workflowSearchExtractor } from "./search-extractor.js";

type WorkflowDesc = typeof WorkflowSchema;

/** Where the updateRunVisibility chain keeps the workflow it loaded and changes. */
export const UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY =
  "updateExecutionVisibilityWorkflow";

/** The run-audience event for a persisted workflow: the audience its stored level names. */
function executionVisibilityEventOf(
  workflow: Workflow,
): RunVisibilityChangedEvent {
  return {
    workflowId: workflow.metadata?.id ?? "",
    orgId: workflow.metadata?.org ?? "",
    shapes: [
      ...runAudienceShapes(
        workflow.spec?.runVisibility ??
          WorkflowRunVisibility.unspecified,
      ),
    ],
  };
}

/**
 * PreserveExecutionVisibility — the run audience is update-immutable: the
 * stored `spec.execution_visibility` replaces whatever the request carried,
 * after BuildUpdateState's full spec replacement, so a manifest re-applied
 * without the field, or with a stale level, never silently changes who
 * observes the runs. Runs after LoadExisting; Apply delegates to Update, so
 * the apply door is covered too, and Update needs no run-audience event.
 */
export function newPreserveExecutionVisibilityStep(): PipelineStep<WorkflowDesc> {
  return {
    name: "PreserveExecutionVisibility",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Workflow | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing workflow not found in context"),
          "existing workflow not found in context",
        );
      }
      const merged = ctx.newState;
      if (merged.spec !== undefined) {
        merged.spec.runVisibility =
          existing.spec?.runVisibility ??
          WorkflowRunVisibility.unspecified;
      }
    },
  };
}

/**
 * CreateExecutionVisibilityTuples — post-persist in the create chain,
 * beside CreateAuthorizationTuples: a workflow created with a level that
 * names an audience (ORGANIZATION) tells the driver, which writes the
 * `run_viewer` tuple the runs are read through. A private or unset
 * create names nobody and fires nothing (there is no tuple to remove). The
 * failure copy is the create lane's own.
 */
export function newCreateExecutionVisibilityTuplesStep(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
): PipelineStep<WorkflowDesc> {
  return {
    name: "CreateExecutionVisibilityTuples",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      const event = executionVisibilityEventOf(ctx.newState);
      if (event.shapes.length === 0) {
        return;
      }
      await notifyExecutionVisibilityChanged(
        lifecycle,
        event,
        "failed to create authorization tuples",
      );
    },
  };
}

/**
 * UpdateExecutionVisibilityTuples — post-persist in the
 * updateRunVisibility chain: fires the audience the new level names,
 * the empty one included, every time. The event is the target state, so a
 * repeat of the same level converges and a transition away from
 * ORGANIZATION removes the tuple without knowing the old level.
 */
export function newUpdateExecutionVisibilityTuplesStep<
  Desc extends DescMessage,
>(lifecycle: ResourceAuthorizationLifecycle | undefined): PipelineStep<Desc> {
  return {
    name: "UpdateExecutionVisibilityTuples",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const workflow = ctx.get(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY) as
        | Workflow
        | undefined;
      if (workflow?.metadata === undefined || workflow.metadata.id === "") {
        return;
      }
      await notifyExecutionVisibilityChanged(
        lifecycle,
        executionVisibilityEventOf(workflow),
        "failed to update execution visibility tuples",
      );
    },
  };
}

/** Loads the workflow by resource_id; a missing one answers NotFound, a store fault Internal. */
export function newLoadWorkflowForExecutionVisibilityUpdateStep<
  Desc extends DescMessage,
>(
  store: Store,
  resourceIdOf: (ctx: RequestContext<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: "LoadWorkflowForExecutionVisibilityUpdate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const resourceId = resourceIdOf(ctx);
      let workflow: Workflow;
      try {
        workflow = await store.getResource(
          ApiResourceKind.workflow,
          resourceId,
          WorkflowSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("workflow", resourceId);
        }
        throw internalError(error, "failed to load workflow");
      }
      ctx.set(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY, workflow);
    },
  };
}

/** Sets spec.execution_visibility and refreshes the status-audit fields. */
export function newSetWorkflowExecutionVisibilityStep<
  Desc extends DescMessage,
>(
  levelOf: (ctx: RequestContext<Desc>) => WorkflowRunVisibility,
): PipelineStep<Desc> {
  return {
    name: "SetWorkflowExecutionVisibility",
    execute(ctx: RequestContext<Desc>): void {
      const workflow = ctx.get(
        UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
      ) as Workflow;

      workflow.spec ??= create(WorkflowSpecSchema);
      workflow.spec.runVisibility = levelOf(ctx);
      setAuditFieldsForUpdate(
        WorkflowSchema,
        workflow,
        "status_audit",
        ctx.callerIdentity,
      );

      ctx.set(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY, workflow);
    },
  };
}

/** Persists the changed workflow row; a store fault is Internal. */
export function newPersistWorkflowForExecutionVisibilityUpdateStep<
  Desc extends DescMessage,
>(store: Store): PipelineStep<Desc> {
  return {
    name: "PersistWorkflowForExecutionVisibilityUpdate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const workflow = ctx.get(
        UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
      ) as Workflow;
      try {
        await store.saveResource(
          ApiResourceKind.workflow,
          workflow.metadata?.id ?? "",
          WorkflowSchema,
          workflow,
        );
      } catch (error) {
        throw internalError(error, "failed to save workflow");
      }
    },
  };
}

/** Best-effort reindex after the level changes (a stale entry is cosmetic). */
export function newIndexWorkflowAfterExecutionVisibilityUpdateStep<
  Desc extends DescMessage,
>(store: Store, logger: Logger): PipelineStep<Desc> {
  return {
    name: "IndexWorkflowAfterExecutionVisibilityUpdate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const workflow = ctx.get(
        UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
      ) as Workflow;
      const id = workflow.metadata?.id ?? "";
      const entry = workflowSearchExtractor.getSearchIndexEntry(workflow);
      if (entry === undefined) {
        logger.warn(
          "IndexWorkflowAfterExecutionVisibilityUpdate: extractor returned nil, skipping",
          { id },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(ApiResourceKind.workflow, id, entry);
      } catch (error) {
        logger.warn(
          "IndexWorkflowAfterExecutionVisibilityUpdate: failed (best-effort)",
          {
            error: error instanceof Error ? error.message : String(error),
            id,
          },
        );
      }
    },
  };
}
