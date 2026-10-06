/**
 * The workflow-execution run-target resolver: a run names its workflow
 * (`spec.workflow_id`), and the run gate asks workflow#can_execute on it
 * (the workflow's viewers: you can run what you can read). A request that
 * names none is ValidateProto's INVALID_ARGUMENT, thrown before this
 * resolver runs — never a check. Pure over the record being built.
 */
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import { runWorkflowDeniedMessage } from "./constants.js";

export function workflowExecutionRunTarget(
  execution: WorkflowRun,
): RunTarget | undefined {
  const workflowId = execution.spec?.workflowId ?? "";
  if (workflowId === "") {
    return undefined;
  }
  return {
    ...RUN_GATE_CHECKS.workflow,
    resourceId: workflowId,
    deniedMessage: runWorkflowDeniedMessage(workflowId),
  };
}
