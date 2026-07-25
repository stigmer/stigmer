/**
 * Skill creation tour — the walkthrough for "Your first Skill", showing the
 * flow the product supports today: author SKILL.md in your own editor
 * (Cursor, Claude Code, anything), zip it, upload it in the console with the
 * real `SkillUploader`, and land on the Skill's detail page in the Library.
 *
 * Deliberately NOT an AI-conversation flow — there is no Skill Creator agent
 * in the product yet, and a Getting Started tour must depict what a viewer
 * can actually do. If/when an AI-assisted flow ships, `agent-creation-tour`
 * is the conversation-tour pattern to follow.
 *
 * `index.tsx` renders these steps; `.scenar/providers.tsx` supplies the Skill
 * fixture the real `SkillDetailView` fetches. The cursor is driven by each
 * step's declarative `interactions` (the packed embed wires it — there is no
 * per-view hook).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type SkillCreationTourStep =
  | { view: "editor" }
  | { view: "library-click" }
  | { view: "skills-list" }
  | { view: "create-skill-click" }
  | { view: "uploader" }
  | { view: "skill-detail" }
  | { view: "library-complete" };

/** Slug the fixture skill is published under (the real detail view fetches it). */
export const SKILL_SLUG = "return-policy";

// ---------------------------------------------------------------------------
// SKILL.md — shown in the editor prologue and rendered by the detail view
// ---------------------------------------------------------------------------

/**
 * The skill file the tour's story revolves around. Also carried by the Skill
 * fixture as `spec.skillMd` (see `buildDemoSkill`), so the detail view
 * renders this exact content.
 */
export const SKILL_MD = `---
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
// Skill + library fixtures
// ---------------------------------------------------------------------------

/**
 * The skill returned by the mocked `SkillQueryController.getByReference`
 * (see `.scenar/providers.tsx`). Content travels inline as `spec.skillMd`
 * (no `status.artifactStorageKey`), so `SkillDetailView` renders the
 * markdown directly — no artifact-ZIP fetch, keeping the mock to one RPC.
 */
export function buildDemoSkill() {
  return samples.skill({
    id: "skl-00000000-0000-0000-0000-000000000003",
    name: "Return Policy",
    slug: SKILL_SLUG,
    org: DEMO_ORG,
    description: "Acme Corp's customer return and refund policy.",
    skillMd: SKILL_MD,
  });
}

/** The Skills library before the tour: two unrelated existing skills. */
export const EXISTING_SKILLS = [
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.skill,
    name: "Product Catalog",
    slug: "product-catalog",
    description: "Technical specs and pricing for all product lines.",
  }),
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.skill,
    name: "Escalation Runbook",
    slug: "escalation-runbook",
    description: "Step-by-step process for customer issue escalation.",
  }),
];

/** The Skills library after the upload: the new return-policy skill joins. */
export const ALL_SKILLS = [
  ...EXISTING_SKILLS,
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000003",
    kind: ApiResourceKind.skill,
    name: "Return Policy",
    slug: SKILL_SLUG,
    description: "Acme Corp's customer return and refund policy.",
  }),
];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Cursor choreography: each pointing step sets its cursor mid-step and clears
 * it before the step ends, so every step is self-contained — no step depends
 * on a previous step's cursor state (the pattern all ported tours use).
 */
export const skillCreationTourSteps: ScenarioStep<SkillCreationTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "editor" },
    narration:
      "A Skill is a plain markdown file: a name, a description, and your domain knowledge. Author it in Cursor, Claude Code, or any editor you like.",
    // No cursor here: the embed arms step-0 interactions at mount (under the
    // poster), so they fire before Play — a @scenar/react quirk every ported
    // tour works around by keeping its first step cursor-less. (Narration on
    // step 0 is fine; create-agent-tour ships it.)
  },
  {
    delayMs: 3000,
    data: { view: "library-click" },
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "library" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2000,
    data: { view: "skills-list" },
    narration:
      "Skills are pieces of domain knowledge. Each one teaches your agent about a specific topic.",
  },
  {
    delayMs: 2000,
    data: { view: "create-skill-click" },
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "create-skill" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 1500,
    data: { view: "uploader" },
    narration:
      "Zip the folder and drop it here. Stigmer validates the package and its SKILL.md automatically.",
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "skill-dropzone" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "skill-detail" },
    narration:
      "Once pushed, your Skill gets its own page, where you can review and update the content at any time.",
  },
  {
    delayMs: 3000,
    data: { view: "library-complete" },
    narration:
      "The Skill is in your Library, ready to attach to any agent.",
  },
];
