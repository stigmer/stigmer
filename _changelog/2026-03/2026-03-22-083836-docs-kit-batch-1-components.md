# Docs Kit Batch 1: DefinitionBanner, ComparisonTable, RelatedDocs

**Date**: March 22, 2026

## Summary

Built the first 3 custom doc components in `@docs-kit` — DefinitionBanner, ComparisonTable, and RelatedDocs. These replace the manually-written structural patterns that repeat identically across all 4 concept pages. Each component enforces structure through typed props so content authors fill slots rather than inventing layouts.

## Problem Statement

Every concept doc page (`what-is-stigmer`, `agent`, `session`, `agent-execution`) uses the same structural skeleton: bold opening definition, comparison table, further-reading links. But this structure exists only as prose convention — there's no enforcement. Content authors copy-paste and adapt, leading to drift and inconsistency.

### Pain Points

- Opening definitions vary in format — some bold, some plain, analogy placement inconsistent
- Comparison tables are markdown tables with no visual distinction between "before" and "after"
- Further-reading sections are plain bullet lists with no card treatment or consistent formatting
- AI (content author role) cannot reliably reproduce structure from prose conventions alone

## Solution

Build 3 low-risk, obvious-API components that form the bookends of every concept page. Components enforce structure through TypeScript interfaces — the component defines what slots exist, the author fills them.

## Implementation Details

### DefinitionBanner

- `<aside role="note">` with accent left stripe and optional analogy badge
- Props: `analogy?: string`, `children: ReactNode`
- Server component, `not-prose` to control styling within Fumadocs prose context
- Uses Fumadocs `fd-` tokens for structural styling (card background, border), Stigmer `accent` token for brand identity (left stripe, badge)

### ComparisonTable

- Two-column table inside a `not-prose` rounded card container
- Props: `rows: ComparisonRow[]`, `beforeLabel?: string`, `afterLabel?: string`
- "Before" column uses `text-fd-muted-foreground`, "after" uses `text-fd-card-foreground` — color is not the sole differentiator (column headers carry semantic meaning)
- Defaults: "Without Stigmer" / "With Stigmer"

### RelatedDocs

- Composes Fumadocs `Card`/`Cards` internally — reuses the ecosystem
- Props: `links: RelatedDocLink[]` where each link has `href`, `title`, `description`
- Heading stays in MDX (`## Further reading`) so it appears in the Fumadocs TOC sidebar
- Thin wrapper that earns its existence through structural enforcement and future flexibility

### Wiring

- All 3 exported from `site/packages/docs-kit/index.ts` barrel with TypeScript interfaces
- All 3 registered in MDX component map (`site/src/app/docs/[[...slug]]/page.tsx`)
- All server components — no `"use client"`, pure props-to-JSX

## Benefits

- **Structural enforcement**: TypeScript catches missing props at build time. Content authors cannot forget the analogy, omit a comparison column, or break the link format.
- **AI-friendly**: AI sees a component with clear typed slots and can fill them reliably. No need to invent structure from prose descriptions.
- **Visual consistency**: All concept pages get identical treatment for these structural elements.
- **Foundation for Phase 3**: These 3 components (plus ProblemStatement from batch 2) are the minimum set needed to rewrite a concept page as proof.

## Impact

- **docs-kit**: 3 new components, barrel updated, types exported
- **MDX rendering**: 3 new components available in all `.mdx` files without per-file imports
- **Build**: `yarn typecheck` and `yarn build` pass clean (13 pages)

## Related Work

- [Docs Kit Internal Package](2026-03-21-193320-docs-kit-internal-package.md) — the `@docs-kit` package these components live in
- [Content Framework Cleanup Phase 1](2026-03-21-191543-content-framework-cleanup-phase-1.md) — the cleanup that created the roles and snippets powering this framework

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
