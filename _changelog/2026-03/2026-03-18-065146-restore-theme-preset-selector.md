# Restore Theme Preset Selector in Appearance Submenu

**Date**: March 18, 2026

## Summary

Re-added the theme preset switching UI to the Appearance submenu in the sidebar UserMenu. The preset selector was removed during the T01.3 UI teardown (commit `10513ce1`) as part of the Session First Web UX project and was never ported to the new headerless sidebar layout. All preset infrastructure in `@stigmer/theme` was already in place — this change only touches Console-level code.

## Problem Statement

The Appearance submenu only offered Light/Dark/System color scheme switching. The five theme presets (Default, Corporate, Startup, Friendly, Fintech) — each with complete light and dark token overrides — were fully implemented in `@stigmer/theme` but had no UI to activate them in the Console.

### Pain Points

- Users could not switch between theme presets despite the CSS and token infrastructure being fully loaded
- The preset CSS files were imported in `globals.css` but never activated (no preset class applied to `<html>`)
- The old `ThemePresetSelector` component was deleted in the teardown and not rebuilt

## Solution

Added preset switching directly into the existing `AppearanceSubmenu` component in `UserMenu.tsx`, alongside the color scheme controls. Included a FOUC-prevention script in `layout.tsx` to apply the stored preset class before React hydration.

## Implementation Details

### `UserMenu.tsx` — Hook and UI

- **`usePresetId()` hook**: Reads/writes `localStorage("stgm-theme-preset")`, toggles preset CSS class on `document.documentElement`, SSR-safe via `useMounted()`. Returns `[presetId, setPresetId]`.
- **`AppearanceSubmenu` extended**: Two labeled sections separated by a divider — "Color Scheme" (Light/Dark/System via `next-themes`) and "Theme" (preset radio group with OKLCH color swatches from each preset's `swatch` field).
- Preset classes compose correctly with dark mode because preset CSS uses `.dark .stgm-theme-corporate` selectors.

### `layout.tsx` — FOUC Prevention

- Blocking inline `<script>` before `<Providers>` reads `localStorage` and applies the preset class synchronously, matching the pattern `next-themes` uses for dark mode. `suppressHydrationWarning` on `<html>` (already present) prevents React warnings.

### Placement Decision

Theme preset switching is Console-only. Platform builders use `StigmerProvider`'s `preset` prop at configuration time — they hard-code it to match their brand. The SDK already provides the mechanism; how a consumer manages that choice is their concern.

## Benefits

- All five theme presets are now accessible from the UI
- Preset selection persists across page reloads via `localStorage`
- No FOUC on page load thanks to the blocking script
- Zero SDK changes — all infrastructure was already in place
- Two orthogonal personalization dimensions (color scheme + theme preset) compose independently

## Impact

- **Files modified**: 2 (`UserMenu.tsx`, `layout.tsx`)
- **Lines added**: 59
- **SDK impact**: None — no new exports, no API changes
- **Breaking changes**: None

## Related Work

- T01.3 UI Teardown — where the original `ThemePresetSelector` was removed
- T01.4 Web App Shell — where the new sidebar layout was built with only Light/Dark/System
- Session 11 — Base Theme Surface Hierarchy fix (the tokens these presets override)

---

**Status**: Production Ready
**Commit**: `bfceeb91` on `feat/session-first-web-ux`
