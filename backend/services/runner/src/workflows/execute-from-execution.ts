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

/**
 * The Temporal workflow type this function is exported as in `index.ts` — the
 * server's `CHILD_WORKFLOW_TYPE`, byte-pinned on both sides. Named here so
 * the run-credential interceptor can gate on it without a second literal; a
 * test pins it to the barrel's export alias (an ES2022 export alias must be a
 * literal, so the barrel cannot import this).
 */
export const EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE =
  "stigmer/workflow/execute-from-execution";

export interface ExecuteFromExecutionInput {
  execution_id: string;
  workflow_instance_id: string;
  workflow_id: string;
  org_id: string;
  callback_token?: Uint8Array | null;
  invoker_identity_account_id?: string;
  recovery_mode?: boolean;
  /**
   * The run credential the server minted for this execution at dispatch —
   * absent from an older server's dispatch. This workflow never reads it: the
   * interceptor in `interceptors/run-credential.ts` lifts it onto every
   * activity this workflow schedules, as a header (`shared/run-credential.ts`).
   */
  execution_context_token?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Function
// ─────────────────────────────────────────────────────────────────────────────

export async function executeFromExecution(
  input: ExecuteFromExecutionInput,
): Promise<void> {
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
    // The engine's output is deliberately NOT returned. Both orchestrator
    // parents discard this workflow's result (Java awaits it as Void, Go
    // passes nil to Get), and the output already reaches users through
    // PromoteTaskOutput and the event log. Returning it would (a) persist
    // the full workflow output — which may embed secrets — as a plaintext
    // payload in the cross-language parent's history, and (b) hand the Java
    // parent a payload it must decode: once the payload-encryption codec is
    // active, an encrypted result would fail Java's converter lookup
    // (fromPayloads has no Void special-case). A void return produces a
    // data-less binary/null payload that every SDK handles natively.
    await runWorkflowEngine(materialized, {
      checkPause,
      recoveryMode: input.recovery_mode ?? false,
    });
  } catch (err) {
    if (isCancellation(err)) {
      log.info("Workflow cancelled while paused or executing", {
        executionId: input.execution_id,
      });
    }
    throw err;
  }
}
