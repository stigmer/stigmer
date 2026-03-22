# Next Task: 20260321.04.content-framework-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.04.content-framework-cleanup

**Description**: Clean up clutter from two previous foundation projects. Build a component-based content framework for docs and sales website. Three roles (content designer, content author, content engineer), two text snippets, components that replace templates.
**Goal**: An AI-friendly framework where components enforce structure, content authors fill slots, and every conversation starts with a role + two snippets.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4

## Current State

- **Status**: Phase 2 — four custom doc components built (4 of 8), minimum viable set for Phase 3 rewrite is complete
- **Last Session**: March 21, 2026 — built ProblemStatement (design discussion + implementation)
- **Active Task**: Phase 2: Build remaining custom doc components (PropertyTable next, needs design conversation)

## Session Progress (2026-03-21, Session 4)

- Built `ProblemStatement` custom doc component in `@docs-kit`:
  - Visual container for the "what goes wrong" problem section on concept pages. `<section>` with muted background, `fd-muted-foreground` left bar (differentiated from DefinitionBanner's `accent` bar). Descendant CSS styles consequence bullet markers.
  - Children-based: wraps arbitrary MDX content (prose, code blocks, consequence bullets). No sub-components, no structured props.
  - Headings stay in MDX for TOC compatibility (same pattern as RelatedDocs).
- Exported `ProblemStatement` + `ProblemStatementProps` from `site/packages/docs-kit/index.ts`
- Registered in the MDX component map (`site/src/app/docs/[[...slug]]/page.tsx`)
- Verified: `yarn typecheck` and `yarn build` both pass clean (13 pages, all 7 docs)

### Design Decisions Made (Session 4)

| Decision | Rationale |
|---|---|
| Visual container (Option A), not sub-components (Option C) or focused list (Option B) | All 5 concept pages share identical problem section structure (narrative + code + "What goes wrong" + bullets). Content authors already follow this organically — no need to enforce internal structure with `<Problem>` sub-components. A wrapper provides the visual signal without fighting MDX composition. |
| `children` only, no other props | Simplest API that solves the need. The heading stays in MDX (TOC constraint). Content inside is standard markdown — code blocks, prose, lists. No metadata to extract into props. |
| `<section>` not `<aside>` | This is a content section of the page (the problem explanation), not supplementary information. DefinitionBanner uses `<aside role="note">` because it is a thesis statement/summary — supplementary to the main content. |
| `fd-muted-foreground` left bar, `bg-fd-muted/30` background | Differentiates from DefinitionBanner (which uses `accent` left bar, `bg-fd-card`, `shadow-md`). ProblemStatement is less prominent — it's a section within the page, not a card floating above it. No shadow. |
| No `not-prose` | Unlike ComparisonTable (custom table layout needing `not-prose`), ProblemStatement wraps prose content — paragraphs, code blocks, lists. Prose styling must be inherited for correct rendering. |
| Departed from plan's `<Problem>` sub-component sketch | The plan's Phase 3 example was a simplified sketch. Actual content includes code blocks, narrative paragraphs, and rich bullet text that would be awkward as structured child components. MDX composition with JSX sub-components is also the most fragile pattern (whitespace/newline sensitivity). |

## Session Progress (2026-03-21, Session 3)

- Built 3 custom doc components in `@docs-kit`:
  - `DefinitionBanner` — page-level TL;DR with optional analogy badge. `<aside role="note">` with accent left border. Uses Fumadocs `fd-` tokens for structural styling, Stigmer `accent` token for brand identity.
  - `ComparisonTable` — two-column without/with comparison table. Props-based rows (not children), muted "before" column, full-contrast "after" column. `not-prose` to bypass Fumadocs table auto-styling.
  - `RelatedDocs` — navigation card grid composing Fumadocs `Card`/`Cards`. Heading stays in MDX for TOC compatibility.
- Exported all 3 components + their TypeScript interfaces from `site/packages/docs-kit/index.ts`
- Registered all 3 in the MDX component map (`site/src/app/docs/[[...slug]]/page.tsx`)
- Verified: `yarn typecheck` and `yarn build` both pass clean (13 pages, all 7 docs)

### Design Decisions Made (Session 3)

| Decision | Rationale |
|---|---|
| DefinitionBanner: analogy as badge prop, not inline text | Analogy is metadata about the definition (classifies the concept). Badge creates a scannable pattern across pages. Definition text stands alone without it. |
| ComparisonTable: rows as typed props, not MDX children | Table data is data, not composition. Props give build-time type safety. More AI-friendly than nested JSX. |
| RelatedDocs: heading outside component (in MDX) | Fumadocs extracts TOC headings from MDX AST at compile time. A heading rendered inside a React component would NOT appear in the sidebar TOC. Hard constraint. |
| Fumadocs `fd-` tokens for structure, Stigmer tokens for accents | Components live inside Fumadocs docs layout. Using `fd-` tokens ensures visual consistency with Callout, Card, etc. Stigmer `accent`/`primary` used only for brand accent elements. |

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

1. **Phase 3 is now unblocked** — the minimum viable component set for rewriting `docs/concepts/what-is-stigmer.mdx` is complete: DefinitionBanner + ComparisonTable + RelatedDocs + ProblemStatement. This is the highest-value next task.
2. **PropertyTable (batch 2, optional)** — needs a design conversation: existing "Key properties" tables across concept pages vary from 2–4 columns. May not justify a custom component vs. plain markdown tables. Evaluate during Phase 3 rewrite.
3. **Lower-priority components** — `QuickExample` (low complexity, "Getting started" works fine as plain code blocks), `Prerequisites` and `StepSequence` (quickstart pages — deferred until quickstart content exists to validate against).
4. **Phase 4: Finalize workflow** — document the content designer/author/engineer handoff.

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
- Phase 2 batch 1 (DefinitionBanner, ComparisonTable, RelatedDocs) is complete
- Phase 2 batch 2 partial: ProblemStatement is complete. PropertyTable deferred pending design conversation.
- `@docs-kit` is the internal package alias — all doc components import from here
- Fumadocs built-ins (Callout, Tabs, Steps, Accordion, Card, Cards) are re-exported through docs-kit
- Custom components: `DefinitionBanner`, `ComparisonTable`, `RelatedDocs`, `ProblemStatement` — all server components, all registered in MDX map
- Minimum viable set for Phase 3 doc rewrite is complete (DefinitionBanner + ComparisonTable + RelatedDocs + ProblemStatement)
- `Mermaid` and `LanguageIcons` already live in docs-kit
- The `internal/` directory under docs-kit is empty — ready for shared utilities when needed
- Components are server components by default; only add `"use client"` when needed
- Theming pattern: `fd-` prefixed Tailwind classes for Fumadocs structural consistency, Stigmer design tokens (`accent`, `primary`) for brand accent elements
- Three JSON files survived Phase 1: `docs/standards/terminology.json`, `site/standards/copy-guidelines.json`, `site/standards/performance-budget.json`
- Two lint scripts survived: `site/scripts/lint-copy.ts`, `site/scripts/lint-performance.sh`
- Console roles (004_web_ux_ui, 006_ux_designer) are untouched
- Node.js 20 required: `nvm use 20`
- Branch: `feat/add-docs`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.04.content-framework-cleanup/next-task.md`
