/**
 * Workflow-side orchestrator for call:agent tasks.
 *
 * Runs inside the Temporal deterministic workflow sandbox. Manages:
 * 1. Starting the CallAgent activity (async completion)
 * 2. Listening for `child_approval_required` signals from child agents
 * 3. Updating workflow approval status via local activities
 * 4. Returning the agent result when the activity completes
 *
 * The kernel's CallAgentTaskBuilder calls `ctx.callAgent()`, which
 * is wired to `orchestrateAgentCall()` in execute-serverless-workflow.ts.
 *
 * SANDBOX RULES: Only @temporalio/workflow imports, type-only imports,
 * and pure logic. No Node.js built-ins.
 */

import {
  defineSignal,
  setHandler,
  condition,
  proxyActivities,
  proxyLocalActivities,
  log,
  CancellationScope,
  isCancellation,
} from "@temporalio/workflow";

import type { createCallAgentActivities } from "../activities/call-agent.js";
import type { createCallAgentStatusActivities } from "../activities/call-agent-status.js";
import type { AgentCallConfig, AgentCallResult } from "../workflow-engine/types.js";
import type { ChildApprovalNotification } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";

// ─────────────────────────────────────────────────────────────────────
// Signal Definition
// ─────────────────────────────────────────────────────────────────────

export const childApprovalRequired = defineSignal<[ChildApprovalNotification]>(
  "child_approval_required",
);

// ─────────────────────────────────────────────────────────────────────
// Activity Proxies
// ─────────────────────────────────────────────────────────────────────

type AgentActivities = ReturnType<typeof createCallAgentActivities>;
type StatusActivities = ReturnType<typeof createCallAgentStatusActivities>;

const agentProxy = proxyActivities<AgentActivities>({
  startToCloseTimeout: "1h",
  retry: {
    maximumAttempts: 1,
  },
});

const statusProxy = proxyLocalActivities<StatusActivities>({
  startToCloseTimeout: "30s",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2s",
    backoffCoefficient: 2,
  },
});

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

export interface AgentCallOrchestrationInput {
  config: AgentCallConfig;
  runtimeEnv: Record<string, unknown>;
  parentWorkflowId: string;
  taskName: string;
  workflowExecutionId: string;
}

/**
 * Orchestrates a call:agent task from the workflow function.
 *
 * Starts the CallAgent activity (async completion), sets up a signal
 * handler for HITL approval notifications, and waits for the activity
 * to complete. Returns the agent's result.
 */
export async function orchestrateAgentCall(
  input: AgentCallOrchestrationInput,
): Promise<AgentCallResult> {
  let activityDone = false;
  let activityResult: AgentCallResult = {};
  let activityError: unknown = undefined;
  let pendingNotification: ChildApprovalNotification | undefined;

  setHandler(childApprovalRequired, (notification: ChildApprovalNotification) => {
    pendingNotification = notification;
  });

  const enrichedConfig = {
    ...input.config,
    __taskName: input.taskName,
  };

  const activityPromise = agentProxy
    .CallAgent(enrichedConfig, input.runtimeEnv, input.parentWorkflowId)
    .then((result) => {
      activityResult = (result ?? {}) as AgentCallResult;
      activityDone = true;
    })
    .catch((err) => {
      if (isCancellation(err)) {
        activityDone = true;
        return;
      }
      activityError = err;
      activityDone = true;
    });

  while (!activityDone) {
    await condition(() => activityDone || pendingNotification !== undefined);

    if (pendingNotification && !activityDone) {
      const notification = pendingNotification;
      pendingNotification = undefined;

      try {
        await statusProxy.UpdateWorkflowTaskApprovalStatus(
          input.workflowExecutionId,
          input.taskName,
          notification,
        );
      } catch (statusErr) {
        log.warn("Failed to update workflow approval status (non-fatal)", {
          error: String(statusErr),
          taskName: input.taskName,
        });
      }
    }
  }

  try {
    await statusProxy.ClearWorkflowApprovalStatus(input.workflowExecutionId);
  } catch (clearErr) {
    log.warn("Failed to clear workflow approval status (non-fatal)", {
      error: String(clearErr),
    });
  }

  if (activityError) {
    throw activityError;
  }

  return activityResult;
}
