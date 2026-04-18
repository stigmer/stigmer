/**
 * Quickstart scenario: a timed playback showing a basic conversation
 * with the implicit assistant agent.
 *
 * The AI gives generic answers because no Skill is attached — this
 * demonstrates the quickstart aha moment ("I have an AI agent I can
 * call from my code") while setting up the bridge to "Your First Skill"
 * ("the answer was generic; let's fix that").
 */

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type QuickstartStep =
  | { view: "composer-empty" }
  | { view: "composer-typing"; message: string }
  | { view: "conversation"; execution: AgentExecution };

// ---------------------------------------------------------------------------
// Conversation data
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "What is your return policy for defective items?",
);

const ai1 = samples.aiMessage(
  "I'd be happy to help, but I don't have specific information about your " +
    "company's return policy. Generally, many companies accept returns for " +
    "defective items within a certain timeframe. Could you share which " +
    "company's policy you're asking about?",
);

const user2 = samples.humanMessage(
  "Do you cover return shipping for defective items?",
);

const ai2 = samples.aiMessage(
  "I don't have access to your specific shipping policies. Return shipping " +
    "coverage varies by company — some cover it for defective items while " +
    "others require the customer to pay. I'd recommend checking with your " +
    "support team for the exact policy.",
);

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const quickstartPlaybackSteps: ScenarioStep<QuickstartStep>[] = [
  {
    delayMs: 0,
    data: { view: "composer-empty" },
    caption: "Start a new session",
    narration: "This is a new session in the Stigmer console. You can talk to your agent right here.",
  },
  { delayMs: 2000, data: { view: "composer-typing", message: "What is your return policy for defective items?" }, caption: "Type your question" },
  { delayMs: 2500, data: { view: "conversation", execution: snapshot([user1]) }, caption: "Ask about your return policy" },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
    caption: "Agent gives a generic answer",
    narration: "The agent responds, but it doesn't know your company's return policy. Without domain knowledge, it can only give generic answers.",
  },
  { delayMs: 2500, data: { view: "conversation", execution: snapshot([user1, ai1, user2]) }, caption: "Follow-up question" },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1, user2, ai2], ExecutionPhase.EXECUTION_COMPLETED) },
    caption: "Still no domain knowledge",
    narration: "Same result. The agent has no way to answer questions about your business yet.",
  },
];
