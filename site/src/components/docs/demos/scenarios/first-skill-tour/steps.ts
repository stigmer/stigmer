/**
 * First Skill overview tour — multi-surface preview showing:
 * create a Skill through conversation → one-line code change →
 * expert response.
 *
 * Placed at the top of the "Your first Skill" page inside
 * "What you'll build."
 */

import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { TerminalLine } from "../../views/TerminalView";
import { snapshot } from "../../engine/shared";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type FirstSkillTourStep =
  | { view: "skill-creator-typing" }
  | { view: "skill-created"; execution: AgentExecution }
  | { view: "code-skill-refs" }
  | { view: "terminal-expert" };

// ---------------------------------------------------------------------------
// Conversation data (condensed from skill-creation-tour)
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "I want to create a skill for our customer return policy.",
);

const ai1 = samples.aiMessage(
  "I'll help you create a return policy skill. To make it accurate, I need a few details:\n\n" +
    "1. **Return window** — how many days do customers have to return items?\n" +
    "2. **Conditions** — do they need a receipt? Original packaging?\n" +
    "3. **Exceptions** — are there items that can't be returned?\n" +
    "4. **Refund method** — original payment, store credit, or both?",
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

const SKILL_ARTIFACT = (() => {
  const a = samples.artifact("return-policy", ExecutionArtifactKind.DIRECTORY);
  (a as { entries: string[] }).entries = ["SKILL.md"];
  return a;
})();

export const skillCreatedExecution = snapshot(
  [user1, ai1, user2, ai2],
  ExecutionPhase.EXECUTION_COMPLETED,
  [SKILL_ARTIFACT],
);

// ---------------------------------------------------------------------------
// Fixture data — code snippet
// ---------------------------------------------------------------------------

export const SKILL_REFS_CODE = [
  "// ask-agent.ts — Add a Skill to your session",
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  '  skillRefs: [{ org: "my-org", slug: "return-policy" }],',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What is your return policy for defective items?",',
  "});",
];

// ---------------------------------------------------------------------------
// Fixture data — terminal output
// ---------------------------------------------------------------------------

export const EXPERT_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "Defective items can be returned at any time," },
  { type: "output", text: "regardless of the standard 14-day return window." },
  { type: "output", text: "Simply ship the item back with a brief" },
  { type: "output", text: "description of the defect — we cover return" },
  { type: "output", text: "shipping at no cost to you." },
  { type: "blank", text: "" },
  { type: "output", text: "Once we receive the item, your refund will be" },
  { type: "output", text: "processed within 3–5 business days to your" },
  { type: "output", text: "original payment method." },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const firstSkillTourSteps: ScenarioStep<FirstSkillTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "skill-creator-typing" },
    caption: "Describe your domain to the Skill Creator",
    narration:
      "Open the Skill Creator and describe your return policy. The platform turns your answers into structured knowledge.",
  },
  {
    delayMs: 3000,
    data: { view: "skill-created", execution: skillCreatedExecution },
    caption: "Skill generated from your answers",
    narration:
      "Your return policy is now a Skill — domain knowledge your agent can use when answering questions.",
  },
  {
    delayMs: 3500,
    data: { view: "code-skill-refs" },
    caption: "One line connects the Skill to your code",
    narration:
      "Add skill refs to your session. That's the only code change.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-expert" },
    caption: "Same question — expert answer",
    narration:
      "Same question as the quickstart, completely different answer. Grounded in your actual return policy.",
  },
];
