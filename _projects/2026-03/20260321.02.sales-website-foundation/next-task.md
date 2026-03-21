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
**Current Task**: Phase 2 (Information Architecture) is next
**Status**: In Progress — Phase 1 Complete

## Session Progress (2026-03-21)

### Completed: Phase 1 — Master Standards Document
- Created `site/standards/website-standards.md` (568 lines, 9 sections)
- Sections: Mandates (7 rules), Page Types (9), Section Types (8), Copy Rules, Design Rules, Performance Requirements, Accessibility Requirements, SEO Requirements, Quality Checklist (34 items)
- Grounded design rules in actual codebase tokens (`globals.css`, `lib/animations.ts`)
- Synthesized content from roles 007/008/009 and reminders 005/006
- Committed: `20ea547a docs(site): add sales website standards document`

### Key Observations
- The document forward-references artifacts from Phases 2-5 (JSON files, templates, component-standards, information-architecture). Those links will resolve as subsequent phases deliver.
- No design decisions, wrong assumptions, or don't-dos recorded — Phase 1 was a straightforward codification of existing material.

## Next Steps

1. **Phase 2: Information Architecture** — Create `site/standards/information-architecture.md` defining the complete page map, navigation structure, URL scheme, and internal linking rules. Depends on the page types defined in Phase 1.
2. **Phase 3: Machine-Readable Standards** — Create `content-requirements.json`, `copy-guidelines.json`, `performance-budget.json`. Depends on rules codified in Phases 1-2.
3. Phases 4 and 5 can run in parallel after Phases 1-2.

## Context for Resume

- Branch: `feat/add-docs`
- The `site/standards/` directory now exists with one file
- The task plan (`tasks/T01_0_plan.md`) contains the full 8-phase breakdown with dependencies and success criteria
- The execution order diagram in the task plan shows Phase 2 depends only on Phase 1 (now complete)

## Quick Commands

After loading context:
- "Start Phase 2" - Begin Information Architecture
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review Phase 1 deliverable" - Read `site/standards/website-standards.md`

---

*This file provides direct paths to all project resources for quick context loading.*
