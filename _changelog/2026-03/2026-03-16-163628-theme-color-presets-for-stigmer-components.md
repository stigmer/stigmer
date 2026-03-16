# Theme Color Presets for Stigmer Components

**Date**: March 16, 2026

## Summary

Added 4 color presets (Rose, Amber, Violet, Emerald) to `@stigmer/theme` alongside the existing default teal palette. A new `ThemePresetSelector` dropdown in the web console header lets users switch presets live. Each preset works orthogonally with the existing light/dark mode toggle, giving platform builders a concrete demonstration of how Stigmer components adapt to different color schemes via `--stgm-*` CSS custom properties.

## Problem Statement

Stigmer is a platform for platforms — external developers embed Stigmer's React components into their own products. The style isolation work (cascade layers, `--stgm-*` namespaced tokens, `.stgm` scoping) established the mechanism for theming, but there was no visible proof or reference implementation showing that theming actually works.

### Pain Points

- Platform builders had to read CSS source to discover which `--stgm-*` variables to override — no documentation, no examples, no starting points
- The `@stigmer/theme` README still referenced the old non-namespaced variable names (`--background` instead of `--stgm-background`)
- The Stigmer console itself only demonstrated one palette, making it impossible to visually validate that components adapt to different color schemes
- No preset system existed — every integrator started from scratch

## Solution

Ship ready-made color presets as CSS files in `@stigmer/theme`, expose them via a typed metadata API, and wire a live preset switcher into the console header. The presets serve as both reference implementations for integrators and a testing surface for the Stigmer team.

## Implementation Details

### Preset Architecture

Each preset is a CSS file that overrides "personality" tokens only — primary, ring, chart, and sidebar-primary colors. Structural tokens (background, foreground, muted, border, card, popover) remain untouched, guaranteeing contrast and accessibility regardless of preset.

Presets are applied via a CSS class on `<html>` (e.g., `stgm-theme-rose`), orthogonal to the `.dark` class:

```html
<html class="stgm-theme-rose dark">
```

### Files Created

| File | Purpose |
|------|---------|
| `client-apps/web/_libs/ui/theme/src/presets/rose.css` | Rose preset (hue ~350), light + dark overrides |
| `client-apps/web/_libs/ui/theme/src/presets/amber.css` | Amber preset (hue ~75), light + dark overrides |
| `client-apps/web/_libs/ui/theme/src/presets/violet.css` | Violet preset (hue ~290), light + dark overrides |
| `client-apps/web/_libs/ui/theme/src/presets/emerald.css` | Emerald preset (hue ~155), light + dark overrides |
| `client-apps/web/_libs/ui/theme/src/presets/index.ts` | Typed `THEME_PRESETS` metadata array |
| `client-apps/web/src/components/layout/ThemePresetSelector.tsx` | Dropdown with color swatches, localStorage persistence |

### Files Modified

| File | Change |
|------|--------|
| `client-apps/web/_libs/ui/theme/package.json` | Added preset exports, updated `sideEffects`, updated build script |
| `client-apps/web/_libs/ui/theme/src/index.ts` | Re-exports `THEME_PRESETS` and `ThemePreset` |
| `client-apps/web/_libs/ui/theme/README.md` | Complete rewrite: token reference, preset guide, custom theming docs |
| `client-apps/web/src/app/globals.css` | Added `@import` for all 4 preset CSS files |
| `client-apps/web/src/components/layout/AppHeader.tsx` | Added `ThemePresetSelector` to header |

### Token Override Strategy

Each preset overrides ~11 variables per mode (light + dark = ~22 total):

- `--stgm-primary` / `--stgm-primary-foreground`
- `--stgm-ring`
- `--stgm-chart-1` through `--stgm-chart-5`
- `--stgm-sidebar-primary` / `--stgm-sidebar-primary-foreground`
- `--stgm-sidebar-ring`

All colors use OKLCH for perceptually uniform manipulation across lightness, chroma, and hue.

### ThemePresetSelector Component

Uses the existing shadcn `DropdownMenu` with `RadioGroup` items. Each option shows a color swatch rendered with the preset's representative `swatch` color from metadata. Selection persists in `localStorage` (`stgm-theme-preset` key) and applies the CSS class to `<html>` on mount and change.

## Benefits

- **For the Stigmer team**: Live visual regression testing — switch presets and verify all components adapt correctly
- **For platform builders**: Concrete proof that theming works, plus 4 ready-made starting points they can use or extend
- **For documentation**: The README now has a complete token reference, preset usage guide, and custom theming instructions
- **Zero component changes**: All 22 React components in `@stigmer/react` automatically respond to preset changes through existing `--stgm-*` variable consumption

## Impact

- `@stigmer/theme` package gains 5 new exports (4 CSS presets + 1 metadata module)
- Web console header gains a preset selector dropdown alongside the existing light/dark toggle
- Platform builder onboarding friction reduced: `@import` a preset, add a class, done

## Related Work

- [Style Isolation for @stigmer/react Embeddable Components](2026-03-16-145326-react-style-isolation-for-embeddable-components.md) — the cascade layer + namespaced token foundation this builds on

---

**Status**: Production Ready
