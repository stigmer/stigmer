# StigmerProvider Preset Prop and Dark Mode CSS Fix

**Date**: March 16, 2026

## Summary

Added a type-safe `preset` prop to `StigmerProvider` so platform builders can apply built-in theme presets programmatically instead of manually wiring CSS class names. Also fixed a dark mode CSS selector issue in all four preset files that would have broken preset rendering in embedded (non-Console) contexts.

## Problem Statement

Platform builders embedding Stigmer components into their products had no programmatic way to apply theme presets. The only path was to know the internal CSS class naming convention (`stgm-theme-corporate`) and pass it through the `className` prop — leaking an implementation detail across the SDK boundary.

### Pain Points

- Preset application required knowledge of internal CSS class names (`stgm-theme-corporate`, `stgm-theme-startup`, etc.)
- No TypeScript autocomplete or compile-time validation for preset selection
- Internal CSS class renames would silently break consumer code
- Dark mode was broken for presets in embedded contexts — compound selectors (`.stgm-theme-X.dark`) required both classes on the same DOM element, which only works when the Console applies them both to `document.documentElement`, not when a host app has `.dark` on `<html>` and the preset class on the StigmerProvider's `<div>`

## Solution

Two changes shipped together because they are co-dependent — the `preset` prop without the CSS fix would ship broken for dark mode:

1. **`preset` prop on `StigmerProvider`** — accepts a `ThemePresetId` (`"default" | "corporate" | "startup" | "friendly" | "fintech"`), resolves it to the correct CSS class internally, and applies it to the scoping container `<div>`.

2. **Dark mode CSS selector fix** — extended each preset's dark mode rule from a compound selector to also match as a descendant selector, covering both the Console (same-element) and embedded (ancestor) dark mode patterns.

## Implementation Details

### New types and utilities in `@stigmer/theme`

- **`ThemePresetId`** — union type derived from the `THEME_PRESETS` array using `as const satisfies readonly ThemePreset[]` (switched from explicit type annotation to `satisfies` to preserve literal types while keeping runtime validation).
- **`resolvePresetClass(id: ThemePresetId): string`** — maps a preset ID to its CSS class name. Returns `""` for `"default"`. Includes a dev-mode `console.warn` for invalid IDs to guard JavaScript consumers who bypass TypeScript.

### StigmerProvider changes

The `preset` prop is optional. When provided, `resolvePresetClass` resolves it to the CSS class, which is merged into the wrapper div's class list via `cn("stgm", presetClass, className)`. The `className` prop remains for arbitrary custom styling — it is not deprecated.

### CSS selector fix

All four preset CSS files changed from:

```css
.stgm-theme-X.dark { /* dark overrides */ }
```

to:

```css
.dark .stgm-theme-X,
.stgm-theme-X.dark { /* dark overrides */ }
```

Both selectors have specificity `0-2-0` — no cascade conflicts. The Console (classes on same element) and embedded (`.dark` on ancestor) cases both work.

## Benefits

- **Simpler integration** — platform builders pass `preset="corporate"` instead of `className="stgm-theme-corporate"`
- **Type-safe** — TypeScript autocompletes valid preset IDs and rejects typos at compile time
- **Decoupled** — internal CSS class naming is no longer part of the public API surface
- **Dark mode correctness** — presets now work correctly in embedded contexts where the host app controls dark mode on an ancestor element

## Impact

- **`@stigmer/theme`** — new exports: `ThemePresetId` type, `resolvePresetClass` function. `THEME_PRESETS` type narrowed (preserves literal types via `satisfies`). Fully backward-compatible — existing consumers that type `THEME_PRESETS` as `readonly ThemePreset[]` are unaffected.
- **`@stigmer/react`** — `StigmerProviderProps` gains optional `preset` prop. No breaking changes.
- **Preset CSS** — all four presets gain a descendant dark mode selector. No breaking changes — the existing compound selector is preserved.
- **Console** — unaffected. `ThemePresetSelector` continues applying classes to `document.documentElement`. `StigmerTransportBridge` does not use the `preset` prop.

## Files Changed

| File | Change |
|------|--------|
| `sdk/theme/src/presets/index.ts` | Add `ThemePresetId` type, `resolvePresetClass` function, switch to `satisfies` |
| `sdk/theme/src/index.ts` | Export `ThemePresetId` and `resolvePresetClass` |
| `sdk/react/src/provider.tsx` | Add `preset` prop, resolve to CSS class on wrapper div |
| `sdk/theme/src/presets/corporate.css` | Add `.dark .stgm-theme-corporate` descendant selector |
| `sdk/theme/src/presets/startup.css` | Add `.dark .stgm-theme-startup` descendant selector |
| `sdk/theme/src/presets/friendly.css` | Add `.dark .stgm-theme-friendly` descendant selector |
| `sdk/theme/src/presets/fintech.css` | Add `.dark .stgm-theme-fintech` descendant selector |

## Related Work

- [SDK Theme Token Sync](2026-03-16-173118-sdk-theme-token-sync-success-warning-info-chart.md) — Task 1 of the same project (token alignment)
- [Theme Color Presets](2026-03-16-163628-theme-color-presets-for-stigmer-components.md) — original preset system implementation
- [React Style Isolation](2026-03-16-145326-react-style-isolation-for-embeddable-components.md) — the `.stgm` scoping layer that this builds on

---

**Status**: Production Ready
**Timeline**: Single session
