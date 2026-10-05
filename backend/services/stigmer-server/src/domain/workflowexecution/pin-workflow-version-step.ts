/**
 * PinWorkflowVersion — loads the workflow a run names
 * (`spec.workflow_id`) and stamps its current `status.version_hash` onto
 * `execution.status.workflow_version_hash`, tying the run to the
 * definition active at creation: the runner executes the pinned version
 * even if the workflow is saved before hydration, every step reads its
 * keys from that version, and the viewer renders the run's own graph.
 *
 * One load per create: the loaded row is kept under PINNED_WORKFLOW_KEY,
 * and the ExecutionContext build reads the run's declarations from it
 * instead of loading the workflow again, so the keys a run receives come
 * from the very version it pinned (a save landing between two loads could
 * otherwise split them).
 *
 * A workflow that cannot be loaded is refused NOT_FOUND naming it. Under
 * an enforcing Authorizer the run gate meets an unknown id first and
 * answers it as it answers a forbidden one; the `internal` class skips the
 * gate and trusted-local's permissive Authorizer admits any id, so this is
 * what those callers see. A workflow with no hash (saved before
 * versioning, or never valid) leaves the pin empty and the runner reads
 * the live workflow.
 */
import { create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

type ExecutionDesc = typeof WorkflowExecutionSchema;

/** Where PinWorkflowVersion keeps the workflow row it loaded and pinned. */
export const PINNED_WORKFLOW_KEY = "pinnedWorkflow";

/** The workflow PinWorkflowVersion loaded; a chain that reads it before the pin is a wiring bug. */
export function pinnedWorkflowOf(ctx: RequestContext<ExecutionDesc>): Workflow {
  const workflow = ctx.get(PINNED_WORKFLOW_KEY) as Workflow | undefined;
  if (workflow === undefined) {
    throw internalError(
      new Error("pinned workflow not found in context (PinWorkflowVersion must run first)"),
      "pinned workflow not found in context",
    );
  }
  return workflow;
}

export function newPinWorkflowVersionStep(
  store: Store,
  logger: Logger,
): PipelineStep<ExecutionDesc> {
  return {
    name: "PinWorkflowVersion",
    async execute(ctx) {
      const execution = ctx.newState;
      const workflowId = execution.spec?.workflowId ?? "";

      let workflow: Workflow;
      try {
        workflow = await store.getResource(
          ApiResourceKind.workflow,
          workflowId,
          WorkflowSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Workflow", workflowId);
        }
        throw internalError(error, "failed to load workflow");
      }
      ctx.set(PINNED_WORKFLOW_KEY, workflow);

      const versionHash = workflow.status?.versionHash ?? "";
      if (versionHash === "") {
        return;
      }

      if (execution.status === undefined) {
        execution.status = create(WorkflowExecutionStatusSchema);
      }
      execution.status.workflowVersionHash = versionHash;
      logger.info("Pinned workflow version on execution", {
        workflowId,
        versionHash: `${versionHash.slice(0, 12)}...`,
      });
    },
  };
}
