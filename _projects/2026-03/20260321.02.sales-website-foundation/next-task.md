# Next Task: 20260321.02.sales-website-foundation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.02.sales-website-foundation

**Description**: Establish patterns, standards, templates, and enforcement mechanisms for the Stigmer sales website. Creates the same standards infrastructure for site/ that the documentation-foundation project created for docs/ — machine-readable standards, page/section templates, Cursor rules, lint tooling, and quality checklists. Ensures AI-assisted development produces consistently high-quality, conversion-optimized content.
**Goal**: Create a complete standards foundation for the Stigmer sales website: website-standards.md, information architecture, machine-readable content requirements, copy guidelines, performance budgets, component standards, page and section templates, Cursor rules for enforcement, lint tooling, and updated roles/reminders.
**Tech Stack**: Markdown, JSON, MDC (Cursor rules), TypeScript/ESLint (lint tooling), Next.js/Tailwind (existing site stack)
**Components**: site/standards/, .cursor/rules/site/, _reminders/, _roles/, tools/ (lint scripts)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.02.sales-website-foundation/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-21 15:20
**Current Task**: Phase 5 (Component Standards) or Phase 8 (Lint Tooling) is next
**Status**: In Progress — Phases 1-4, 6, and 7 Complete

## Session Progress (2026-03-21)

### Completed: Phase 1 — Master Standards Document
- Created `site/standards/website-standards.md` (568 lines, 9 sections)
- Sections: Mandates (7 rules), Page Types (9), Section Types (8), Copy Rules, Design Rules, Performance Requirements, Accessibility Requirements, SEO Requirements, Quality Checklist (34 items)
- Grounded design rules in actual codebase tokens (`globals.css`, `lib/animations.ts`)
- Synthesized content from roles 007/008/009 and reminders 005/006
- Committed: `20ea547a docs(site): add sales website standards document`

### Completed: Phase 2 — Information Architecture
- Created `site/standards/information-architecture.md` (5 sections)
- **Page Map**: 18 pages organized by funnel stage (Awareness → Interest → Evaluation → Action → Cross-Funnel), with persona mapping for all 3 personas (solo dev, platform builder, engineering leader)
- **Navigation Structure**: Header nav (6 items: Use Cases, Features, Compare, Docs, Pricing, GitHub), footer nav (4 groups: Product, Developers, Resources, Open Source), mobile drawer, breadcrumb rules
- **URL Scheme**: Predictable patterns for all 9 page types, slug conventions, directory-to-route mapping for Next.js App Router
- **Internal Linking Rules**: Funnel flow diagram, linking requirements per page type, anchor text rules, cross-site linking (docs, GitHub), orphan page prevention
- **Page Inventory**: Current state (1 page + dead links), priority tiers (P0 foundation, P1 first wave with 8 pages, P2 second wave with 7 pages, P3 ongoing), dead link resolution plan

### Completed: Phase 3 — Machine-Readable Standards
- Created `site/standards/content-requirements.json` (192 lines) — 9 page types, 8 section types, 3 personas, funnel stages, global rules
- Created `site/standards/copy-guidelines.json` (185 lines) — 7 voice rules, 16 banned phrases with reasons/replacements, 6 required patterns, 6 sales terminology entries
- Created `site/standards/performance-budget.json` (125 lines) — Core Web Vitals, Lighthouse target, bundle/asset budgets, accessibility thresholds, SEO character limits, responsive breakpoints
- All forward-reference links in `website-standards.md` now resolve to real files
- All three files validated as correct JSON

### Completed: Phase 4 — Page and Section Templates
- Created `site/standards/templates/` directory with 17 markdown specification files (1,780 lines total)
- **8 section templates**: hero, features, how-it-works, code-showcase, comparison, social-proof, cta-band, faq — each defines job, required elements, constraints, copy guidance, design notes, accessibility requirements, and a quality checklist
- **9 page templates**: homepage, use-case-page, comparison-page, feature-page, landing-page, pricing-page, changelog-page, blog-page, community-page — each defines metadata, narrative arc, section sequence with per-section requirements, CTA strategy, internal linking requirements, structured data, and a quality checklist
- Templates are content specifications consumed by Cursor rules and human authors, not code
- Section templates are referenced by page templates (e.g., homepage references `section-hero.md`, `section-features.md`, etc.)
- Page templates ordered by priority tier: P0/P1 pages first (homepage, use-case, comparison, feature, landing), then P2/P3 (pricing, changelog, blog, community)
- The forward-reference link in `website-standards.md` line 7 (`templates/`) now resolves to a populated directory

### Completed: Phase 6 — Cursor Rules (Enforcement)
- Created `.cursor/rules/site/website-standards.mdc` — auto-apply rule triggered on `site/src/**/*.{tsx,ts,css}` edits. Condenses all 7 mandates, page types, section types, copy rules, design rules, performance budget, accessibility, and SEO into a single rule that the AI gets automatically without dragging files.
- Created `.cursor/rules/site/write-website-content.mdc` — action rule invoked as `@write-website-content`. Defines a 5-step Content Brief process (Page Type → Audience/Funnel → Template Compliance → Copy Brief → Confirmation) before any drafting begins.
- Created `.cursor/rules/site/review-website-content.mdc` — action rule invoked as `@review-website-content`. Contains a 34-item quality checklist (content, copy, design, performance, accessibility, SEO) with structured review output format and severity levels.
- Phase 6 was moved ahead of Phase 5 (Component Standards) because enforcement is more valuable than additional standards documents — the Cursor rules turn Phases 1-4 from passive files into active guardrails.

### Completed: Phase 7 — Reminder and Role Updates
- Created `_reminders/008_website-standards.md` (83 lines) — quick-reference reminder modeled on `004_documentation-standards.md`, with audience personas, reference documents table, Cursor rules table, templates list, 7 mandates, Content Brief process, and quality checklist
- Updated `_roles/007_growth_marketing_strategist.md` — added REFERENCE DOCUMENTS section (5 standards files + 3 Cursor rules), strengthened mandate #6 to reference the now-existing IA, connected Marketing Strategy Brief to `@write-website-content` rule
- Updated `_roles/008_sales_website_designer.md` — added REFERENCE DOCUMENTS section (4 documents + 3 Cursor rules), strengthened mandate #5 to cite `performance-budget.json` as single source of truth, strengthened mandate #8 to connect component system to section templates, connected Design Brief to Cursor rules
- Updated `_roles/009_developer_copywriter.md` — added REFERENCE DOCUMENTS section (5 documents + 3 Cursor rules), strengthened mandate #2 to reference `copy-guidelines.json` for banned phrases, strengthened quality standard #3 to add `copy-guidelines.json` sales terminology, connected Copy Brief to `@write-website-content` rule
- Numbering note: task plan originally called the reminder `007_website-standards.md` but 007 was already taken by `007_documentation-for-platform-builders.md`, so it became 008

### Key Observations
- The forward-references in `website-standards.md` (lines 9-13) already pointed to the exact filenames created in Phase 3 — no edits to Phase 1 deliverables were needed.
- Extended banned phrases from 12 to 16 by adding `leverage`, `best-of-breed`, `cutting-edge`, and `AI-powered` from reminder 006.
- Added `enforced_by` annotations (`"lint"` or `"review"`) to copy guidelines to guide Phase 8 lint tooling scope.
- Grouped all numerically-enforceable thresholds (performance, accessibility, SEO) into `performance-budget.json` as a single source of truth for measurable constraints.

## Next Steps

1. **Phase 5: Component Standards** — `site/standards/component-standards.md`. Depends on design rules from Phase 1. Can be done any time.
2. ~~**Phase 6: Cursor Rules**~~ — DONE. 3 rules in `.cursor/rules/site/`.
3. ~~**Phase 7: Reminder and Role Updates**~~ — DONE. `_reminders/008_website-standards.md` + roles 007, 008, 009 updated.
4. **Phase 8: Lint Tooling** — `site/scripts/lint-copy.ts`, `site/scripts/lint-pages.ts`, Makefile integration.

## Context for Resume

- Branch: `feat/add-docs`
- The `site/standards/` directory now has 5 files + a `templates/` subdirectory with 17 template files
- Files: `website-standards.md`, `information-architecture.md`, `content-requirements.json`, `copy-guidelines.json`, `performance-budget.json`
- Templates: 8 section templates (`section-*.md`) + 9 page templates (`*.md`)
- **Cursor rules**: `.cursor/rules/site/` has 3 rules: `website-standards.mdc` (auto-apply on `site/src/**`), `write-website-content.mdc` (action), `review-website-content.mdc` (action)
- **Reminder**: `_reminders/008_website-standards.md` — quick-reference for website standards (parallel to 004 for docs)
- **Roles updated**: 007, 008, 009 now have REFERENCE DOCUMENTS sections pointing to all standards artifacts and Cursor rules
- The task plan (`tasks/T01_0_plan.md`) contains the full 8-phase breakdown with dependencies and success criteria
- Phase 5 (Component Standards) can be done any time — it is standalone
- Phase 8 (Lint Tooling) is the final phase

## Quick Commands

After loading context:
- "Start Phase 5" - Begin Component Standards
- "Start Phase 8" - Begin Lint Tooling
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
