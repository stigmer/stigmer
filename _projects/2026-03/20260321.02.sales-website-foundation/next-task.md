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
**Current Task**: Phase 4 (Page and Section Templates) is next
**Status**: In Progress — Phases 1-3 Complete

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

### Key Observations
- The forward-references in `website-standards.md` (lines 9-13) already pointed to the exact filenames created in Phase 3 — no edits to Phase 1 deliverables were needed.
- Extended banned phrases from 12 to 16 by adding `leverage`, `best-of-breed`, `cutting-edge`, and `AI-powered` from reminder 006.
- Added `enforced_by` annotations (`"lint"` or `"review"`) to copy guidelines to guide Phase 8 lint tooling scope.
- Grouped all numerically-enforceable thresholds (performance, accessibility, SEO) into `performance-budget.json` as a single source of truth for measurable constraints.

## Next Steps

1. **Phase 4: Page and Section Templates** — 9 page templates + 8 section templates in `site/standards/templates/`. Depends on page/section types from Phases 1-2.
2. **Phase 5: Component Standards** — `site/standards/component-standards.md`. Can run in parallel with Phase 4.
3. **Phase 6: Cursor Rules** — 3 rules in `.cursor/rules/site/`. Depends on all artifacts from Phases 1-5.

## Context for Resume

- Branch: `feat/add-docs`
- The `site/standards/` directory now has 5 files: `website-standards.md`, `information-architecture.md`, `content-requirements.json`, `copy-guidelines.json`, `performance-budget.json`
- The task plan (`tasks/T01_0_plan.md`) contains the full 8-phase breakdown with dependencies and success criteria
- Phases 4 and 5 can run in parallel (both depend on Phases 1-2, not on Phase 3 specifically)
- Phase 6 depends on Phases 1-5 (all must be complete)

## Quick Commands

After loading context:
- "Start Phase 4" - Begin Page and Section Templates
- "Start Phase 5" - Begin Component Standards
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review Phase 3 deliverables" - Read the three JSON files in `site/standards/`

---

*This file provides direct paths to all project resources for quick context loading.*
