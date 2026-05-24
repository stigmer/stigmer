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

export function createCallAgentStatusActivities() {
  return {
    UpdateWorkflowTaskApprovalStatus: updateWorkflowTaskApprovalStatus,
    ClearWorkflowApprovalStatus: clearWorkflowApprovalStatus,
  };
}
