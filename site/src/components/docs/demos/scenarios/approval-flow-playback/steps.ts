/**
 * The approval-flow demo's timeline and the conversations it shows: a
 * return request, the agent's `process_return` call waiting for a person
 * (the server marks it destructive, so the default asks), and the turn
 * completing once it is approved. Each frame is the turn's session events,
 * folded; nothing reads the clock.
 */
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { samples, sampleInstant } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { conversation, type DemoConversation } from "../../fixtures";

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

export type ApprovalFlowStep =
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; conversation: DemoConversation }
  | { view: "approval-pending"; conversation: DemoConversation };

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const RETURN_REQUEST =
  "Process a return for order #ORD-4821 — the headphones are defective.";

/** The return call's input, as the agent passes it and the gate previews it. */
const RETURN_INPUT = {
  order_id: "ORD-4821",
  reason: "defective",
  refund_amount: 79.99,
  refund_method: "original_payment",
};

/** The server segment of the tool's name: plugin "order-management", server "orders". */
const ORDERS_SERVER = "plugin_order-management_orders";

/** The return call, on the plugin's MCP server; `ask` while it waits for a person. */
const returnUse = (evaluatedPermission: string) =>
  samples.toolUseEvent("process_return", RETURN_INPUT, {
    mcpServerName: ORDERS_SERVER,
    evaluatedPermission,
  });

/** The return call's id, which its ask and its result name. */
const RETURN_TOOL_USE_ID = returnUse("").event.value!.id;

export const receivedConversation = conversation([
  samples.userMessageEvent(RETURN_REQUEST),
  samples.runStatusEvent("running"),
]);

export const waitingConversation = conversation(
  [
    samples.userMessageEvent(RETURN_REQUEST),
    samples.runStatusEvent("running"),
    returnUse("ask"),
    samples.permissionAskedEvent(RETURN_TOOL_USE_ID, {
      message: "Execute process_return",
      argsPreview: JSON.stringify(RETURN_INPUT, null, 2),
      // The server marks process_return destructive, so the default asks:
      // the gate's "why this needs approval" line names that rule.
      policySource: "annotation_destructive_tighten",
    }),
    samples.runStatusEvent("waiting"),
  ],
  RunPhase.RUN_WAITING_FOR_APPROVAL,
);

export const completedConversation = conversation(
  [
    samples.userMessageEvent(RETURN_REQUEST),
    samples.runStatusEvent("running"),
    returnUse(""),
    samples.toolResultEvent(
      RETURN_TOOL_USE_ID,
      JSON.stringify(
        {
          return_id: "RET-1092",
          status: "approved",
          refund_amount: 79.99,
          refund_method: "original_payment",
          estimated_refund_date: "2026-04-07",
        },
        null,
        2,
      ),
      // The call ran 2.4s: its duration chip reads a stable "2.4s".
      { mcp: true, processedAt: sampleInstant(2_400) },
    ),
    samples.agentMessageEvent(
      "The return has been processed. Here's a summary:\n\n" +
        "- **Return ID**: RET-1092\n" +
        "- **Refund**: $79.99 to original payment method\n" +
        "- **Estimated refund date**: April 7, 2026\n\n" +
        "Is there anything else I can help with?",
    ),
    samples.runStatusEvent("completed"),
  ],
  RunPhase.RUN_COMPLETED,
);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const approvalFlowSteps: ScenarioStep<ApprovalFlowStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-typing", message: RETURN_REQUEST },
    narration: "A customer asks the agent to process a return. This triggers the process_return tool, which requires approval.",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", conversation: receivedConversation },
  },
  {
    delayMs: 2000,
    data: { view: "approval-pending", conversation: waitingConversation },
    narration: "The agent stops and shows exactly what it wants to do. Nothing happens until a human approves.",
    interactions: [
      { atPercent: 0.4, type: "click", target: "approve-button" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "conversation", conversation: completedConversation },
    narration: "Once approved, the agent completes the return and confirms the details. The run waited safely until a human said yes.",
  },
];
