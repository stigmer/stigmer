/**
 * Skill-creation scenario: a web console conversation where the AI
 * generates a return-policy SKILL.md from user input.
 *
 * Used by the Cloud quickstart documentation to embed a realistic
 * preview of the Stigmer web console's Skill creation flow.
 */

import { ExecutionArtifactKind, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DemoScenario } from "@stigmer/react/demo";
import { buildScenario, fixtures, samples } from "@stigmer/react/demo";

const SKILL_MD_CONTENT = `---
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
Ship the item back with a brief description of the defect. We cover return shipping.

**Final sale items** — marked "Final Sale" at checkout. Not eligible for return or exchange.

**Digital products** — non-refundable once the download link has been accessed.

## Refund Timeline

Refunds are processed within **3–5 business days** after we receive the returned item.
The refund appears on the original payment method. Bank processing may add 1–2 business days.

## Exchanges

To exchange an item, return the original and place a new order. This is faster than waiting
for an exchange to be processed manually.
`;

const demoAgent = samples.agent({
  name: "Skill Creator",
  slug: "skill-creator",
  instructions: "You help users create Skills by gathering domain knowledge and generating SKILL.md files.",
});

const demoInstance = samples.agentInstance({
  name: "skill-creator-instance",
  agentId: demoAgent.metadata?.id,
});

const demoSession = samples.session({
  subject: "Create a return policy skill",
  agentInstanceId: demoInstance.metadata?.id,
});

const skillArtifact = samples.artifact("SKILL.md", ExecutionArtifactKind.FILE);

const skillCreationExecution = samples.agentExecution({
  sessionId: demoSession.metadata?.id,
  agentId: demoAgent.metadata?.id,
  phase: ExecutionPhase.EXECUTION_COMPLETED,
  artifacts: [skillArtifact],
  messages: [
    samples.humanMessage(
      "I want to create a skill for our customer return policy.",
    ),
    samples.aiMessage(
      "I'll help you create a return policy skill. To make it accurate, I need a few details:\n\n" +
        "1. **Return window** — how many days do customers have to return items?\n" +
        "2. **Conditions** — do they need a receipt? Original packaging?\n" +
        "3. **Exceptions** — are there items that can't be returned (final sale, digital, defective)?\n" +
        "4. **Refund method** — original payment method, store credit, or both?",
    ),
    samples.humanMessage(
      "14 days, receipt required, original packaging. Defective items can be returned anytime. " +
        "Final sale and digital products are non-refundable. Refunds go back to the original payment method, " +
        "3-5 business days after we receive the item.",
    ),
    samples.aiMessage(
      "I've created your return policy skill. Here's what I included:\n\n" +
        "- **14-day return window** with receipt and original packaging required\n" +
        "- **Defective items** accepted at any time, return shipping covered\n" +
        "- **Final sale and digital products** excluded\n" +
        "- **3–5 business day** refund to original payment method\n\n" +
        "The skill is ready as an artifact. You can review it and push it to your agent.",
    ),
  ],
});

export const skillCreationScenario: DemoScenario = buildScenario(
  fixtures.session.get(() => demoSession),
  fixtures.session.list(() => samples.sessionList([demoSession])),
  fixtures.session.create(() => demoSession),
  fixtures.session.update(() => demoSession),

  fixtures.agentExecution.listBySession(() =>
    samples.agentExecutionList([skillCreationExecution]),
  ),
  fixtures.agentExecution.create(() => skillCreationExecution),
  fixtures.agentExecution.subscribe(() => [skillCreationExecution]),
  fixtures.agentExecution.submitApproval(() => skillCreationExecution),
  fixtures.agentExecution.getArtifactContent(() => ({
    content: new TextEncoder().encode(SKILL_MD_CONTENT),
    contentType: "text/markdown",
    truncated: false,
  })),

  fixtures.agent.get(() => demoAgent),
  fixtures.agent.getByReference(() => demoAgent),
  fixtures.agent.getDefault(() => demoAgent),
  fixtures.agent.list(() =>
    samples.searchResponse([
      samples.searchResult({
        kind: ApiResourceKind.agent,
        name: "Skill Creator",
        slug: "skill-creator",
      }),
    ]),
  ),

  fixtures.agentInstance.get(() => demoInstance),
  fixtures.agentInstance.getByReference(() => demoInstance),
  fixtures.agentInstance.list(() => ({
    entries: [demoInstance],
    totalPages: 1,
  })),
  fixtures.agentInstance.create(() => demoInstance),

  fixtures.environment.list(() => ({
    entries: [samples.environment()],
    totalPages: 1,
  })),
  fixtures.environment.create(() => samples.environment()),
);

export { skillCreationExecution, SKILL_MD_CONTENT };
