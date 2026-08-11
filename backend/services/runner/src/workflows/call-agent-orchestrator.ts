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
 * The workflow engine's CallAgentTaskBuilder (workflow-engine/tasks/
 * call-agent.ts) calls `ctx.callAgent()`, which is wired to
 * `orchestrateAgentCall()` in execute-serverless-workflow.ts.
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
import type { createCallAgentStatusActivities, AgentProgressSummary } from "../activities/call-agent-status.js";
import type { createWorkflowEventActivities } from "../activities/workflow-event-activities.js";
import type { AgentCallConfig, AgentCallResult, WorkflowEventDescriptor } from "../workflow-engine/types.js";
import { AgentCallError } from "../workflow-engine/types.js";
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

// The 1h ceiling is a deliberate platform constant, not a user knob: the
// old AgentCallTaskConfig declared a per-task `timeout` that nothing ever
// read, and #358 deleted it rather than declaring what isn't honored. The
// real per-run bound is run_config.max_cost_usd, enforced inside the
// agent execution itself.
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
  /**
   * Allocator for the workflow-owned event sequence counter, shared with
   * engine-core's emit funnel so progress events and task events draw
   * from one monotonic series. Safe to pass as a closure — the
   * orchestrator is a plain function call inside the same workflow run,
   * not a child workflow. Undefined when replaying pre-patch histories
   * (the emit activity then assigns from its legacy counter).
   */
  nextEventSequence?: () => number;
}

/**
 * Orchestrates a call:agent task from the workflow function.
 *
 * Starts the CallAgent activity (async completion), sets up a signal
 * handler for HITL approval notifications, and waits for the activity
 * to complete. Returns the agent's result.
 */
const PROGRESS_POLL_INTERVAL = "15s";

export async function orchestrateAgentCall(
  input: AgentCallOrchestrationInput,
): Promise<AgentCallResult> {
  let activityDone = false;
  let activityResult: AgentCallResult = {};
  let activityError: unknown = undefined;
  let pendingNotification: ChildApprovalNotification | undefined;
  let childExecId: string | undefined;
  let initialProgressEmitted = false;

  setHandler(childApprovalRequired, (notification: ChildApprovalNotification) => {
    pendingNotification = notification;
    if (!childExecId && notification.executionId) {
      childExecId = notification.executionId;
    }
  });

  setHandler(childExecutionStarted, (payload: { executionId: string } | string) => {
    // The Go server sends { executionId: "aex_xxx" } (struct with json tag).
    // The Java server sends "aex_xxx" (bare string via parentStub.signal(name, id)).
    // Handle both shapes for cross-implementation resilience.
    if (typeof payload === "string") {
      childExecId = payload;
    } else if (payload && typeof payload === "object" && "executionId" in payload) {
      childExecId = payload.executionId;
    }
  });

  const enrichedConfig = {
    ...input.config,
    __taskName: input.taskName,
    __wfExecId: input.workflowExecutionId,
  };

  log.info("[CallAgent orchestrator] sending to activity", {
    taskName: input.taskName,
    hasOutput: enrichedConfig.output !== undefined,
    hasOutputSchema: enrichedConfig.output?.schema !== undefined,
    configKeys: Object.keys(enrichedConfig).join(","),
    hasTaskName: !!enrichedConfig.__taskName,
  });

  const activityPromise = agentProxy
    .CallAgent(enrichedConfig, input.runtimeEnv, input.parentWorkflowId)
    .then((result) => {
      if (typeof result === "string") {
        try {
          activityResult = JSON.parse(result) as AgentCallResult;
        } catch {
          activityResult = {};
        }
      } else {
        activityResult = (result ?? {}) as AgentCallResult;
      }
      log.info("[CallAgent callback] activity result received", {
        taskName: input.taskName,
        hasStructured: activityResult.structured !== undefined,
        resultKeys: Object.keys(activityResult).join(","),
      });
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

  // Last-written file-review reference for this child, as a deterministic key, so
  // we write pending_file_reviews only when the child's AWAITING_REVIEW set changes
  // (avoids status-write storms). undefined = never written yet.
  let lastFileReviewKey: string | undefined;

  // Poll-derive the child's file-review gate and surface it (reference-only) on the
  // parent. No new Temporal signal: the orchestrator already holds the child open
  // (async-completion) and reads its status here on the same cadence as progress.
  async function syncFileReviews(childId: string): Promise<void> {
    let ids: string[];
    try {
      ids = await statusProxy.GetAwaitingFileReviewChangeSetIds(childId);
    } catch (err) {
      log.warn("Failed to derive child file-review state (non-fatal)", {
        error: String(err),
        taskName: input.taskName,
      });
      return;
    }
    // Deterministic change key (sorted): a stable comparison across replays.
    const key = [...ids].sort().join(",");
    if (key === lastFileReviewKey) return;
    lastFileReviewKey = key;
    try {
      await statusProxy.UpdateWorkflowFileReviewStatus(input.workflowExecutionId, childId, ids);
    } catch (err) {
      log.warn("Failed to update workflow file-review status (non-fatal)", {
        error: String(err),
        taskName: input.taskName,
      });
    }
  }

  while (!activityDone) {
    // Wait for a signal, activity completion, or periodic timeout for progress polling.
    // condition() returns false on timeout, true when the predicate became true.
    const conditionMet = await condition(
      () => activityDone || pendingNotification !== undefined || (!!childExecId && !initialProgressEmitted),
      PROGRESS_POLL_INTERVAL,
    );

    if (activityDone) break;

    // Emit initial progress with childExecutionId as soon as it's known
    if (childExecId && !initialProgressEmitted) {
      initialProgressEmitted = true;
      await emitProgress(input, childExecId, null);
      await syncFileReviews(childExecId);
    }

    // Periodic progress: on timeout, poll the child execution for live data
    if (!conditionMet && childExecId) {
      let progress: AgentProgressSummary | null = null;
      try {
        progress = await statusProxy.GetAgentExecutionProgress(childExecId);
      } catch (err) {
        log.warn("Failed to fetch agent progress (non-fatal)", {
          error: String(err),
          taskName: input.taskName,
        });
      }
      if (progress) {
        await emitProgress(input, childExecId, progress);
      }
      await syncFileReviews(childExecId);
    }

    // Handle HITL approval notification
    if (pendingNotification) {
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

  // Emit a final progress event if the child ID arrived but was never emitted.
  // This handles the fast-completion race: the activity finishes before the
  // orchestrator loop has a chance to process the child_execution_started signal.
  if (childExecId && !initialProgressEmitted) {
    await emitProgress(input, childExecId, null);
  }

  // Scoped clears for this child only (per-child merge) — a completing child must
  // not wipe a parallel sibling's still-pending gate. Skipped if the child never
  // started (nothing was ever surfaced for it).
  if (childExecId) {
    try {
      await statusProxy.ClearWorkflowApprovalStatus(input.workflowExecutionId, childExecId);
    } catch (clearErr) {
      log.warn("Failed to clear workflow approval status (non-fatal)", {
        error: String(clearErr),
      });
    }
    try {
      await statusProxy.UpdateWorkflowFileReviewStatus(input.workflowExecutionId, childExecId, []);
    } catch (clearErr) {
      log.warn("Failed to clear workflow file-review status (non-fatal)", {
        error: String(clearErr),
      });
    }
  }

  if (activityError) {
    if (childExecId) {
      const msg = activityError instanceof Error
        ? activityError.message
        : String(activityError);
      throw new AgentCallError(msg, childExecId);
    }
    throw activityError;
  }

  // Ensure the child execution ID is available on the result for the
  // agent_call_completed event emitted by CallAgentTaskBuilder.
  if (childExecId && !activityResult.agent_execution_id) {
    activityResult = { ...activityResult, agent_execution_id: childExecId };
  }

  return activityResult;
}

async function emitProgress(
  input: AgentCallOrchestrationInput,
  childExecId: string,
  progress: AgentProgressSummary | null,
): Promise<void> {
  try {
    const progressEvent: WorkflowEventDescriptor = {
      type: "agent_call_progress",
      taskName: input.taskName,
      occurredAt: new Date().toISOString(),
      sequenceNumber: input.nextEventSequence?.(),
      childExecutionId: childExecId,
      agentSlug: input.config.agent ?? "",
      agentPhase: progress?.agentPhase ?? 0,
      currentToolName: progress?.currentToolName ?? "",
      tokensConsumed: progress?.tokensConsumed ?? 0,
      messagesCount: progress?.messagesCount ?? 0,
      toolCallsCount: progress?.toolCallsCount ?? 0,
    };
    await eventProxy.EmitWorkflowEvents(input.workflowExecutionId, [progressEvent], []);
  } catch (emitErr) {
    log.warn("Failed to emit agent_call_progress (non-fatal)", {
      error: String(emitErr),
      taskName: input.taskName,
    });
  }
}
