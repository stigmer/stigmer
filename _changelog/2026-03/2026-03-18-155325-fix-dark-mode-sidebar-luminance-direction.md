# Fix Dark Mode Sidebar Luminance Direction

**Date**: March 18, 2026

## Summary

Fixed a directional inconsistency in the base theme's dark mode sidebar tokens where the sidebar was lighter than the background — the only theme with this behavior. All four presets (corporate, startup, friendly, fintech) had the sidebar darker than the background, following the established convention from VS Code, Discord, Linear, and Slack. The base theme now follows the same pattern.

## Problem Statement

The base dark theme had `--stgm-sidebar: oklch(0.205)` which equaled `--stgm-card: oklch(0.205)` — likely inherited from shadcn/ui defaults where the sidebar sits at the card surface level. This made the sidebar visually "pop forward" instead of receding behind the main content area.

### Pain Points

- Base dark theme sidebar (L=0.205) was lighter than background (L=0.145), a delta of +0.06 in the wrong direction
- All four presets had sidebar darker than background (deltas ranging from -0.02 to -0.04), creating an inconsistency
- After the Phase 1-3 session page redesign removed the right sidebar, the left sidebar was the only remaining sidebar — its luminance gap against the single-canvas main content area was visually jarring in dark mode

## Solution

Adjusted two dark mode sidebar token values in `sdk/theme/src/tokens.css` to invert the luminance direction, placing the sidebar below the background in the surface hierarchy.

## Implementation Details

### Token Changes (`.dark` block only)

| Token | Before | After | Rationale |
|-------|--------|-------|-----------|
| `--stgm-sidebar` | `oklch(0.205 0 0)` | `oklch(0.12 0 0)` | Delta of -0.025 from background (0.145), consistent with preset range (-0.02 to -0.04) |
| `--stgm-sidebar-accent` | `oklch(0.269 0 0)` | `oklch(0.20 0 0)` | Hover delta of +0.08 from sidebar, consistent with preset range (+0.07 to +0.09) |

### Resulting Dark Mode Surface Ladder

```
accent (0.371) > popover/muted/secondary (0.269) > card (0.205) > background (0.145) > sidebar (0.12)
```

### Tokens Left Unchanged

Six other dark mode sidebar tokens (`foreground`, `primary`, `primary-foreground`, `accent-foreground`, `border`, `ring`) were evaluated and confirmed to work correctly at the new luminance without adjustment.

## Benefits

- **Consistency**: Base theme now follows the same sidebar-darker-than-background convention as all four presets
- **Visual hierarchy**: Sidebar recedes in dark mode, main content area feels like the primary surface
- **SDK default is correct**: Platform builders using the base theme (no preset) get a properly structured dark mode sidebar out of the box
- **Zero code changes**: Only token values changed — all components already reference the correct token-based classes

## Impact

- **`@stigmer/theme`**: 2 token values changed in the `.dark` block of `tokens.css`
- **`@stigmer/react`**: Zero sidebar token usage in SDK components — no impact
- **Console layout**: 4 files use sidebar classes (`Sidebar.tsx`, `AppShell.tsx`, `UserMenu.tsx`, `OrgSwitcher.tsx`) — no code changes needed
- **Presets**: Unaffected — they override all sidebar tokens independently
- **Platform builders**: Dark mode sidebar appears darker on next build — visual improvement, not a breaking API change (token names unchanged)

## Related Work

- Part of the Session Page Single-Canvas Redesign project (Phase 4 of 4)
- Follows the base theme surface hierarchy fix from March 17 (`2026-03-17-142708-fix-base-theme-surface-hierarchy.md`)
- Completes the series: Phase 1 (remove ContextPanel), Phase 2 (decompose widgets), Phase 3 (SessionPage layout), Phase 4 (theme alignment)

---

**Status**: ✅ Production Ready
**Files Changed**: `sdk/theme/src/tokens.css`
