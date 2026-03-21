# Docs Clean Slate + Visual Foundation (Phase 1)

**Date**: March 21, 2026

## Summary

Completed Phase 1 of the docs content migration: deleted ~125 stale documentation files, added Mermaid diagram rendering to Fumadocs, and introduced scoped typography overrides for the docs layout. The docs site now builds cleanly with a minimal placeholder page, professional reading comfort, and full Mermaid support — ready for content to be written from ground truth.

## Problem Statement

The Stigmer docs site had ~125 legacy files containing stale implementation details, wrong prerequisites, and AI-generated guesses about architecture. The visual foundation was also lacking — no custom typography (tight default spacing), and no diagram rendering despite the documentation standards mandating Mermaid-only diagrams.

### Pain Points

- ~125 stale `.md` and `.mdx` files that would mislead readers if left in place
- Fumadocs default typography had tight spacing, making content harder to read
- No Mermaid rendering configured despite the Mermaid-only diagram mandate from Phase 0
- New content could not include diagrams without Mermaid support

## Solution

Three parallel workstreams executed in sequence: clean the content slate, fix the visual foundation, and wire up Mermaid rendering. All changes scoped to the docs layout — the marketing site is unaffected.

## Implementation Details

### Content deletion

Removed 14 directories under `docs/` (`adr/`, `architecture/`, `audit-reports/`, `cli/`, `concepts/`, `deployment/`, `engineering/`, `getting-started/`, `guides/`, `implementation/`, `product/`, `quickstarts/`, `sdk/`, `README.md`). Preserved `docs/standards/` (10 files). Replaced `docs/index.mdx` and `docs/meta.json` with minimal placeholders.

Note: The stale content had already been removed in a prior commit on the `feat/add-docs` branch, so this was verified rather than re-executed.

### Typography overrides

Added a `DOCS TYPOGRAPHY` CSS block in `site/src/app/globals.css` scoped to `#nd-page .prose` (the Fumadocs article container). Changes:

- Body text `line-height: 1.75` (up from Fumadocs default ~1.5)
- Paragraph bottom margin `1.25em`
- H2 top margin `2.5em`, H3 `2em`, H4 `1.5em`
- Code block (`pre`), table, and blockquote margins `1.5em`
- List item spacing `0.35em`
- Horizontal rule spacing `2.5em`

### Mermaid rendering

- Installed `mermaid` and `next-themes` as direct dependencies
- Created `site/src/components/mdx/mermaid.tsx` — a `'use client'` component following the official Fumadocs Mermaid guide, with theme-aware rendering, lazy loading, and diagram caching
- Added `remarkMdxMermaid` plugin from `fumadocs-core/mdx-plugins` to `site/source.config.ts` so ` ```mermaid` fenced code blocks auto-convert to `<Mermaid>` components
- Registered the `Mermaid` component in `site/src/app/docs/[[...slug]]/page.tsx`

### Build verification

`yarn build` with Node 20 passes with zero errors. All 7 static pages generated.

## Benefits

- Clean content slate — no stale docs to mislead platform builders
- Professional reading comfort matching docs.temporal.io quality bar
- Mermaid diagrams render natively from fenced code blocks — no manual component wiring needed per-page
- Marketing site completely unaffected by the docs CSS changes

## Impact

- **Docs site**: Ready for Phase 2 (home page) and Phase 3 (concept docs from protos)
- **Content authors**: Can now use ` ```mermaid` blocks and they render automatically
- **Readers**: Improved typography makes future content more comfortable to read

## Related Work

- Phase 0 (Audience & Purpose Foundation) — established the platform-builder audience, Diataxis framework, and Mermaid-only diagram mandate
- Phase 2 (Docs Home Page) — next phase, will build a polished landing page with SDK icons
- Phase 3 (Top 5 Concepts) — will rebuild concept docs from proto ground truth using Mermaid diagrams

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
