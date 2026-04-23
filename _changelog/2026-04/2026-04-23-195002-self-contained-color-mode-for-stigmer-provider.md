# Self-Contained Color Mode for StigmerProvider

**Date**: April 23, 2026

## Summary

Replaced the ancestor `.dark` CSS class convention with a self-contained `colorMode` prop on `StigmerProvider`, backed by a namespaced `data-stgm-color-mode` attribute. Any host application can now control Stigmer's dark/light appearance with a single prop — no Tailwind conventions, no ancestor DOM classes, no framework coupling.

## Problem Statement

The entire dark mode pipeline was gated on a `.dark` CSS class existing somewhere in the ancestor DOM chain — a Tailwind-specific convention enforced across three layers: `tokens.css` (`.dark { ... }`), `styles.css` (`@custom-variant dark (&:is(.dark *))`), and all preset CSS files (`.dark .stgm-theme-*`).

### Pain Points

- Host applications using MUI, Chakra, plain CSS `color-scheme`, or any non-Tailwind dark mode mechanism got light-mode Stigmer components regardless of the host's visual context.
- The workaround — manually adding `class="dark"` to `<html>` — forced host apps to adopt Tailwind's class-based convention, leaking an internal implementation detail into the host's DOM.
- This was a real integration barrier for the "platform for platforms" vision: any platform builder who didn't use Tailwind had to understand and adopt a Tailwind convention to get dark mode working.

## Solution

Introduced a `colorMode` prop on `StigmerProvider` that accepts `"light" | "dark" | "system"` (default: `"light"`). The provider resolves the mode and sets a `data-stgm-color-mode` attribute on its scoping `<div>`. All CSS dark selectors and the Tailwind custom variant now target this namespaced attribute instead of the `.dark` class.

## Implementation Details

### New file: `sdk/react/src/color-mode.ts`

- `ColorMode` type (`"light" | "dark" | "system"`) and `ResolvedColorMode` type (`"light" | "dark"`)
- `ColorModeContext` — React context holding the resolved mode
- `useColorMode()` — public hook for components that need mode-aware JS logic
- `useSystemColorMode()` — internal hook that tracks `matchMedia("(prefers-color-scheme: dark)")`

### Provider changes: `sdk/react/src/provider.tsx`

- Added `colorMode` prop with `"light"` default
- Resolves `"system"` to a concrete mode via `useSystemColorMode()`
- Sets `data-stgm-color-mode` attribute on the scoping `<div>`
- Wraps children in `ColorModeContext.Provider`

### CSS selector migration

| File | Before | After |
|------|--------|-------|
| `sdk/theme/src/tokens.css` | `.dark { ... }` | `[data-stgm-color-mode="dark"] { ... }` |
| `sdk/react/src/styles.css` | `@custom-variant dark (&:is(.dark *))` | `@custom-variant dark (&:is([data-stgm-color-mode="dark"] *))` |
| `sdk/theme/src/presets/*.css` | `.dark .stgm-theme-X, .stgm-theme-X.dark` | `[data-stgm-color-mode="dark"] .stgm-theme-X, .stgm-theme-X[data-stgm-color-mode="dark"]` |

### Console integration

- `StigmerTransportBridge` now reads `resolvedTheme` from `next-themes` and passes it as `colorMode` to `StigmerProvider`.
- Login page similarly bridges `next-themes` state.
- Console's `globals.css` variant updated to match both `.dark` (for Console-level utilities from `next-themes`) and `data-stgm-color-mode` (for SDK components).

### Desktop integration

- Desktop app passes `colorMode="system"` to follow OS preference — appropriate for a standalone app.
- Desktop `globals.css` variant updated to `data-stgm-color-mode`.

### Public API additions

- `useColorMode()` hook — exported from `@stigmer/react`
- `ColorMode` and `ResolvedColorMode` types — exported from `@stigmer/react`
- `ColorModeContext` — exported from `@stigmer/react`

## Benefits

- **Zero host requirements**: Platform builders pass a single prop. No ancestor classes, no Tailwind knowledge, no DOM manipulation.
- **Framework-agnostic**: Works with MUI, Chakra, next-themes, plain CSS, or any other theme system. The host passes its resolved mode directly.
- **Collision-free**: The `data-stgm-color-mode` attribute is namespaced and cannot clash with host styles.
- **SSR-safe**: Default `"light"` produces no flash. The `"system"` option uses `matchMedia` on the client.
- **Self-contained**: The provider controls its own color mode — no dependency on external DOM state.

## Impact

- **SDK consumers**: One-prop dark mode. `<StigmerProvider client={client} colorMode="dark">` just works.
- **Console**: No visible change — dark mode continues to work via `next-themes` bridge.
- **Desktop**: Gains system-preference dark mode support via `colorMode="system"`.
- **Breaking change**: The `.dark` ancestor class convention no longer activates Stigmer dark tokens. Consumers must use the `colorMode` prop instead. Since the only external consumer (Swaroop) was already requesting this change, the migration is straightforward.

## Related Work

- GitHub Issue: [#132 — StigmerProvider should accept an explicit colorMode prop](https://github.com/stigmer/stigmer/issues/132)
- Architecture standards: DD-005 (theme token compliance) updated to reflect new dark mode mechanism.
- Role doc `004_web_ux_ui.md` updated to document the new convention.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
