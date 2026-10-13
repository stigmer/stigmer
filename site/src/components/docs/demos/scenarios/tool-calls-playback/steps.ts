/**
 * The tool-calls demo's timeline and the conversations it shows: an order
 * question, the agent's `get_order` call returning the real order, and the
 * answer built from it. Each frame is the turn's session events, folded;
 * nothing reads the clock.
 */
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { conversation, type DemoConversation } from "../../fixtures";

export type ToolCallStep =
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; conversation: DemoConversation };

const ORDER_QUESTION = "What's the status of order #ORD-4821?";

const orderLookup = samples.toolUseEvent("get_order", { order_id: "ORD-4821" });

const opening = [
  samples.userMessageEvent(ORDER_QUESTION),
  samples.runStatusEvent("running"),
];

const lookedUp = [
  ...opening,
  orderLookup,
  samples.toolResultEvent(
    orderLookup.event.value!.id,
    JSON.stringify({
      order_id: "ORD-4821",
      status: "shipped",
      tracking: "1Z999AA10123456784",
      items: [{ name: "Wireless Headphones", qty: 1, price: 79.99 }],
      estimated_delivery: "2026-04-05",
    }, null, 2),
  ),
];

const answered = [
  ...lookedUp,
  samples.agentMessageEvent(
    "Order #ORD-4821 has been **shipped**. Here are the details:\n\n" +
      "- **Item**: Wireless Headphones (1x $79.99)\n" +
      "- **Tracking**: 1Z999AA10123456784\n" +
      "- **Estimated delivery**: April 5, 2026\n\n" +
      "Is there anything else you'd like to know about this order?",
  ),
  samples.runStatusEvent("completed"),
];

export const toolCallsPlaybackSteps: ScenarioStep<ToolCallStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-typing", message: ORDER_QUESTION },
  },
  {
    delayMs: 2000,
    data: { view: "conversation", conversation: conversation(opening) },
  },
  {
    delayMs: 2000,
    data: { view: "conversation", conversation: conversation(lookedUp) },
    narration: "Instead of guessing, the agent calls get_order to look up the real order details from the system.",
  },
  {
    delayMs: 2500,
    data: { view: "conversation", conversation: conversation(answered, RunPhase.RUN_COMPLETED) },
    narration: "The response includes real data — tracking number, delivery date, and item details — all from the tool call.",
  },
];
