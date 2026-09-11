/**
 * The workflow-execution run-target resolver (P1 sp.run-gate): the chain's
 * own precedence — an explicit workflow_instance_id fully names the target
 * (CreateDefaultInstanceIfNeeded returns early on it):
 * workflow_instance#can_execute; else workflow_id names the blueprint whose
 * default instance the chain resolves (or mints) only AFTER the gate:
 * workflow#can_execute (the model derives the default instance's viewers
 * from the blueprint's, so asking the blueprint's question is what lets the
 * gate precede the side effect).
 *
 * Neither set is ValidateWorkflowOrInstance's INVALID_ARGUMENT, thrown
 * before this resolver runs — never a check. Pure over the record being
 * built.
 */
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import {
  runWorkflowDeniedMessage,
  runWorkflowInstanceDeniedMessage,
} from "./constants.js";

export function workflowExecutionRunTarget(
  execution: WorkflowExecution,
): RunTarget | undefined {
  const spec = execution.spec;
  const workflowInstanceId = spec?.workflowInstanceId ?? "";
  if (workflowInstanceId !== "") {
    return {
      ...RUN_GATE_CHECKS.workflowInstance,
      resourceId: workflowInstanceId,
      deniedMessage: runWorkflowInstanceDeniedMessage(workflowInstanceId),
    };
  }
  const workflowId = spec?.workflowId ?? "";
  if (workflowId !== "") {
    return {
      ...RUN_GATE_CHECKS.workflow,
      resourceId: workflowId,
      deniedMessage: runWorkflowDeniedMessage(workflowId),
    };
  }
  return undefined;
}
