/**
 * Guided-tour scenario for "Your first Skill".
 *
 * Defines a 12-step playback that walks the reader through the full
 * Stigmer web app navigation: sidebar -> Library -> Skills list ->
 * Add Skill -> Session Composer -> conversation with Skill Creator ->
 * artifact preview -> push -> back to Library with the new skill.
 *
 * Each step is a discriminated union (`GuidedTourStep`) so the render
 * prop in the scenario component can switch on `step.view` and render
 * the appropriate sub-component.
 */

import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type GuidedTourStep =
  | { view: "library-click"; activeNav: "library" }
  | { view: "skills-list" }
  | { view: "create-skill-click" }
  | { view: "composer-ready" }
  | { view: "conversation"; execution: AgentExecution }
  | { view: "artifact-click"; execution: AgentExecution }
  | { view: "artifact-preview"; execution: AgentExecution }
  | { view: "push-skill"; execution: AgentExecution }
  | { view: "library-complete" };

// ---------------------------------------------------------------------------
// Conversation messages
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
// SKILL.md content for the artifact preview
// ---------------------------------------------------------------------------

export const SKILL_MD_PREVIEW = `---
name: Return Policy
description: Acme Corp's customer return and refund policy.
---

# Return Policy

## Standard Returns

Customers may return most items within **14 days** of delivery for a full refund.

**Requirements:**
- Original receipt or order confirmation email
- Item in original packaging, unused condition
- Return shipping label (provided at no cost)

## Exceptions

**Defective items** — accepted for return at any time, regardless of the 14-day window.

**Final sale items** — marked "Final Sale" at checkout. Not eligible for return or exchange.

**Digital products** — non-refundable once the download link has been accessed.

## Refund Timeline

Refunds are processed within **3–5 business days** after we receive the returned item.`;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SKILL_ARTIFACT: ExecutionArtifact = (() => {
  const a = samples.artifact("return-policy", ExecutionArtifactKind.DIRECTORY);
  (a as { entries: string[] }).entries = ["SKILL.md"];
  return a;
})();

const finalExecution = snapshot(
  [user1, ai1, user2, ai2],
  ExecutionPhase.EXECUTION_COMPLETED,
  [SKILL_ARTIFACT],
);

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const skillCreationTourSteps: ScenarioStep<GuidedTourStep>[] = [
  { delayMs: 0, data: { view: "library-click", activeNav: "library" }, caption: "Navigate to Library" },
  {
    delayMs: 1500,
    data: { view: "skills-list" },
    caption: "View your Skills",
    narration: "Skills are pieces of domain knowledge. Each one teaches your agent about a specific topic.",
  },
  { delayMs: 2000, data: { view: "create-skill-click" }, caption: 'Click "Add Skill"' },
  { delayMs: 1500, data: { view: "composer-ready" }, caption: "Skill Creator opens" },
  { delayMs: 2000, data: { view: "conversation", execution: snapshot([user1]) }, caption: "Describe your domain" },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
    caption: "Agent asks questions",
    narration: "The creator asks targeted questions to make sure it captures your domain accurately.",
  },
  { delayMs: 2500, data: { view: "conversation", execution: snapshot([user1, ai1, user2]) }, caption: "Provide the details" },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: finalExecution },
    caption: "Skill generated",
    narration: "Your return policy is now a Skill. The agent will use these exact rules when answering customer questions.",
  },
  { delayMs: 2000, data: { view: "artifact-click", execution: finalExecution }, caption: "Click to preview" },
  {
    delayMs: 1500,
    data: { view: "artifact-preview", execution: finalExecution },
    caption: "Review the Skill",
    narration: "This is the Skill file — plain text that's easy to read and update.",
  },
  { delayMs: 3000, data: { view: "push-skill", execution: finalExecution }, caption: "Push to save" },
  {
    delayMs: 2000,
    data: { view: "library-complete" },
    caption: "Skill added to Library",
    narration: "The Skill is in your Library, ready to attach to any agent.",
  },
];
