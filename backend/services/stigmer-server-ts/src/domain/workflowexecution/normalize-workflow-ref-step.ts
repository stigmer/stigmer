/**
 * NormalizeWorkflowRef — ports normalize_workflow_ref_step.go: guarantees
 * spec.workflow_id is populated by denormalizing it from the execution's
 * workflow instance. Without it, an instance-only create detaches the
 * execution from its parent Workflow in every workflow-scoped query
 * (ListByWorkflow and GetExecutionSummary match on either spec field). An
 * instance's parent Workflow is immutable, so the denormalization cannot
 * drift.
 *
 * Pipeline position: after CreateDefaultInstanceIfNeeded (which
 * guarantees spec.workflow_instance_id) and before PinWorkflowVersion.
 * Resolution is best-effort: load failures and missing ids warn and
 * continue rather than failing the create.
 */
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";

export function newNormalizeWorkflowRefStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof WorkflowExecutionSchema> {
  return {
    name: "NormalizeWorkflowRef",
    async execute(ctx) {
      const execution = ctx.newState;
      const executionId = execution.metadata?.id ?? "";

      if ((execution.spec?.workflowId ?? "") !== "") {
        return;
      }
      const instanceId = execution.spec?.workflowInstanceId ?? "";
      if (instanceId === "") {
        logger.warn(
          "Cannot resolve spec.workflow_id: workflow_instance_id is empty",
          { executionId },
        );
        return;
      }

      let instance: WorkflowInstance;
      try {
        instance = await store.getResource(
          ApiResourceKind.workflow_instance,
          instanceId,
          WorkflowInstanceSchema,
        );
      } catch (error) {
        logger.warn(
          "Cannot resolve spec.workflow_id: failed to load workflow instance",
          {
            executionId,
            workflowInstanceId: instanceId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      const workflowId = instance.spec?.workflowId ?? "";
      if (workflowId === "") {
        logger.warn(
          "Cannot resolve spec.workflow_id: instance has no workflow_id",
          { executionId, workflowInstanceId: instanceId },
        );
        return;
      }

      if (execution.spec !== undefined) {
        execution.spec.workflowId = workflowId;
      }
    },
  };
}
