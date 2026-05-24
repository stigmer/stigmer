/**
 * Workflow-side orchestrator for call:agent tasks.
 *
 * Runs inside the Temporal deterministic workflow sandbox. Manages:
 * 1. Starting the CallAgent activity (async completion)
 * 2. Listening for `child_execution_started` to get early child execution ID
 * 3. Listening for `child_approval_required` signals from child agents
 * 4. Updating workflow approval status via local activities
 * 5. Returning the agent result when the activity completes
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
import type { createWorkflowEventActivities } from "../activities/workflow-event-activities.js";
import type { AgentCallConfig, AgentCallResult, WorkflowEventDescriptor } from "../workflow-engine/types.js";
import type { ChildApprovalNotification } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";

// ─────────────────────────────────────────────────────────────────────
// Signal Definitions
// ─────────────────────────────────────────────────────────────────────

export const childApprovalRequired = defineSignal<[ChildApprovalNotification]>(
  "child_approval_required",
);

/** Sent by the platform immediately after the child AgentExecution starts. */
export const childExecutionStarted = defineSignal<[{ executionId: string }]>(
  "child_execution_started",
);

// ─────────────────────────────────────────────────────────────────────
// Activity Proxies
// ─────────────────────────────────────────────────────────────────────

type AgentActivities = ReturnType<typeof createCallAgentActivities>;
type StatusActivities = ReturnType<typeof createCallAgentStatusActivities>;
type EventActivities = ReturnType<typeof createWorkflowEventActivities>;

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

const eventProxy = proxyLocalActivities<EventActivities>({
  startToCloseTimeout: "10s",
  retry: {
    maximumAttempts: 2,
    initialInterval: "500ms",
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
  let childExecId: string | undefined;
  let progressEmitted = false;

  setHandler(childApprovalRequired, (notification: ChildApprovalNotification) => {
    pendingNotification = notification;
    if (!childExecId && notification.executionId) {
      childExecId = notification.executionId;
    }
  });

  setHandler(childExecutionStarted, ({ executionId }) => {
    childExecId = executionId;
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
    await condition(
      () => activityDone || pendingNotification !== undefined || (!!childExecId && !progressEmitted),
    );

    // Emit agent_call_progress with childExecutionId as soon as it's known
    if (childExecId && !progressEmitted && !activityDone) {
      progressEmitted = true;
      try {
        const progressEvent: WorkflowEventDescriptor = {
          type: "agent_call_progress",
          taskName: input.taskName,
          occurredAt: new Date().toISOString(),
          childExecutionId: childExecId,
          agentSlug: input.config.agent ?? "",
          agentPhase: "",
          currentToolName: "",
          tokensConsumed: 0,
          messagesCount: 0,
          toolCallsCount: 0,
        };
        await eventProxy.EmitWorkflowEvents(input.workflowExecutionId, [progressEvent], []);
      } catch (emitErr) {
        log.warn("Failed to emit agent_call_progress (non-fatal)", {
          error: String(emitErr),
          taskName: input.taskName,
        });
      }
    }

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
