# Monochrome Theme Preset for Stigmer Desktop and SDK

**Date**: April 26, 2026

## Summary

Added a monochrome theme preset to `@stigmer/theme` that replaces the default teal accent with a pure black-and-white editorial aesthetic, matching the Stigmer marketing website. Applied it to the desktop app so all screens — including pre-auth login and loading states — render in monochrome with system-aware light/dark mode.

## Problem Statement

The Stigmer desktop app shipped with the default teal theme (`oklch(0.55 0.12 190)` primary), which clashed with the marketing website's monochrome visual identity. The "S" badge, buttons, and focus rings all rendered in teal, creating a disjointed brand experience between the website and the desktop product.

### Pain Points

- Desktop app buttons and badges appeared teal/green, not matching the website's black-and-white brand
- No zero-chroma preset existed in the theme system despite the marketing site being fully monochromatic
- The `LoginScreen` and loading spinner rendered outside `StigmerProvider`, so any preset applied via the provider wouldn't reach pre-auth screens

## Solution

Created a new `monochrome` theme preset following the established preset architecture, derived from the marketing site's HSL palette translated to OKLCH. Restructured the desktop app's component tree so `StigmerProvider` wraps all content — including pre-auth screens — ensuring consistent theming across the entire app lifecycle.

## Implementation Details

### New preset: `sdk/theme/src/presets/monochrome.css`

- Zero-chroma OKLCH values for all surface, border, and interactive tokens
- Primary = foreground color (black buttons on white in light mode, white on dark in dark mode)
- Tight radius (`0.375rem`), minimal shadows, fast transitions (`100ms`)
- Both light and dark mode variants following the same `[data-stgm-color-mode="dark"]` selector pattern as all other presets
- Semantic status colors (destructive, success, warning, info) intentionally not overridden — they fall through from `tokens.css` to preserve operational meaning
- Grayscale chart palette with five evenly spaced lightness values

### Preset registration

- Added to `THEME_PRESETS` array in `sdk/theme/src/presets/index.ts`
- Added package export entries in `sdk/theme/package.json` for both dev and publish configs

### Desktop app integration

- Added `preset="monochrome"` to `StigmerProvider` in `App.tsx`
- Restructured `AuthenticatedApp` to wrap `StigmerProvider` around ALL content (loading, login, and authenticated views) by extracting an `AppContent` component — this ensures the monochrome preset class reaches pre-auth screens
- The `Stigmer` SDK client is created before the auth check (it was already) and the provider is purely a CSS scoping container + React context, so this restructuring is safe

### Web console availability

- Imported `monochrome.css` in `client-apps/web/src/app/globals.css` so the preset is available to web console consumers (not applied by default yet)

## Benefits

- Desktop app now matches the marketing website's editorial black-and-white aesthetic
- System dark/light mode continues to work seamlessly with the monochrome palette
- Platform builders gain a sixth theme preset option for embedding Stigmer in monochrome host applications
- No breaking changes — the default teal tokens remain for consumers who don't set a preset
- Zero component-level changes required — the token cascade handles everything automatically

## Impact

- **Desktop app**: Fully re-themed to monochrome across all screens
- **SDK**: New preset available to all `@stigmer/theme` and `@stigmer/react` consumers
- **Web console**: Preset CSS imported and ready for future use
- **Platform builders**: Can use `preset="monochrome"` in their `StigmerProvider` to get the same aesthetic

## Related Work

- Marketing site monochromatic palette: `site/src/app/globals.css`
- Existing theme preset architecture: corporate, startup, friendly, fintech
- Self-contained color mode for StigmerProvider: `2026-04-23-195002-self-contained-color-mode-for-stigmer-provider.md`

---

**Status**: ✅ Production Ready
