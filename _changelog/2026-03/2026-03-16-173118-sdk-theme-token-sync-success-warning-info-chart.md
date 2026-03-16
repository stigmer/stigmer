# SDK Theme Token Sync: Success, Warning, Info, and Chart Mappings

**Date**: March 16, 2026

## Summary

Added 11 missing semantic token mappings to the `@stigmer/react` SDK stylesheet, bridging `--stgm-*` custom properties to Tailwind's `--color-*` namespace for success, warning, info, and chart tokens. This completes the embeddable component theme surface so SDK components can use status and data visualization colors through standard Tailwind utilities.

## Problem Statement

The SDK's `@theme inline` block in `sdk/react/src/styles.css` was missing token mappings that the web console's `globals.css` already had. This meant Tailwind utility classes like `bg-success`, `text-warning`, and `bg-chart-1` would not compile inside SDK components, even though the underlying `--stgm-*` CSS custom properties were defined in `@stigmer/theme/tokens.css`.

### Pain Points

- SDK component authors could not use semantic status colors (success/warning/info) via Tailwind utilities
- Chart-related colors were unavailable for embeddable monitoring and dashboard components
- The gap between Console and SDK theme surfaces was undocumented, making it unclear whether the omission was intentional

## Solution

Added the 11 missing token mappings to the `@theme inline` block in `sdk/react/src/styles.css`:

- 6 status tokens: `--color-success`, `--color-success-foreground`, `--color-warning`, `--color-warning-foreground`, `--color-info`, `--color-info-foreground`
- 5 chart tokens: `--color-chart-1` through `--color-chart-5`

Deliberately excluded 7 sidebar tokens (`--color-sidebar-*`) from the SDK. Sidebar is a Console layout concern — embedded SDK components (chat widgets, execution viewers) have no sidebar. Excluding them from `@theme inline` means Tailwind won't generate sidebar utility classes in SDK components, acting as a compile-time guard enforcing the Console/SDK architectural boundary.

## Implementation Details

Single file change: `sdk/react/src/styles.css`

Status tokens placed after `--color-destructive-foreground` (grouping all semantic status colors together). Chart tokens placed after `--color-ring` (matching the grouping in `globals.css`).

The Console continues to get sidebar tokens through its own `globals.css`, which imports `@stigmer/react/styles.css` and adds sidebar mappings on top — preserving the correct layering where the Console is a superset of the SDK theme surface.

## Benefits

- SDK components can now use `bg-success`, `text-warning-foreground`, `bg-chart-1`, etc. through standard Tailwind utilities
- Theme surface is complete for all embeddable component use cases (status display, data visualization)
- Architectural boundary between Console and SDK is explicitly enforced via the deliberate sidebar exclusion

## Impact

- **SDK component authors**: Can now build components with status and chart colors
- **Platform builders**: Embeddable components will respect their theme overrides for these tokens (via `--stgm-*` custom properties or preset CSS)
- **No breaking changes**: Additive only — existing components are unaffected

## Related Work

- `2026-03-16-145326-react-style-isolation-for-embeddable-components.md` — Established the `.stgm` scoping and `@layer stgm` isolation pattern
- `2026-03-16-163628-theme-color-presets-for-stigmer-components.md` — Added theme presets that override chart tokens per preset
- Project: `_projects/2026-03/20260316.04.theme-system-gaps` — Task 1 of 6

---

**Status**: ✅ Production Ready
