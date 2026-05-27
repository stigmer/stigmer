/**
 * Temporal workflow for executing CNCF Serverless Workflow definitions.
 *
 * Workflow type: "stigmer/workflow/execute"
 *
 * Accepts a fully materialized {@link ExecuteServerlessWorkflowInput}
 * (parsed WorkflowModel, merged env, workflow_input) and runs the
 * engine. Callers that already have the materialized input use this
 * workflow directly. The hydration wrapper workflow
 * ("stigmer/workflow/execute-from-execution") handles the case where
 * only slim IDs are available.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { isCancellation } from "@temporalio/workflow";
import type { WorkflowModel } from "../workflow-engine/types.js";
import { runWorkflowEngine } from "./engine-core.js";
import { setupPauseResumeHandlers } from "./workflow-signals.js";

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Input/Output Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteServerlessWorkflowInput {
  model: WorkflowModel;
  workflow_input: unknown;
  env: Record<string, unknown>;
  metadata?: ExecutionMetadata;
}

export interface ExecutionMetadata {
  execution_id?: string;
  workflow_id?: string;
  workflow_instance_id?: string;
  org_id?: string;
  execution_target?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Function
// ─────────────────────────────────────────────────────────────────────────────

export async function executeServerlessWorkflow(
  input: ExecuteServerlessWorkflowInput,
): Promise<unknown> {
  const { checkPause } = setupPauseResumeHandlers();

  try {
    return await runWorkflowEngine(input, { checkPause });
  } catch (err) {
    if (isCancellation(err)) {
      // Let CancelledFailure propagate — parent handles cleanup
    }
    throw err;
  }
}
