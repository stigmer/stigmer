/**
 * Run task workflow orchestrator — child workflow execution.
 *
 * Handles the `run.workflow` variant by executing a child Temporal
 * workflow. Supports two modes:
 * - await: true — blocks until child completes, returns its result
 * - await: false — fire-and-forget with PARENT_CLOSE_POLICY_ABANDON
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow isolate.
 */

import { executeChild, ParentClosePolicy } from "@temporalio/workflow";

import type { RunWorkflowExecutionConfig } from "../workflow-engine/types.js";

/**
 * Executes a child workflow based on the run task configuration.
 */
export async function orchestrateRunWorkflow(
  config: RunWorkflowExecutionConfig,
): Promise<unknown> {
  const childHandle = await executeChild(config.name, {
    args: config.input !== undefined ? [config.input] : [],
    parentClosePolicy: config.await
      ? ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE
      : ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
  });

  if (!config.await) {
    return undefined;
  }

  return childHandle;
}
