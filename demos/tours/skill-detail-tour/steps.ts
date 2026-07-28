/**
 * Skill detail tour — a single establishing beat of the real `SkillDetailView`
 * on the console's skill page. It sits directly under the SKILL.md listing on
 * `docs/concepts/skills.mdx` ("Here's how this Skill looks in the Stigmer web
 * console"), so the reader must see exactly the file they just read.
 *
 * `SKILL_MD` therefore byte-matches that listing's code fence, and
 * `scripts/verify-docs-tour-parity.test.mjs` drift-locks the two — edit the
 * docs listing and this constant together, or the root test suite fails.
 *
 * Ported from the `skill-detail` docs inline demo (whose SKILL.md had drifted
 * from the listing — an extra bullet, bolded lead-ins, and a third escalation
 * rule the docs never showed).
 */
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type SkillDetailTourStep = { view: "skill-detail" };

/** Slug the fixture skill is published under (the real view fetches it). */
export const SKILL_SLUG = "return-policy";

// ---------------------------------------------------------------------------
// Skill fixture (the real SkillDetailView renders this)
// ---------------------------------------------------------------------------

/**
 * Byte-identical to the ```md fence on `docs/concepts/skills.mdx` (the
 * listing this tour's still sits under). Drift-locked by
 * `scripts/verify-docs-tour-parity.test.mjs`.
 */
export const SKILL_MD = `---
name: return-policy
description: >
  Acme Corp return and refund policy. Use when customers ask about returns,
  exchanges, refunds, or warranty claims.
---

# Return Policy

## Standard Returns

Customers may return unused items within 30 days of purchase for a full refund.
Items must be in original packaging.

## Exceptions

The following items cannot be returned:

- Personalized or custom-made products
- Perishable goods
- Digital downloads after activation

## Refund Processing

- Credit card: refund appears within 5–10 business days
- Store credit: issued immediately upon return approval
- Always refund to the original payment method unless the customer requests
  store credit

## Escalation Rules

- Refunds over $500 require manager approval
- Returns past the 30-day window need case-by-case review`;

/**
 * The demo skill returned by the mocked `SkillQueryController.getByReference`
 * (see `.scenar/providers.tsx`). The description is the frontmatter's folded
 * scalar, resolved — the sentence the Agent reads when deciding whether to
 * consult this Skill.
 */
export function buildDemoSkill() {
  return samples.skill({
    name: SKILL_SLUG,
    org: DEMO_ORG,
    description:
      "Acme Corp return and refund policy. Use when customers ask about returns, exchanges, refunds, or warranty claims.",
    skillMd: SKILL_MD,
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const skillDetailTourSteps: ScenarioStep<SkillDetailTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady establishing frame of the rendered SKILL.md.
    delayMs: 6000,
    data: { view: "skill-detail" },
    // The steady frame doubles as the still on docs/concepts/skills (its
    // <Still id="skill-detail-tour/skill-detail">). That reference is why
    // this tour must stay in the repo even with no <ScenarEmbed> left —
    // verify-scenar-tours invariant 8 holds the two sides together.
    shot: "skill-detail",
    narration:
      "This is the same SKILL dot MD, rendered in the console — the " +
      "description the Agent always sees, and the policy it loads when a " +
      "question matches.",
  },
];
