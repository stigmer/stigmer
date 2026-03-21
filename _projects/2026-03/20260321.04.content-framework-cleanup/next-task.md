# Next Task: 20260321.04.content-framework-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.04.content-framework-cleanup

**Description**: Clean up clutter from two previous foundation projects. Build a component-based content framework for docs and sales website. Three roles (content designer, content author, content engineer), two text snippets, components that replace templates.
**Goal**: An AI-friendly framework where components enforce structure, content authors fill slots, and every conversation starts with a role + two snippets.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4

## Current State

- **Status**: Phase 1 complete, Phase 2 ready to start
- **Last Session**: March 21, 2026 — executed Phase 1: Clean Up
- **Active Task**: Phase 2: Docs Component Library

## Session Progress (2026-03-21)

- Reviewed and approved the revised plan (`tasks/T01_2_revised_plan.md`)
- Created 3 new content roles: 010_content_designer, 011_content_author, 012_content_engineer
- Created 2 text snippets in `_snippets/`: content-context.md, content-quality.md
- Created 1 lean auto-apply cursor rule: `.cursor/rules/content-terminology.mdc`
- Deleted 4 old roles (002, 007, 008, 009)
- Deleted all 8 reminders and the `_reminders/` directory
- Deleted 6 old cursor rules (3 docs + 3 site)
- Deleted 24 template files (7 docs + 17 site)
- Deleted 6 redundant standards docs
- Deleted `lint-pages.ts` (depended on deleted `content-requirements.json`)
- Updated `site/Makefile` and `site/package.json` to remove broken lint references

## Next Steps

1. **Start Phase 2: Docs Component Library** — build actual MDX components that replace templates
2. Wire up Fumadocs built-ins (Callout, Tabs, Steps, Accordion)
3. Build custom doc components: DefinitionBanner, ProblemStatement, ComparisonTable, QuickExample, RelatedDocs, PropertyTable, Prerequisites, StepSequence
4. After Phase 2: Phase 3 (rewrite one doc as proof), Phase 4 (finalize workflow)

## Essential Files

### Plan
```
_projects/2026-03/20260321.04.content-framework-cleanup/tasks/T01_2_revised_plan.md
```

### Roles (new)
```
_roles/010_content_designer.md
_roles/011_content_author.md
_roles/012_content_engineer.md
```

### Snippets (new)
```
_snippets/content-context.md
_snippets/content-quality.md
```

### Terminology Rule (new)
```
.cursor/rules/content-terminology.mdc
```

## Context for Resume

- Phase 1 is fully complete — all deletions and creations done
- Three JSON files survived: `docs/standards/terminology.json`, `site/standards/copy-guidelines.json`, `site/standards/performance-budget.json`
- Two lint scripts survived: `site/scripts/lint-copy.ts`, `site/scripts/lint-performance.sh`
- The new cursor rule auto-applies on `docs/**` and `site/src/**` for terminology enforcement
- Console roles (004_web_ux_ui, 006_ux_designer) are untouched
- Node.js 20 required: `nvm use 20`
- Branch: `feat/add-docs`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.04.content-framework-cleanup/next-task.md`
