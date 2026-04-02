import { create } from "@bufbuild/protobuf";
import { ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import { snapshot } from "../../engine/shared";

export type ApprovalFlowStep =
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; execution: AgentExecution };

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

const ai1 = samples.aiMessage(
  "The return has been processed. Here's a summary:\n\n" +
    "- **Return ID**: RET-1092\n" +
    "- **Refund**: $79.99 to original payment method\n" +
    "- **Estimated refund date**: April 7, 2026\n\n" +
    "Is there anything else I can help with?",
  [completedToolCall],
);

function buildWaitingExecution(): AgentExecution {
  const exec = snapshot(
    [user1, samples.aiMessage("", [pendingToolCall])],
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  );
  exec.status!.pendingApprovals = [pendingApproval];
  return exec;
}

export const approvalFlowSteps: ScenarioStep<ApprovalFlowStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-typing", message: "Process a return for order #ORD-4821 — the headphones are defective." },
    caption: "Customer requests a return",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
    caption: "Agent receives the request",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: buildWaitingExecution() },
    caption: "Agent pauses for human approval",
  },
  {
    delayMs: 4000,
    data: {
      view: "conversation",
      execution: snapshot([user1, ai1], ExecutionPhase.EXECUTION_COMPLETED),
    },
    caption: "Approved — agent completes the return",
  },
];
