# Next Task: 20260321.04.content-framework-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.04.content-framework-cleanup

**Description**: Clean up clutter from two previous foundation projects. Build a component-based content framework for docs and sales website. Three roles (content designer, content author, content engineer), two text snippets, components that replace templates.
**Goal**: An AI-friendly framework where components enforce structure, content authors fill slots, and every conversation starts with a role + two snippets.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4

## Current State

- **Status**: Phase 2 scaffolding complete, ready to build custom components
- **Last Session**: March 21, 2026 — created `@docs-kit` internal package
- **Active Task**: Phase 2: Build custom doc components (DefinitionBanner first)

## Session Progress (2026-03-21, Session 2)

- Created `site/packages/docs-kit/` as an internal package with TypeScript path alias `@docs-kit`
- Added `@docs-kit` and `@docs-kit/*` path aliases to `site/tsconfig.json`
- Created barrel export `index.ts` and Fumadocs re-export file `fumadocs.ts`
- Migrated `Mermaid` and `LanguageIcons` from `site/src/components/mdx/` into `packages/docs-kit/components/`
- Deleted empty `site/src/components/mdx/` directory
- Updated `site/src/app/docs/[[...slug]]/page.tsx` to import all doc components from `@docs-kit`
- Wired Fumadocs built-ins (Callout, Tabs, Steps, Accordion, Card, Cards) through docs-kit barrel
- Verified: `yarn typecheck` and `yarn build` both pass clean

## Session Progress (2026-03-21, Session 1)

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

1. **Build custom doc components** — start with `DefinitionBanner`, then `ProblemStatement`, `ComparisonTable`, etc. Each component gets its own review cycle (prop API presented before coding).
2. **Phase 3: Rewrite one doc as proof** — rewrite `docs/concepts/what-is-stigmer.mdx` using the new component library to validate the framework.
3. **Phase 4: Finalize workflow** — document the content designer/author/engineer handoff.

## Essential Files

### Plan
```
_projects/2026-03/20260321.04.content-framework-cleanup/tasks/T01_2_revised_plan.md
```

### Docs Kit Package (new)
```
site/packages/docs-kit/index.ts        # barrel export
site/packages/docs-kit/fumadocs.ts     # Fumadocs re-exports
site/packages/docs-kit/components/     # component implementations
site/packages/docs-kit/internal/       # shared utilities
site/packages/docs-kit/README.md       # contributor docs
```

### Wiring
```
site/src/app/docs/[[...slug]]/page.tsx  # imports from @docs-kit
site/tsconfig.json                      # @docs-kit path alias
```

### Roles
```
_roles/010_content_designer.md
_roles/011_content_author.md
_roles/012_content_engineer.md
```

### Snippets
```
_snippets/content-context.md
_snippets/content-quality.md
```

### Terminology Rule
```
.cursor/rules/content-terminology.mdc
```

## Context for Resume

- Phase 1 (cleanup) and Phase 2 scaffolding are both complete
- `@docs-kit` is the internal package alias — all doc components import from here
- Fumadocs built-ins (Callout, Tabs, Steps, Accordion, Card, Cards) are re-exported through docs-kit
- `Mermaid` and `LanguageIcons` already live in docs-kit
- The `internal/` directory under docs-kit is empty — ready for shared utilities when needed
- Components are server components by default; only add `"use client"` when needed
- Three JSON files survived Phase 1: `docs/standards/terminology.json`, `site/standards/copy-guidelines.json`, `site/standards/performance-budget.json`
- Two lint scripts survived: `site/scripts/lint-copy.ts`, `site/scripts/lint-performance.sh`
- Console roles (004_web_ux_ui, 006_ux_designer) are untouched
- Node.js 20 required: `nvm use 20`
- Branch: `feat/add-docs`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.04.content-framework-cleanup/next-task.md`
