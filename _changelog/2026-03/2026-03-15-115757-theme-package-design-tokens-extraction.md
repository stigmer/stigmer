# @stigmer/theme: Design System Foundation Package

**Date**: March 15, 2026

## Summary

Implemented `@stigmer/theme` as the UI layer package in the `_libs` three-layer architecture. Extracts the `cn()` class-name utility and CSS design tokens from the web console into a reusable workspace package, establishing a single source of truth for Stigmer's visual identity. This is the third package in the `_libs` stack (after `@stigmer/rpc-client`), and a prerequisite for `@stigmer/react-ui`.

## Problem Statement

The `cn()` utility and CSS design tokens (35+ oklch color variables for light and dark themes) were embedded in the web console's application code. This created two problems:

### Pain Points

- `cn()` lives in `src/lib/utils.ts` — every library package that renders styled components would need to duplicate it or depend on the console's internal path
- CSS design tokens are inlined in `src/app/globals.css`, mixed together with Tailwind framework config, app-level settings, and the Tailwind bridge layer — no way for external consumers to reuse Stigmer's color palette
- T04 (`@stigmer/react-ui`) needs `cn()` from a shared package — without `@stigmer/theme`, the domain layer would either import from the console (forbidden by `_libs` architecture rules) or duplicate the function

## Solution

Created `@stigmer/theme` with a clean two-artifact design:

1. **TypeScript exports** (`cn`, `ClassValue`) — the class-name merge utility that every styled component depends on
2. **CSS subpath export** (`@stigmer/theme/tokens.css`) — raw CSS custom properties for light and dark themes, consumable by any CSS framework

The package is deliberately minimal. It provides design primitives, not component authoring tools or framework configuration.

## Implementation Details

### Files Created

- `_libs/ui/theme/src/utils.ts` — `cn()` function (clsx + tailwind-merge) with `ClassValue` type re-export
- `_libs/ui/theme/src/tokens.css` — All CSS custom properties: `:root` (light) and `.dark` (dark override) blocks, 35+ oklch values covering background, foreground, primary, secondary, muted, accent, destructive, border, input, ring, chart-1..5, and sidebar-* tokens

### Files Updated

- `_libs/ui/theme/src/index.ts` — Barrel export for `cn` and `ClassValue`
- `_libs/ui/theme/package.json` — Added `"./tokens.css": "./src/tokens.css"` subpath export
- `src/app/globals.css` — Replaced 70 lines of inline token definitions with `@import "@stigmer/theme/tokens.css"`

### What Stays in globals.css

The `globals.css` split was the key design decision. Four conceptual layers were identified:

| Layer | Moved? | Rationale |
|-------|--------|-----------|
| Design tokens (`:root`, `.dark`) | Yes | Platform visual identity — shared across all packages and consumers |
| Tailwind bridge (`@theme inline`) | No | Maps CSS vars to Tailwind utilities; references Next.js font vars (`--font-geist-sans`) — moving would couple theme to Next.js font infrastructure |
| Framework bootstrap (`@import "tailwindcss"`) | No | App-level Tailwind setup |
| App styles (`@custom-variant dark`, body font-feature) | No | Console-specific configuration |

### What Was NOT Added

- **No React theme context** — Planton needed `PlantonThemeContext` for MUI mode bridging. Stigmer uses Tailwind's CSS-class-based dark mode (`.dark` on root element); no JS mode detection needed.
- **No `cva`/`VariantProps` re-export** — These are component authoring tools from `class-variance-authority`, not theme concerns. Components import CVA directly.
- **No Tailwind config** — The `@theme inline` block is framework plumbing, not a design token.

## Benefits

- **Single source of truth** for design tokens — the theme package owns color palette definitions
- **`cn()` available for `_libs` packages** — T04 (`@stigmer/react-ui`) can import from `@stigmer/theme` without violating the no-`@/`-imports rule
- **CSS tokens consumable by any framework** — the `tokens.css` file contains pure CSS custom properties with no framework dependencies
- **`ClassValue` type re-exported** — downstream packages can type `className` props without a direct `clsx` peer dependency

## Impact

- **@stigmer/react-ui** (T04): Unblocked — execution components can now import `cn` from the theme package
- **Stigmer web console**: `globals.css` reduced from 121 lines to 51 lines; tokens sourced from theme package via CSS `@import`
- **External consumers** (T06): Foundation laid — platform owners will get design tokens as part of the npm package

## Related Work

- Preceded by: `@stigmer/rpc-client` (T02) — infra layer package
- Enables: `@stigmer/react-ui` (T04) — domain layer package with execution components
- Part of: `20260315.01.web-libs-setup` project — establishing the `_libs` workspace package pattern

---

**Status**: Production Ready
**Timeline**: ~30 minutes (implementation + verification)
