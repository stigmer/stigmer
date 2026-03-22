# Fumadocs Integration: Documentation Site at /docs

**Date**: March 22, 2026

## Summary

Integrated Fumadocs into the existing Next.js marketing site to render 36 MDX documentation files as a navigable, searchable documentation site at `/docs/`. The docs are statically exported alongside the marketing pages, include sidebar navigation with section ordering, dark-themed Stigmer branding, and client-side Orama search — all compatible with `output: 'export'` for GitHub Pages deployment.

## Problem Statement

Stigmer had 36 freshly scaffolded MDX documentation files (from T05) sitting in `docs/` with no way for users to read them in a browser. The marketing site at `site/` existed as a standalone Next.js app with static export. Documentation needed to be rendered, navigable, and searchable without introducing a separate build system or breaking the existing marketing pages.

### Pain Points

- No rendered documentation — users had to read raw MDX on GitHub
- No sidebar navigation for browsing documentation sections
- No search capability across documentation content
- No integration path between the marketing site and docs content
- Content lived outside the Next.js project root (`../docs` relative to `site/`)

## Solution

Chose Fumadocs (fumadocs-core v15.8.5, fumadocs-mdx v13.0.8, fumadocs-ui v15.8.5) as the documentation framework, scoped entirely to the `/docs/*` route tree within the existing Next.js app. Fumadocs was selected for its native Next.js App Router support, MDX-first design, built-in static search, and Tailwind CSS compatibility.

Key architectural decisions:
- **Scoped integration**: `RootProvider` placed in `app/docs/layout.tsx`, not the root layout — Fumadocs contexts (theme, search) only affect docs pages, marketing pages are untouched
- **Relative content path**: `source.config.ts` points to `../docs` with `_archive` exclusion patterns
- **Static Orama search**: Pre-built 295KB JSON index via `force-static` API route, avoiding dynamic server requirements
- **CSS variable override strategy**: Fumadocs `--color-fd-*` tokens mapped to Stigmer's dark theme HSL values
- **`meta.json` sidebar control**: 10 files (root + 9 sections) define explicit page ordering and section titles

## Implementation Details

### New Files Created (11)
- `site/source.config.ts` — Fumadocs content source definition with archive exclusion
- `site/src/components/mdx.tsx` — MDX component provider with relative link support
- `site/src/lib/source.ts` — Content loader wrapping `fumadocs-core/source`
- `site/src/lib/layout.shared.tsx` — Shared nav config (Stigmer logo, Home/Docs/GitHub links)
- `site/src/app/docs/layout.tsx` — Scoped `RootProvider` + `DocsLayout` with static search
- `site/src/app/docs/[[...slug]]/page.tsx` — Catch-all page with `generateStaticParams` and SEO metadata
- `site/src/app/api/search/route.ts` — Static Orama search index endpoint
- `site/.nvmrc` — Pins Node.js 22 (Node.js 23 has a confirmed webpack bug)
- `docs/meta.json` + 9 section-level `meta.json` files — Sidebar ordering

### Modified Files (8)
- `site/next.config.ts` — Wrapped with `createMDX()` from `fumadocs-mdx/next`
- `site/tsconfig.json` — Added `~source` path alias for generated Fumadocs source
- `site/package.json` — Added 5 dependencies, upgraded Next.js to 15.3.9, switched dev from Turbopack to webpack
- `site/src/app/globals.css` — Added Fumadocs CSS imports, `@source` directive, and 14 `--color-fd-*` variable overrides
- `site/.gitignore` — Added `.source/` exclusion
- `site/Makefile` — Added `.source` to clean target
- `site/src/components/sections/Hero.tsx` — Replaced `<a>` with `<Link>` for internal navigation
- `site/src/components/sections/Quickstart.tsx` — Replaced `<a>` with `<Link>` for internal navigation

### Version Compatibility Resolution
Fumadocs v16 (latest) requires Next.js 16 and React 19.2+, which the project doesn't use. Identified Fumadocs v15 as the correct version line — fully compatible with Next.js 15.x, React 19.0.0, and Tailwind CSS v4.

### Node.js 23 Workaround
Discovered and resolved a confirmed bug where Node.js 23's webpack `PackFileCacheStrategy` silently aborts Next.js builds with exit code 0, producing no output. Pinned Node.js 22 via `.nvmrc`.

### Turbopack Incompatibility
Fumadocs-mdx uses `?collection=docs` query-string imports internally. Turbopack cannot resolve these; webpack handles them via the `createMDX()` loader configuration. Removed `--turbopack` from the dev script.

## Benefits

- **35 documentation pages** rendered at `/docs/` with proper navigation
- **295KB static search index** enabling instant client-side full-text search across all docs
- **Zero marketing page regressions** — scoped integration leaves existing pages untouched
- **42 total static pages** exported (marketing + docs + utility routes)
- **18-second clean build** time including image generation, MDX compilation, and static export
- **Sidebar navigation** with explicit section ordering matching the content architecture

## Impact

- **Users**: Can now browse documentation at `stigmer.ai/docs` with search and navigation
- **Contributors**: Adding new docs pages automatically appears in the site — no manual wiring
- **CI/CD**: Static export (`out/`) is compatible with GitHub Pages deployment pipeline
- **Future work**: T07 (Snipsync), T08 (CI gate), and T09 (advanced features) can build on this foundation

## Related Work

- **T05: Archive + Content Architecture** — Created the 36 MDX files and 10-section structure that this task renders
- **T01: Vale Prose Linter** — Ensures content quality before it reaches the rendered site
- **T02: Lint + Formatting Targets** — Makefile targets for docs quality checks
- **T09: Advanced Features** — Will add custom MDX components, LLM output rendering on this foundation

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (including extensive debugging of Node.js 23 / Turbopack incompatibilities)
