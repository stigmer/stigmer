/**
 * Guided-tour scenario for "Your first Skill".
 *
 * Defines an 8-step playback that walks the reader through the full
 * Stigmer web app navigation: sidebar → Library → Skills list →
 * Create Skill → Session Composer → conversation with Skill Creator.
 *
 * Each step is a discriminated union (`GuidedTourStep`) so the render
 * prop in `DemoSkillCreationTour` can switch on `step.view` and render
 * the appropriate sub-component.
 */

import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../ScenarioPlayer";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type GuidedTourStep =
  | { view: "library-click"; activeNav: "library" }
  | { view: "skills-list" }
  | { view: "create-skill-click" }
  | { view: "composer-ready"; agentName: string }
  | { view: "conversation"; execution: AgentExecution };

// ---------------------------------------------------------------------------
// Conversation messages (same content as skill-creation.ts)
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "I want to create a skill for our customer return policy.",
);

const ai1 = samples.aiMessage(
  "I'll help you create a return policy skill. To make it accurate, I need a few details:\n\n" +
    "1. **Return window** — how many days do customers have to return items?\n" +
    "2. **Conditions** — do they need a receipt? Original packaging?\n" +
    "3. **Exceptions** — are there items that can't be returned (final sale, digital, defective)?\n" +
    "4. **Refund method** — original payment method, store credit, or both?",
);

const user2 = samples.humanMessage(
  "14 days, receipt required, original packaging. Defective items can be returned anytime. " +
    "Final sale and digital products are non-refundable. Refunds go back to the original payment method, " +
    "3-5 business days after we receive the item.",
);

const ai2 = samples.aiMessage(
  "I've created your return policy skill. Here's what I included:\n\n" +
    "- **14-day return window** with receipt and original packaging required\n" +
    "- **Defective items** accepted at any time, return shipping covered\n" +
    "- **Final sale and digital products** excluded\n" +
    "- **3–5 business day** refund to original payment method\n\n" +
    "The skill is ready as an artifact. You can review it and push it to your agent.",
);

// ---------------------------------------------------------------------------
// Snapshot helper — fixes the duplicate-message bug from skill-creation.ts.
//
// MessageThread synthesizes a human bubble from `spec.message`, so the first
// human message must go into `spec.message` and be excluded from
// `status.messages` to avoid rendering it twice.
// ---------------------------------------------------------------------------

function snapshot(...msgs: AgentMessage[]): AgentExecution {
  const firstHumanIdx = msgs.findIndex(
    (m) => m.type === MessageType.MESSAGE_HUMAN,
  );
  const specMessage =
    firstHumanIdx >= 0 ? msgs[firstHumanIdx].content : "";
  const statusMessages =
    firstHumanIdx >= 0
      ? [...msgs.slice(0, firstHumanIdx), ...msgs.slice(firstHumanIdx + 1)]
      : msgs;

  const exec = samples.agentExecution({
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    messages: statusMessages,
  });
  exec.spec!.message = specMessage;
  return exec;
}

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const skillCreationTourSteps: ScenarioStep<GuidedTourStep>[] = [
  { delayMs: 0, data: { view: "library-click", activeNav: "library" } },
  { delayMs: 1500, data: { view: "skills-list" } },
  { delayMs: 2000, data: { view: "create-skill-click" } },
  { delayMs: 1500, data: { view: "composer-ready", agentName: "Skill Creator" } },
  { delayMs: 2000, data: { view: "conversation", execution: snapshot(user1) } },
  { delayMs: 2000, data: { view: "conversation", execution: snapshot(user1, ai1) } },
  { delayMs: 2500, data: { view: "conversation", execution: snapshot(user1, ai1, user2) } },
  { delayMs: 2000, data: { view: "conversation", execution: snapshot(user1, ai1, user2, ai2) } },
];
