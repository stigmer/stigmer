import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

export type SessionMemoryStep =
  | { view: "composer-empty" }
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; execution: AgentExecution };

const user1 = samples.humanMessage(
  "I ordered wireless headphones last week. Order #ORD-4821.",
);

const ai1 = samples.aiMessage(
  "I found your order. Order #ORD-4821 contains Wireless Headphones " +
    "(1x $79.99) and shipped on March 28. The estimated delivery is " +
    "April 5, 2026. Would you like to know anything else about this order?",
);

const user2 = samples.humanMessage(
  "Are those eligible for a return?",
);

const ai2 = samples.aiMessage(
  "Yes, your **Wireless Headphones** from order #ORD-4821 are eligible " +
    "for return. The 30-day return window runs until April 27, 2026. " +
    "Items must be in original packaging with all tags attached.\n\n" +
    "Would you like me to start the return process?",
);

export const sessionMemorySteps: ScenarioStep<SessionMemoryStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-empty" },
    caption: "Start a conversation",
    narration: "A Session remembers everything said in the conversation. The agent can refer back to earlier messages at any point.",
  },
  {
    delayMs: 1500,
    data: { view: "composer-typing", message: "I ordered wireless headphones last week. Order #ORD-4821." },
    caption: "Mention an order",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
    caption: "Send the message",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
    caption: "Agent remembers the order",
    narration: "The agent finds the order and pulls up the details. This information stays in the conversation.",
  },
  {
    delayMs: 2500,
    data: { view: "conversation", execution: snapshot([user1, ai1, user2]) },
    caption: "Follow up without repeating the order number",
  },
  {
    delayMs: 2500,
    data: {
      view: "conversation",
      execution: snapshot([user1, ai1, user2, ai2], ExecutionPhase.EXECUTION_COMPLETED),
    },
    caption: "Agent recalls the product and order from earlier",
    narration: "The agent knows exactly which product and which order — it held the context from the earlier message.",
  },
];
