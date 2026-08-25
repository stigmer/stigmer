/**
 * Workflow dispatch-queue resolution — ports
 * pkg/domain/workflowexecution/temporal/dispatch.go
 * (ResolveWorkflowTaskQueue): which Temporal task queue a workflow
 * execution's CHILD workflow starts on.
 *
 * Unlike agentexecution's dispatch (which loads the session to read its
 * harness and target), this resolution is PURE — the execution target
 * rides in on the create pipeline's spec read (the seam's
 * StartWorkflowExecutionInput.executionTarget), so there is no store
 * read and no failure lane: Go's Create has no dispatch error boundary
 * and neither does this port.
 *
 * Routing modes (config.workflowActivityRouting):
 *   - "global": always the configured runner queue (stigmer_runner) —
 *     all workflow executions share the global runner pool.
 *   - "execution": wfexec:{execution_id} regardless of execution target.
 *     For CLOUD a dedicated sandbox is provisioned for that queue; for
 *     LOCAL the desktop runner-manager creates a worker on it.
 */
import type { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import {
  WORKFLOW_ROUTING_EXECUTION,
  type WorkflowExecutionTemporalConfig,
} from "../../domain/workflowexecution/temporal/config.js";
import { formatWfExecTaskQueue } from "./names.js";

/**
 * The resolved Temporal task queue and effective execution target for a
 * workflow execution's child dispatch (Go WorkflowDispatchResult).
 */
export interface WorkflowDispatchResult {
  readonly taskQueue: string;
  readonly executionTarget: ExecutionTarget;
}

/**
 * Go ResolveWorkflowTaskQueue: resolves the child's task queue from the
 * routing mode, and UNSPECIFIED targets through the config's single
 * resolution rule.
 */
export function resolveWorkflowTaskQueue(
  executionId: string,
  executionTarget: ExecutionTarget,
  config: WorkflowExecutionTemporalConfig,
  logger: Logger,
): WorkflowDispatchResult {
  const resolved = config.resolveWorkflowExecutionTarget(executionTarget);

  if (config.workflowActivityRouting === WORKFLOW_ROUTING_EXECUTION) {
    const taskQueue = formatWfExecTaskQueue(executionId);
    logger.info("Workflow dispatch resolved per-execution queue", {
      execution_id: executionId,
      task_queue: taskQueue,
      routing_mode: config.workflowActivityRouting,
      execution_target: resolved,
    });
    return { taskQueue, executionTarget: resolved };
  }

  logger.info("Workflow dispatch resolved global queue", {
    execution_id: executionId,
    task_queue: config.runnerQueue,
    routing_mode: config.workflowActivityRouting,
    execution_target: resolved,
  });
  return { taskQueue: config.runnerQueue, executionTarget: resolved };
}
