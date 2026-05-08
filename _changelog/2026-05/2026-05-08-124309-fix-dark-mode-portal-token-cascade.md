# Fix Dark Mode Token Cascade for Portaled Content

**Date**: May 8, 2026

## Summary

Portaled content (model selector, context popovers, configure menu, org switcher dialog, runner picker, dropdown menus) rendered with light-mode backgrounds in dark mode because Base UI's `Portal` components teleport content to `document.body`, escaping the `data-stgm-color-mode="dark"` scoping container. This fix introduces a managed portal container in `StigmerProvider` so all portaled content inherits the correct design token values.

## Problem Statement

The Stigmer theming system scopes dark-mode CSS custom properties to `[data-stgm-color-mode="dark"]`, an attribute set on the `.stgm` container rendered by `StigmerProvider`. When Base UI Portal components (`Popover.Portal`, `Dialog.Portal`, `Select.Portal`, `Menu.Portal`) teleport their content to `document.body`, the portaled DOM nodes are **not descendants** of the `.stgm` container. They fall back to `:root` (light-mode) token values — producing white popover backgrounds on a dark page.

### Pain Points

- Model selector popover appeared white in dark mode — jarring visual inconsistency
- All 6 portal-using components in the SDK were affected
- The bug existed across all theme presets (monochrome, corporate, startup, friendly, fintech)
- Platform builders embedding Stigmer components in their dark-mode apps would also see the broken styling

## Solution

`StigmerProvider` now creates a dedicated portal container `<div>` appended to `document.body` that carries the same scoping attributes (`class="stgm [preset]"`, `data-stgm-color-mode`). All portal-using SDK components target this container via the `container` prop instead of portaling to raw `document.body`.

The approach preserves style isolation (no global attribute on `<html>`), supports multiple `StigmerProvider` instances with different color modes, and keeps portaled content at `document.body` level to avoid z-index/overflow clipping.

## Implementation Details

### New file: `sdk/react/src/portal-container.ts`

- `PortalContainerContext` — React context holding the managed portal container element
- `useStigmerPortalContainer()` — public hook returning `HTMLElement | null` (null = fallback to default portal behavior)

### Updated: `sdk/react/src/provider.tsx`

- Added `usePortalContainer()` internal hook that:
  - Creates a `<div>` on mount and appends it to `document.body`
  - Sets `class="stgm [presetClass]"`, `data-stgm-color-mode`, and `data-stgm-portal` attributes
  - Keeps attributes in sync with color mode / preset prop changes via a separate effect
  - Removes the element on unmount
  - Returns `null` during SSR (no `document`)
- Wraps children in `PortalContainerContext.Provider`

### Updated: 6 portal-using components

Each component imports `useStigmerPortalContainer` and passes the container to its Base UI Portal:

| Component | Portal type |
|-----------|-------------|
| `ModelSelector.tsx` | `Popover.Portal` |
| `ContextPopover.tsx` | `Popover.Portal` |
| `ConfigureMenu.tsx` | `Popover.Portal` |
| `OrgSwitcher.tsx` | `Dialog.Portal` |
| `RunnerPicker.tsx` | `Select.Portal` |
| `internal/menu.tsx` | `Menu.Portal` |

### Updated: `sdk/react/src/index.ts`

- Exports `useStigmerPortalContainer` for platform builders who create custom portaled components

## Benefits

- Dark mode popovers, dialogs, menus, and select dropdowns now correctly inherit `--stgm-*` token values across all presets
- Platform builders embedding Stigmer in their own dark-mode apps get correct theming automatically
- Multiple `StigmerProvider` instances on the same page can have different color modes without interference
- Fully backward-compatible: components used outside a provider fall back to `document.body`

## Impact

- **SDK consumers**: All portaled overlays now respect dark mode — no action required
- **Platform builders**: New `useStigmerPortalContainer` hook available for custom portaled components
- **Console**: Model selector, workspace/configure popovers, org switcher dialog, runner picker, and all dropdown menus now display correctly in dark mode

## Related Work

- `2026-05-07-175217-model-selector-ux-redesign.md` — Model selector redesign (introduced the Base UI Popover usage)
- `2026-05-07-184546-compact-harness-selector-layout.md` — Compact harness selector layout
- `2026-05-07-191002-model-selector-visual-density-alignment.md` — Visual density alignment

---

**Status**: ✅ Production Ready
