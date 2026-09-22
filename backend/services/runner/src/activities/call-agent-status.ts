/**
 * Local activities for surfacing child agent HITL approval state
 * on the parent WorkflowExecution.
 *
 * These run as Temporal local activities (proxyLocalActivities) with
 * short timeouts. Failures are best-effort — they update the platform
 * UI but do not block the workflow.
 *
 * - UpdateWorkflowTaskApprovalStatus: sets pending_approvals on the
 *   WorkflowExecution when a child agent enters a tool-approval gate.
 * - ClearWorkflowApprovalStatus: clears pending_approvals when the
 *   child agent activity completes (approvals resolved).
 *
 * The client is the factory's, built once from the runner's injected
 * `Config` so it reads the live credential ref per request (config.ts
 * header); the functions take it as an argument, which is also what a test
 * hands them.
 */

import { StigmerClient } from "../client/stigmer-client.js";
import type { Config } from "../config.js";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionStatusSchema, WorkflowPendingApprovalSchema, WorkflowPendingFileReviewSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ToolCallStatus, FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Derives the child's approval gate onto the parent (DD-012: identity-only
 * signal, derive-from-child). The signal carries only the child execution id;
 * this activity reads the child's persisted `status.pending_approvals` — the
 * single source of truth the child's server wrote BEFORE signaling — and
 * mirrors it onto the parent as reference entries.
 *
 * Returns true when a gate was surfaced, false when the child currently has
 * no pending approvals. The child persists its gate before the signal is
 * sent (both editions), so an empty read means the gate already resolved
 * (e.g. approved on the agent surface in the interim) — the caller must NOT
 * retry: surfacing a resolved gate would show users a stale approval card.
 */
export async function updateWorkflowTaskApprovalStatus(
  client: StigmerClient,
  executionId: string,
  _taskName: string,
  childExecutionId: string,
): Promise<boolean> {
  if (!executionId || !childExecutionId) return false;

  const child = await client.getExecution(childExecutionId);
  const pendingApprovals = (child?.status?.pendingApprovals ?? []).map(
    (approval) =>
      create(WorkflowPendingApprovalSchema, {
        approval,
        childAgentExecutionId: childExecutionId,
      }),
  );

  if (pendingApprovals.length === 0) {
    return false;
  }

  const status = create(WorkflowExecutionStatusSchema, {
    pendingApprovals,
  });

  // Per-child merge scoped to this child: the write replaces only this child's
  // approvals and preserves every parallel sibling's entries.
  await client.updateWorkflowExecutionStatus(executionId, status, {
    updatePendingApprovals: true,
    pendingUpdateChildAgentExecutionId: childExecutionId,
  });
  return true;
}

export async function clearWorkflowApprovalStatus(
  client: StigmerClient,
  executionId: string,
  childExecutionId: string,
): Promise<void> {
  if (!executionId || !childExecutionId) return;

  const status = create(WorkflowExecutionStatusSchema, {
    pendingApprovals: [],
  });

  // Scoped clear: empty list for this child clears only its approvals; sibling
  // children still awaiting approval are untouched.
  await client.updateWorkflowExecutionStatus(executionId, status, {
    updatePendingApprovals: true,
    pendingUpdateChildAgentExecutionId: childExecutionId,
  });
}

/**
 * Surfaces (or clears) a child agent's file-review gate on the parent workflow.
 *
 * Reference-only: writes a single WorkflowPendingFileReview naming the child and
 * the change_set ids it currently has AWAITING_REVIEW — never the diffs, which
 * stay single-sourced on the child. Passing an empty changeSetIds clears this
 * child's entry (per-child merge, so parallel siblings are never disturbed).
 */
export async function updateWorkflowFileReviewStatus(
  client: StigmerClient,
  executionId: string,
  childExecutionId: string,
  changeSetIds: string[],
): Promise<void> {
  if (!executionId || !childExecutionId) return;

  const pendingFileReviews =
    changeSetIds.length > 0
      ? [
          create(WorkflowPendingFileReviewSchema, {
            childAgentExecutionId: childExecutionId,
            changeSetId: changeSetIds,
          }),
        ]
      : [];

  const status = create(WorkflowExecutionStatusSchema, {
    pendingFileReviews,
  });

  await client.updateWorkflowExecutionStatus(executionId, status, {
    updatePendingFileReviews: true,
    pendingUpdateChildAgentExecutionId: childExecutionId,
  });
}

/**
 * Reads the child agent execution and returns the ids of its change sets that
 * are currently AWAITING_REVIEW. The gated child is non-terminal, so its last
 * status write stored a populated file_change_sets projection; GET returns it
 * (the same reason getAgentExecutionProgress reads status.messages).
 */
export async function getAwaitingFileReviewChangeSetIds(
  client: StigmerClient,
  childExecutionId: string,
): Promise<string[]> {
  if (!childExecutionId) return [];

  try {
    const execution = await client.getExecution(childExecutionId);
    const changeSets = execution?.status?.fileChangeSets ?? [];
    return changeSets
      .filter((cs) => cs.status === FileChangeSetStatus.AWAITING_REVIEW)
      .map((cs) => cs.id);
  } catch (err) {
    console.warn("Failed to fetch child file-review state (non-fatal):", String(err));
    return [];
  }
}

/**
 * Queries the child AgentExecution for progress data that can be
 * emitted as an `agent_call_progress` event on the parent workflow.
 *
 * Returns a lightweight summary derived from the agent's status:
 * message count, last active tool, token consumption. Returns null
 * if the execution cannot be fetched (best-effort).
 */
export interface AgentProgressSummary {
  messagesCount: number;
  toolCallsCount: number;
  currentToolName: string;
  tokensConsumed: number;
  agentPhase: number;
}

export async function getAgentExecutionProgress(
  client: StigmerClient,
  childExecutionId: string,
): Promise<AgentProgressSummary | null> {
  if (!childExecutionId) return null;

  try {
    const execution = await client.getExecution(childExecutionId);
    const status = execution?.status;
    if (!status) return null;

    const messages = status.messages ?? [];
    const messagesCount = messages.length;

    let toolCallsCount = 0;
    let currentToolName = "";
    for (const msg of messages) {
      const tools = msg.toolCalls ?? [];
      toolCallsCount += tools.length;
      for (const tc of tools) {
        if (tc.name && tc.status === ToolCallStatus.TOOL_CALL_RUNNING) {
          currentToolName = tc.name;
        }
      }
    }

    const usage = status.streamingUsage;
    const tokensConsumed = Number(usage?.totalTokens ?? 0);

    const phase = status.phase ?? 0;

    return { messagesCount, toolCallsCount, currentToolName, tokensConsumed, agentPhase: phase };
  } catch (err) {
    console.warn("Failed to fetch agent execution progress (non-fatal):", String(err));
    return null;
  }
}

export function createCallAgentStatusActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    UpdateWorkflowTaskApprovalStatus: (executionId: string, taskName: string, childExecutionId: string) =>
      updateWorkflowTaskApprovalStatus(client, executionId, taskName, childExecutionId),
    ClearWorkflowApprovalStatus: (executionId: string, childExecutionId: string) =>
      clearWorkflowApprovalStatus(client, executionId, childExecutionId),
    UpdateWorkflowFileReviewStatus: (executionId: string, childExecutionId: string, changeSetIds: string[]) =>
      updateWorkflowFileReviewStatus(client, executionId, childExecutionId, changeSetIds),
    GetAwaitingFileReviewChangeSetIds: (childExecutionId: string) =>
      getAwaitingFileReviewChangeSetIds(client, childExecutionId),
    GetAgentExecutionProgress: (childExecutionId: string) =>
      getAgentExecutionProgress(client, childExecutionId),
  };
}
