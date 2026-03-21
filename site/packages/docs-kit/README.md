# @docs-kit

Internal component library for the Stigmer documentation site.

This is **not** a published npm package. It is an internal directory resolved via a
TypeScript path alias (`@docs-kit` → `./packages/docs-kit`). Next.js transpiles it
as part of the normal site build.

## Usage

Every MDX component available in docs is exported from the barrel:

```tsx
import { DefinitionBanner, ComparisonTable } from "@docs-kit";
```

Components are registered once in `site/src/app/docs/[[...slug]]/page.tsx` and become
available in all `.mdx` files without per-file imports.

## Structure

```
packages/docs-kit/
├── index.ts          # barrel — the ONLY public import surface
├── fumadocs.ts       # re-exports of Fumadocs built-ins we register
├── components/       # custom doc components
└── internal/         # shared utilities (not exported from barrel)
```

## Rules

- **Barrel-only imports.** Consumers import from `@docs-kit`, never from
  `@docs-kit/components/...` or `@docs-kit/internal/...`.
- **Server components by default.** Only add `"use client"` when the component
  needs browser APIs or React state.
- **Props enforce structure.** Typed props define slots; children fill them.
  No ad-hoc layouts.
- **No app dependencies.** Components must not import from `@/*` (the site app).
  They can import from `fumadocs-ui`, `fumadocs-core`, `react`, and `@docs-kit/internal`.
