# Docs Kit Internal Package

**Date**: March 21, 2026

## Summary

Created `@docs-kit`, an internal component package within the site project that gives doc MDX components their own ownership boundary. All doc components now import from a single barrel (`@docs-kit`) instead of scattered fumadocs-ui and app-level imports. The package is ready for the 8 custom doc components planned in Phase 2.

## Problem Statement

The revised plan calls for 8 custom doc components (DefinitionBanner, ProblemStatement, ComparisonTable, etc.) plus wiring Fumadocs built-ins. Without a clear package boundary, these components would scatter across `site/src/components/` alongside marketing and layout code, making ownership unclear and maintenance difficult.

### Pain Points

- Doc components mixed with marketing site components in `site/src/components/`
- No clear ownership boundary for doc-specific code
- MDX component registration in `page.tsx` imported from 4+ different locations
- Adding 8+ new components to an already flat structure would make navigation harder

## Solution

Created `site/packages/docs-kit/` as a directory-level package resolved via a TypeScript path alias (`@docs-kit`). No npm publishing, no separate build, no workspace config — just clean directory separation with a barrel export.

## Implementation Details

- **Path alias**: Added `@docs-kit` and `@docs-kit/*` to `site/tsconfig.json`, mapping to `./packages/docs-kit`
- **Barrel export**: `index.ts` is the only public import surface — consumers never reach into internals
- **Fumadocs re-exports**: `fumadocs.ts` centralizes Callout, Tab/Tabs, Step/Steps, Accordion/Accordions, Card/Cards from fumadocs-ui
- **Component migration**: Moved `Mermaid` and `LanguageIcons` from `site/src/components/mdx/` into `packages/docs-kit/components/`
- **Wiring update**: `page.tsx` now imports all doc components from `@docs-kit` (2 import sources instead of 4)
- **Prepared directories**: `components/` for implementations, `internal/` for shared utilities

## Benefits

- Clear ownership boundary between doc components and app code
- Single import source for all MDX components in docs
- `packages/` physically separated from `src/` — the boundary is visible in the file tree
- Internal structure is refactorable without changing consumer imports (barrel pattern)
- Ready for the 8 custom components with zero additional wiring

## Impact

- **Docs site**: All existing docs continue to work — `Mermaid` and `LanguageIcons` function identically from their new location
- **Build**: `yarn typecheck` and `yarn build` both pass clean
- **Future work**: Every new doc component just needs to be added to `packages/docs-kit/components/`, exported from `index.ts`, and registered in `mdxComponents`

## Related Work

- Follows the packaging pattern established by `@stigmer/react` (SDK) and `client-apps/web` (Console), adapted for internal-only use
- Part of project 20260321.04.content-framework-cleanup, Phase 2
- Previous changelog: `2026-03-21-191543-content-framework-cleanup-phase-1.md`

---

**Status**: Production Ready
