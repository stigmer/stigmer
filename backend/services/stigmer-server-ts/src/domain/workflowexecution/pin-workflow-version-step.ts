/**
 * PinWorkflowVersion — ports pin_workflow_version_step.go: stamps the
 * workflow's current status.version_hash onto
 * execution.status.workflow_version_hash, permanently tying the run to
 * the definition active at creation time (the runner executes the pinned
 * version even if the workflow is updated before hydration; the viewer
 * renders the correct historical graph).
 *
 * Every miss is a graceful skip: no resolvable workflow_id, a failed
 * workflow load, or an empty hash (pre-versioning workflows) leaves the
 * field empty and the runner falls back to the live workflow.
 */
import { create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";

type ExecutionDesc = typeof WorkflowExecutionSchema;

export function newPinWorkflowVersionStep(
  store: Store,
  logger: Logger,
): PipelineStep<ExecutionDesc> {
  return {
    name: "PinWorkflowVersion",
    async execute(ctx) {
      const execution = ctx.newState;

      // Priority: spec.workflow_id > input.spec.workflow_id > resolve
      // from the instance (mirrors the runner's resolveWorkflowId).
      let workflowId = execution.spec?.workflowId ?? "";
      if (workflowId === "") {
        workflowId = ctx.input.spec?.workflowId ?? "";
      }
      if (workflowId === "") {
        workflowId = await resolveWorkflowIdFromInstance(store, logger, ctx);
      }
      if (workflowId === "") {
        return;
      }

      let workflow: Workflow;
      try {
        workflow = await store.getResource(
          ApiResourceKind.workflow,
          workflowId,
          WorkflowSchema,
        );
      } catch (error) {
        logger.warn(
          "Failed to load workflow for version pinning — execution will use live workflow at hydration",
          {
            workflowId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

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

async function resolveWorkflowIdFromInstance(
  store: Store,
  logger: Logger,
  ctx: RequestContext<ExecutionDesc>,
): Promise<string> {
  let instanceId = ctx.newState.spec?.workflowInstanceId ?? "";
  if (instanceId === "") {
    instanceId = ctx.input.spec?.workflowInstanceId ?? "";
  }
  if (instanceId === "") {
    return "";
  }
  try {
    const instance = await store.getResource(
      ApiResourceKind.workflow_instance,
      instanceId,
      WorkflowInstanceSchema,
    );
    return instance.spec?.workflowId ?? "";
  } catch (error) {
    logger.debug("Could not load workflow instance for version pin resolution", {
      workflowInstanceId: instanceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}
