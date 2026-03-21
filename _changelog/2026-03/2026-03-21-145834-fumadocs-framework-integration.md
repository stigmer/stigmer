# Fumadocs Framework Integration

**Date**: March 21, 2026

## Summary

Integrated Fumadocs into the Stigmer site as the documentation rendering framework. The `/docs` route now serves MDX content from the repo-root `docs/` directory with sidebar navigation, table of contents, and static export support. The marketing page at `/` is completely unaffected.

## Problem Statement

Stigmer had documentation standards and templates (Phase 1) but no way to render them as a browsable documentation site. The existing Next.js site at `site/` served only a marketing landing page. Documentation content in `docs/` was raw Markdown with no rendering pipeline, no sidebar navigation, and no search.

### Pain Points

- Documentation existed as flat files with no web-accessible rendering
- No sidebar navigation or table of contents for docs
- No framework to enforce consistent layout across documentation pages
- No static export pipeline for documentation

## Solution

Adopted Fumadocs — a Next.js-native documentation framework built on MDX — that sources content from the repo-root `docs/` directory and renders it within the existing site. The integration is scoped entirely to the `/docs` route, leaving the marketing page untouched.

## Implementation Details

### Package Stack

| Package | Version | Purpose |
|---|---|---|
| `fumadocs-mdx` | 12.0.3 | MDX content processing, source.config.ts support |
| `fumadocs-core` | 15.8.5 | Headless utilities (source API, page tree, breadcrumbs) |
| `fumadocs-ui` | 15.8.5 | Pre-built layout components (DocsLayout, TOC, sidebar) |
| `next` | 15.3.9 | Upgraded from 15.1.3 (required by fumadocs-mdx v12) |
| `react` | 19.1.0 | Upgraded from 19.0.0 (peer dependency alignment) |

### Architecture

```
docs/              ← MDX content (repo root)
  index.mdx        ← /docs landing
  meta.json         ← sidebar ordering
  concepts/
    index.mdx       ← /docs/concepts
    meta.json

site/
  source.config.ts  ← Fumadocs content sourcing (dir: '../docs')
  src/lib/source.ts ← Runtime loader
  src/app/docs/
    layout.tsx       ← RootProvider + DocsLayout (scoped to /docs)
    [[...slug]]/
      page.tsx       ← MDX renderer + generateStaticParams
```

### Key Design Choices

- **`RootProvider` scoped to `/docs` only** — fumadocs theme/search context does not leak into the marketing page
- **`docs/standards/` excluded** from content sourcing — governance docs are not rendered pages
- **Static export preserved** — `output: "export"` with `generateStaticParams()` for all doc pages
- **Turbopack disabled** — webpack used instead because Turbopack cannot resolve files outside the project root (`../docs/`)

### Collateral Fixes

- `Hero.tsx` and `Quickstart.tsx`: Replaced `<a>` tags with `<Link>` for internal `/docs/` navigation (lint rule)
- `code-block.tsx`: Added `@ts-expect-error` for `react-syntax-highlighter` type mismatch with React 19

## Benefits

- Documentation is now browsable at `/docs` with automatic sidebar navigation
- MDX content in `docs/` is rendered with consistent fumadocs layout components
- Static export generates standalone HTML for every doc page
- Foundation is set for search, TOC, breadcrumbs, and custom MDX components
- Marketing page remains completely isolated

## Impact

- **Site**: `/docs` route tree added, marketing page unaffected
- **Build**: Requires Node.js 20 LTS (Node 23 causes silent webpack crashes)
- **Dev**: `yarn dev` in `site/` now serves docs at `localhost:3000/docs`
- **Dependencies**: Next.js upgraded to 15.3.9, React to 19.1.0

## Related Work

- Phase 1: Documentation Standards & Content Architecture (same project, session 1)
- Previous changelog: `2026-03-21-135824-documentation-standards-and-reminders.md`

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2 of documentation-foundation project
