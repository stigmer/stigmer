import { create } from "@bufbuild/protobuf";
import { ApprovalPolicySource, ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

export type ApprovalFlowStep =
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; execution: AgentExecution }
  | { view: "approval-pending"; execution: AgentExecution };

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "Process a return for order #ORD-4821 — the headphones are defective.",
);

const pendingToolCall = create(ToolCallSchema, {
  id: "tc-process-return-1",
  name: "process_return",
  status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
  startedAt: new Date().toISOString(),
});

const pendingApproval = create(PendingApprovalSchema, {
  toolCallId: "tc-process-return-1",
  toolName: "process_return",
  message: "Process return for order 'ORD-4821'",
  argsPreview: JSON.stringify({
    order_id: "ORD-4821",
    reason: "defective",
    refund_amount: 79.99,
    refund_method: "original_payment",
  }, null, 2),
  requestedAt: new Date().toISOString(),
  mcpServerSlug: "order-management-api",
  // Why-gated provenance the server projects onto the pending approval; renders
  // the ApprovalCard's "why this needs approval" line in the demo.
  approvalPolicySource: ApprovalPolicySource.CLASSIFIER_DEFAULT,
});

const completedToolCall = samples.toolCall(
  "process_return",
  JSON.stringify({
    return_id: "RET-1092",
    status: "approved",
    refund_amount: 79.99,
    refund_method: "original_payment",
    estimated_refund_date: "2026-04-07",
  }, null, 2),
);

const aiToolCallMsg = samples.aiMessage("", [completedToolCall]);

const aiSummaryMsg = samples.aiMessage(
  "The return has been processed. Here's a summary:\n\n" +
    "- **Return ID**: RET-1092\n" +
    "- **Refund**: $79.99 to original payment method\n" +
    "- **Estimated refund date**: April 7, 2026\n\n" +
    "Is there anything else I can help with?",
);

function buildWaitingExecution(): AgentExecution {
  const exec = snapshot(
    [user1, samples.aiMessage("", [pendingToolCall])],
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  );
  exec.status!.pendingApprovals = [pendingApproval];
  return exec;
}

// ---------------------------------------------------------------------------
// Exported data
// ---------------------------------------------------------------------------

export const waitingExecution = buildWaitingExecution();

export const completedExecution = snapshot(
  [user1, aiToolCallMsg, aiSummaryMsg],
  ExecutionPhase.EXECUTION_COMPLETED,
);

export const receivedExecution = snapshot([user1]);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const approvalFlowSteps: ScenarioStep<ApprovalFlowStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-typing", message: "Process a return for order #ORD-4821 — the headphones are defective." },
    narration: "A customer asks the agent to process a return. This triggers the process_return tool, which requires approval.",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: receivedExecution },
  },
  {
    delayMs: 2000,
    data: { view: "approval-pending", execution: waitingExecution },
    narration: "The agent stops and shows exactly what it wants to do. Nothing happens until a human approves.",
    interactions: [
      { atPercent: 0.4, type: "click", target: "approve-button" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "conversation", execution: completedExecution },
    narration: "Once approved, the agent completes the return and confirms the details. The execution waited safely until a human said yes.",
  },
];

