/**
 * Temporal workflow that hydrates a workflow execution from slim IDs
 * and runs the CNCF Serverless Workflow engine.
 *
 * Workflow type: "stigmer/workflow/execute-from-execution"
 *
 * This is the bridge between the Java/Go orchestrators (which pass
 * slim orchestration coordinates) and the TS workflow engine (which
 * expects a fully materialized ExecuteServerlessWorkflowInput).
 *
 * The workflow's Temporal ID is `workflow-exec-{executionId}` — the
 * same ID the Java orchestrator's relaySignal() uses. Signal handlers
 * for listen and human_input tasks register inside this workflow
 * because the engine code runs inline via runWorkflowEngine.
 *
 * Input field names use snake_case to match the Java
 * InvokeWorkflowExecutionWorkflowInput record's @JsonNaming(SnakeCaseStrategy)
 * — this is the Temporal wire contract between Java and TypeScript.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins, no non-deterministic operations.
 */

import { proxyActivities, log, isCancellation } from "@temporalio/workflow";
import { runWorkflowEngine } from "./engine-core.js";
import { setupPauseResumeHandlers } from "./workflow-signals.js";

import type { createHydrateWorkflowActivities } from "../activities/hydrate-workflow-execution.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hydration Activity Proxy
// ─────────────────────────────────────────────────────────────────────────────

type HydrateActivities = ReturnType<typeof createHydrateWorkflowActivities>;

const hydrateProxy = proxyActivities<HydrateActivities>({
  startToCloseTimeout: "2m",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Input Type (Temporal wire contract with Java/Go orchestrators)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteFromExecutionInput {
  execution_id: string;
  workflow_instance_id: string;
  workflow_id: string;
  org_id: string;
  callback_token?: Uint8Array | null;
  invoker_identity_account_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Function
// ─────────────────────────────────────────────────────────────────────────────

export async function executeFromExecution(
  input: ExecuteFromExecutionInput,
): Promise<unknown> {
  const { checkPause } = setupPauseResumeHandlers();

  log.info("Hydrating workflow execution from slim IDs", {
    executionId: input.execution_id,
    workflowId: input.workflow_id,
    workflowInstanceId: input.workflow_instance_id,
    orgId: input.org_id,
  });

  const materialized = await hydrateProxy.HydrateWorkflowExecution({
    execution_id: input.execution_id,
    workflow_instance_id: input.workflow_instance_id,
    workflow_id: input.workflow_id,
    org_id: input.org_id,
  });

  log.info("Hydration complete, starting engine", {
    workflowName: materialized.model.document.name,
    envCount: Object.keys(materialized.env).length,
  });

  try {
    return await runWorkflowEngine(materialized, { checkPause });
  } catch (err) {
    if (isCancellation(err)) {
      log.info("Workflow cancelled while paused or executing", {
        executionId: input.execution_id,
      });
    }
    throw err;
  }
}
