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
 */

import { StigmerClient } from "../client/stigmer-client.js";
import { loadConfig } from "../config.js";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionStatusSchema, WorkflowPendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ChildApprovalNotification } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";

function buildClient(): StigmerClient {
  const config = loadConfig();
  return new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
  });
}

export async function updateWorkflowTaskApprovalStatus(
  executionId: string,
  _taskName: string,
  notification: ChildApprovalNotification,
): Promise<void> {
  if (!executionId) return;

  const client = buildClient();
  const pendingApprovals = (notification.pendingApprovals ?? []).map(
    (approval) =>
      create(WorkflowPendingApprovalSchema, {
        approval,
        childAgentExecutionId: notification.executionId,
      }),
  );

  const status = create(WorkflowExecutionStatusSchema, {
    pendingApprovals,
  });

  await client.updateWorkflowExecutionStatus(executionId, status, {
    updatePendingApprovals: true,
  });
}

export async function clearWorkflowApprovalStatus(
  executionId: string,
): Promise<void> {
  if (!executionId) return;

  const client = buildClient();
  const status = create(WorkflowExecutionStatusSchema, {
    pendingApprovals: [],
  });

  await client.updateWorkflowExecutionStatus(executionId, status, {
    updatePendingApprovals: true,
  });
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
  childExecutionId: string,
): Promise<AgentProgressSummary | null> {
  if (!childExecutionId) return null;

  try {
    const client = buildClient();
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
        if (tc.name) currentToolName = tc.name;
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

export function createCallAgentStatusActivities() {
  return {
    UpdateWorkflowTaskApprovalStatus: updateWorkflowTaskApprovalStatus,
    ClearWorkflowApprovalStatus: clearWorkflowApprovalStatus,
    GetAgentExecutionProgress: getAgentExecutionProgress,
  };
}
