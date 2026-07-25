import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

export type ToolCallStep =
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; execution: AgentExecution };

const user1 = samples.humanMessage(
  "What's the status of order #ORD-4821?",
);

const toolCall = samples.toolCall(
  "get_order",
  JSON.stringify({
    order_id: "ORD-4821",
    status: "shipped",
    tracking: "1Z999AA10123456784",
    items: [{ name: "Wireless Headphones", qty: 1, price: 79.99 }],
    estimated_delivery: "2026-04-05",
  }, null, 2),
);

const aiToolCallMsg = samples.aiMessage("", [toolCall]);

const aiResponseMsg = samples.aiMessage(
  "Order #ORD-4821 has been **shipped**. Here are the details:\n\n" +
    "- **Item**: Wireless Headphones (1x $79.99)\n" +
    "- **Tracking**: 1Z999AA10123456784\n" +
    "- **Estimated delivery**: April 5, 2026\n\n" +
    "Is there anything else you'd like to know about this order?",
);

export const toolCallsPlaybackSteps: ScenarioStep<ToolCallStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-typing", message: "What's the status of order #ORD-4821?" },
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
  },
  {
    delayMs: 2000,
    data: {
      view: "conversation",
      execution: snapshot(
        [user1, aiToolCallMsg],
        ExecutionPhase.EXECUTION_IN_PROGRESS,
      ),
    },
    narration: "Instead of guessing, the agent calls get_order to look up the real order details from the system.",
  },
  {
    delayMs: 2500,
    data: {
      view: "conversation",
      execution: snapshot(
        [user1, aiToolCallMsg, aiResponseMsg],
        ExecutionPhase.EXECUTION_COMPLETED,
      ),
    },
    narration: "The response includes real data — tracking number, delivery date, and item details — all from the tool call.",
  },
];
