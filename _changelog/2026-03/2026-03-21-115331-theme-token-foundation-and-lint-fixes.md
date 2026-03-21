# Theme Token Foundation and Lint Fixes

**Date**: March 21, 2026

## Summary

Added 6 new semantic design tokens to `@stigmer/theme` and resolved all 25 ESLint issues (3 errors, 22 warnings) that were failing `make check`. This establishes the token vocabulary needed for common UI states — hover, subtle tints, skeletons, backdrops — that were previously approximated with Tailwind opacity modifiers, bypassing the preset system.

## Problem Statement

`make check` failed at the web ESLint step with 25 issues. All 22 warnings were `stigmer/no-token-opacity-modifiers` violations — places where developers used Tailwind opacity modifiers (e.g., `bg-primary/90`, `bg-muted/50`, `bg-destructive/10`) on design-token colors. These modifiers bypass the theme system because each preset cannot independently control the resulting color.

### Pain Points

- `make check` CI gate was red — blocking any merge
- 22 components used opacity modifiers that would render incorrectly across theme presets (Corporate, Startup, Friendly, Fintech)
- The token vocabulary lacked dedicated tokens for common patterns: hover states, subtle tints, skeleton loading, backdrop overlays
- The `Button` component — the most foundational UI primitive — used the same anti-patterns in its `cva()` definition but escaped the linter because the ESLint rule only scans JSX `className` attributes
- Two React hooks errors (`setState` in effects) indicated patterns that would cause cascading renders

## Solution

A two-layer fix: expand the token foundation first, then update all components to consume the new tokens.

**New tokens added to `@stigmer/theme`:**

| Token | Purpose |
|-------|---------|
| `--stgm-primary-hover` | Hover state for primary buttons and links |
| `--stgm-primary-subtle` | Light primary tint for badges, chips, indicators |
| `--stgm-destructive-subtle` | Light destructive tint for error backgrounds |
| `--stgm-muted-subtle` | Softer muted for card footers, table hover, skeleton base |
| `--stgm-muted-foreground-subtle` | Extra-dim text for ancillary information |
| `--stgm-backdrop` | Semi-transparent overlay with alpha (the one token that intentionally carries transparency) |

Each token has hand-tuned values for light and dark modes across all 5 theme surfaces (default + 4 presets), preserving each preset's hue, chroma, and visual character.

## Implementation Details

### Token System (6 files)

- `sdk/theme/src/tokens.css` — 6 new tokens in `:root` and `.dark`
- `sdk/theme/src/presets/corporate.css` — values tuned to corporate blue palette
- `sdk/theme/src/presets/startup.css` — values tuned to monochrome + violet palette
- `sdk/theme/src/presets/friendly.css` — values tuned to warm coral palette
- `sdk/theme/src/presets/fintech.css` — values tuned to indigo palette
- `client-apps/web/src/app/globals.css` — Tailwind bridge (`@theme inline` mappings)

### Error Fixes (3 files)

- `callback/page.tsx` — Replaced `useState` guard with `useRef` for the OAuth exchange dedup flag (never drives rendering). Replaced raw `<button>` with `<Button>` component.
- `SessionPage.tsx` — Moved agent-init `setState` from `useEffect` to render-body initialization using state guard (React's recommended "adjusting state when a prop changes" pattern). Satisfies both `react-hooks/set-state-in-effect` and `react-hooks/refs` rules.
- `SessionLauncher.tsx` — Removed unused `useMemo` import.

### Warning Fixes (10 files)

All opacity modifiers replaced with semantic tokens:
- `bg-destructive/10` → `bg-destructive-subtle`
- `bg-primary/10` → `bg-primary-subtle`
- `hover:bg-primary/80`, `hover:bg-primary/90` → `hover:bg-primary-hover` or `<Button>`
- `bg-muted/30..60` → `bg-muted-subtle` (containers) or `bg-muted` (dense bars)
- `text-muted-foreground/60` → `text-muted-foreground-subtle`
- `bg-background/80` → `bg-backdrop`
- `hover:bg-accent/50` → `hover:bg-accent`

### Button Component (proactive, 1 file)

Fixed opacity modifiers in `cva()` that escaped the linter:
- Default variant: `[a]:hover:bg-primary/80` → `[a]:hover:bg-primary-hover`
- Ghost variant: `dark:hover:bg-muted/50` → `dark:hover:bg-muted-subtle`
- Destructive variant: `bg-destructive/10` → `bg-destructive-subtle`, hover uses `bg-accent` (neutral hover preserving `text-destructive`)

### ESLint Rule (1 file)

Added 6 new token prefixes to `TOKEN_COLOR_PREFIXES` to prevent future opacity modifiers on the new tokens.

## Benefits

- **CI gate passes**: `npm run lint -w client-apps/web` exits with 0 errors, 0 warnings
- **Preset-safe**: All 5 theme presets now control every visual state independently — no more opacity approximations
- **Foundation for SDK**: The new tokens are part of `@stigmer/theme`, available to platform builders embedding Stigmer components
- **Reduced cascading renders**: The two `setState`-in-effect patterns are eliminated, improving render performance on the session page and OAuth callback
- **Button component clean**: The most-used UI primitive now follows the same token discipline as every other component

## Impact

- **Theme system**: 6 new `--stgm-*` tokens added to the public API surface
- **Web console**: 14 component files updated
- **ESLint plugin**: Rule strengthened with new prefixes
- **Platform builders**: Can now theme hover states, subtle tints, skeletons, and backdrops per-preset

## Related Work

- Builds on `feat(sdk/theme,web): add sidebar-muted tokens and eslint-plugin-stigmer` (commit 3ef70183) which introduced the `no-token-opacity-modifiers` lint rule and the first round of sidebar token fixes

---

**Status**: ✅ Production Ready
**Timeline**: Single session
