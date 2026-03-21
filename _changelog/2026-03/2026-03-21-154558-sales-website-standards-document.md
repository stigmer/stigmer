# Sales Website Standards Document

**Date**: March 21, 2026

## Summary

Created the master standards document for the Stigmer sales website (`site/standards/website-standards.md`), establishing the authoritative reference for all content, design, performance, accessibility, and SEO decisions. This is Phase 1 of the sales-website-foundation project and parallels `docs/standards/documentation-standards.md` for the documentation site.

## Problem Statement

The sales website had no codified standards. Quality expectations were scattered across three roles (007 Growth Marketing Strategist, 008 Sales Website Designer, 009 Developer Copywriter) and two reminders (005 Sales Website Mindset, 006 Developer Marketing Principles). This meant:

### Pain Points

- No single source of truth for what a sales website page must contain
- No machine-enforceable rules — everything was prose guidance
- No defined page types beyond "homepage" (the only page that existed)
- No section type requirements (each section was ad-hoc)
- No copy rules beyond what was embedded in role descriptions
- No codified performance budget, despite existing Lighthouse baselines
- No Cursor rules to auto-enforce standards during development
- AI-assisted development had no guardrails specific to `site/`

## Solution

Created a comprehensive standards document that synthesizes and codifies the existing role and reminder material into a single, enforceable reference. The document follows the same structural pattern as `docs/standards/documentation-standards.md`: mandates up front, specifics in the middle, quality checklist at the end.

## Implementation Details

**File**: `site/standards/website-standards.md` (568 lines)

Nine sections, each grounded in existing source material:

1. **Mandates** (7 non-negotiable rules) — Synthesized from all three roles and both reminders. Each mandate has a concrete test: the "Acme AI Platform" substitution test for authenticity, numeric CWV targets for performance, WCAG 2.1 AA for accessibility.

2. **Page Types** (9 types) — Registry drawn from Role 007's page type definitions. Each type has: purpose, audience, funnel stage, required sections, and a forward-reference to a template.

3. **Section Types** (8 types) — Codified from Role 008's narrative arc requirements and Reminder 005's section job definitions. Each section has a defined "job" (Hook, Educate, Prove, Convert, etc.), a requirements table, and quality criteria.

4. **Copy Rules** — Consolidated from Role 009's mandates and Reminder 006's banned patterns. Includes the Feature-Benefit-Proof pattern, 13 specific banned phrases with "Why" and "Replace With" columns, required patterns, and terminology source reference.

5. **Design Rules** — Grounded in the actual codebase: typography references Geist Sans/Mono, color system references the real CSS custom properties from `globals.css` (including HSL values), animation rules reference named variants from `lib/animations.ts`, spacing follows the Tailwind scale, component taxonomy matches the existing `site/src/components/` directory structure.

6. **Performance Requirements** — Hard numeric targets: LCP < 2500ms, CLS < 0.1, JS < 150KB, CSS < 50KB, images < 200KB, 2 font families, 4 weights max. These targets become the input for Phase 8's lint tooling.

7. **Accessibility Requirements** — WCAG 2.1 AA with specific contrast ratios (4.5:1 body, 3:1 large text), keyboard navigation rules, screen reader requirements, reduced motion handling, and 44px minimum touch targets.

8. **SEO Requirements** — Title tags (< 60 chars), meta descriptions (< 160 chars), heading hierarchy, JSON-LD structured data schemas, internal linking rules, and Open Graph requirements.

9. **Quality Checklist** — 34 pass/fail items across 5 categories (Content, Design, Performance, Accessibility, SEO). This is the pre-merge verification gate.

The preamble includes forward-references to artifacts that subsequent phases will create: `content-requirements.json`, `copy-guidelines.json`, `performance-budget.json`, `component-standards.md`, `information-architecture.md`, and `templates/`.

## Benefits

- **Single source of truth**: One document replaces the need to consult 5 separate files for website quality expectations
- **Machine-enforceable**: Numeric targets, banned phrase lists, and pass/fail checklist items are all inputs for Phase 3 (JSON files) and Phase 8 (lint tooling)
- **Cursor rule ready**: The document's structure directly maps to what the Phase 6 Cursor rules will inject into AI context
- **Grounded in reality**: Design rules reference actual tokens and variants from the existing codebase, not abstract ideals

## Impact

- **Standards infrastructure**: Establishes the foundation that all 7 remaining phases of the project build upon
- **AI-assisted development**: Future Cursor rules will reference this document to enforce quality during site development
- **Content project readiness**: When the follow-up content project begins, the templates and requirements will be ready

## Related Work

- `docs/standards/documentation-standards.md` — The reference model this document parallels
- Roles 007/008/009 — Source material synthesized into this document
- Reminders 005/006 — Source material synthesized into this document
- Project: `_projects/2026-03/20260321.02.sales-website-foundation` — This is Phase 1 of 8

---

**Status**: ✅ Production Ready
**Timeline**: Single session
