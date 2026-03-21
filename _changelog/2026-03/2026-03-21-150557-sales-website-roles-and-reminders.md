# Sales Website Roles and Reminders

**Date**: March 21, 2026

## Summary

Defined three new roles and two new reminders to establish standards for AI-driven sales website development, applying the same discipline that governs backend engineering, web UI, CLI, and AI work to the marketing surface. This fills a gap where the sales website had no defined expertise, no quality standards, and no structured process for content and design decisions.

## Problem Statement

Stigmer has well-established roles and reminders for engineering work — the Architect, Document Writer, CLI/TUI UX Engineer, Web UX/UI Designer, AI Engineer, and UX Designer each have detailed mandates, processes, and quality standards defined in `_roles/001-006`. Four reminders (`_reminders/001-004`) reinforce planning, collaboration, platform-for-platforms thinking, and documentation standards across every conversation.

The sales website (`site/`) had none of this. It was being built with engineering instincts rather than marketing discipline — no defined conversion funnel, no audience segmentation, no copywriting standards, no performance budgets, and no process for ensuring that content decisions serve strategic goals.

### Pain Points

- No role responsible for positioning, messaging, and conversion strategy
- No distinction between product UX design and sales website design — different goals, different patterns, different success metrics
- No copywriting standards specific to developer audiences — the line between technical documentation and persuasive copy was undefined
- No reminders to anchor sales website conversations in the right mindset
- Sales website decisions were made ad-hoc without the structured process (plan → brief → execute) used in engineering

## Solution

Created five files following the established `_roles/` and `_reminders/` patterns:

**Roles:**
- **007 Growth Marketing Strategist** — Owns positioning, audience segmentation, conversion funnel design, competitive intelligence, content strategy, and metrics. Requires a "Marketing Strategy Brief" before any page or content change.
- **008 Sales Website Designer** — Owns visual storytelling, conversion-optimized layouts, CTA hierarchy, performance budgets (Core Web Vitals), developer-credible aesthetics, and responsive/accessible design. Requires a "Design Brief" before any visual work.
- **009 Developer Copywriter** — Owns headline craft, feature-to-benefit translation, developer-authentic voice, objection handling, SEO, and microcopy. Requires a "Copy Brief" before writing any copy.

**Reminders:**
- **005 Sales Website Mindset** — The foundational mindset shift: you are selling, not documenting. Includes conversion funnel mapping, section job definitions, and the three questions to ask before any change.
- **006 Developer Marketing Principles** — Specific rules for marketing to developers: show don't tell, honesty builds trust, technical depth as marketing, open source as trust signal, comparison is expected, banned patterns checklist.

## Implementation Details

### Role Structure

Each role follows the established pattern from existing roles:
1. **Domain Context** — What the sales website is, what it is not, how it differs from product surfaces
2. **The Mandate** — Strict enforcement rules specific to the discipline (conversion-first thinking, storytelling through layout, benefits over features)
3. **Your Process** — Required brief/analysis before executing (Marketing Strategy Brief, Design Brief, Copy Brief)
4. **The Quality Standard** — Non-negotiable quality criteria
5. **Response Style** — How the role should communicate and what it should refuse

### Reminder Structure

Each reminder follows the concise, actionable format of existing reminders — principles with bullet points, tables for structured information, and checklists for verification.

### Key Design Decisions

- **Three roles, not one.** Sales websites require distinct expertise: strategy (what to say and to whom), design (how it looks and flows), and copy (the actual words). Combining them into a single "marketing person" would dilute all three.
- **Developer-specific throughout.** Every role and reminder is grounded in the reality that Stigmer's audience is developers — a group with unique marketing preferences (honesty over polish, code over screenshots, specificity over superlatives).
- **Banned patterns list.** The Developer Marketing Principles reminder includes an explicit list of banned patterns (vague superlatives, stock imagery, gated content, fake urgency, enterprise jargon) to prevent the most common developer marketing anti-patterns.
- **Separate from product design.** The Sales Website Designer role explicitly distinguishes itself from the existing Web UX/UI role (004) — different goals, different patterns, different component system. Marketing components live in `site/src/components/`, not in the SDK packages.

## Benefits

- **Structured process for sales website work.** Every content, design, and copy decision now goes through a brief — same as engineering decisions go through planning.
- **Developer marketing guardrails.** The banned patterns list and tone guidelines prevent the most common mistakes when marketing to technical audiences.
- **Clear separation of concerns.** Three distinct roles prevent the "marketing generalist" anti-pattern where strategy, design, and copywriting quality all suffer.
- **Conversation anchoring.** The two reminders can be attached to any sales website conversation to immediately establish the right mindset and constraints.

## Impact

- **`_roles/`**: 3 new files (007, 008, 009) — expanding the role directory from 6 to 9 files
- **`_reminders/`**: 2 new files (005, 006) — expanding the reminders directory from 4 to 6 files
- **All future sales website conversations** will be governed by these roles and reminders, establishing the same quality discipline that exists for engineering work

## Related Work

- Existing roles: `_roles/001_architect.md` through `_roles/006_ux_designer.md`
- Existing reminders: `_reminders/001_plan-first.md` through `_reminders/004_documentation-standards.md`
- Sales website source: `site/src/` (Hero, Features, Architecture, Quickstart sections)
- Documentation standards: `docs/standards/` (the documentation equivalent of what these roles establish for the sales surface)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
