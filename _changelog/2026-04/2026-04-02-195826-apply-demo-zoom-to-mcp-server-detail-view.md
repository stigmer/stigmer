# Apply Demo Zoom to MCP Server Detail View

**Date**: April 2, 2026

## Summary

Applied the centralized `DEMO_CONTENT_ZOOM` (0.82) to all three demo scenarios that embed `McpServerDetailView`, fixing oversized SDK typography inside the 380px demo player viewport. Also added `overflow-y-auto` to the AppShell-based scenarios so the content-dense detail view scrolls instead of being clipped.

## Problem Statement

The `McpServerDetailView` was the only SDK component rendered in the demo system without `DEMO_CONTENT_ZOOM`. When the centralized styling tokens were introduced (see related work), every other view — ComposerView, SettingsView, SkillsListView, McpServersListView — was updated, but the three scenarios embedding `McpServerDetailView` directly were missed.

### Pain Points

- Full-size `text-sm` / `text-xs` SDK typography rendered at 1× inside the miniature demo player, visually clashing with the hand-crafted nav sidebar (text-[10px] / text-[9px])
- Content overflowed the 380px AppShell container and was silently clipped by `overflow-hidden`
- The `DEMO_DETAIL_CLASSES` wrapper inside AppShell added a redundant border/rounded-corners inside the already-chromed shell

## Solution

Imported `DEMO_CONTENT_ZOOM` from `shared/tokens.ts` and applied it to the content wrapper in all three scenarios. Replaced the inner `DEMO_DETAIL_CLASSES` container in the AppShell-based scenarios with a scrollable zoom wrapper.

## Implementation Details

### Affected files (3)

| File | Change |
|---|---|
| `discover-capabilities-playback/index.tsx` | Replaced `DEMO_DETAIL_CLASSES` div with `h-full overflow-y-auto` + `DEMO_CONTENT_ZOOM` |
| `generate-policies-playback/index.tsx` | Same as above |
| `mcp-server-detail/index.tsx` | Added `style={{ zoom: DEMO_CONTENT_ZOOM }}` to the `p-4` wrapper |

### AppShell-based scenarios (discover + generate)

- Removed the `DEMO_DETAIL_CLASSES` wrapper that added a redundant inner border
- Added `overflow-y-auto` to allow scrolling within the demo container since the detail view (header + server config + env vars + capabilities tabs) exceeds 380px even at 0.82 zoom

### Standalone scenario (mcp-server-detail)

- Applied zoom to the inner `p-4` div, preserving the outer `DEMO_DETAIL_CLASSES` border container

## Benefits

- MCP server detail demos now render at the same zoom as all other SDK content in the demo system
- Content scrolls instead of being silently clipped
- No more redundant nested border inside AppShell

## Impact

- **Connect your tools** page (`/docs/getting-started/connect-tools`): Discover Capabilities and Generate Policies demos now display proportionally
- **Standalone MCP server detail** demo: Consistent with other detail view demos

## Related Work

- [Centralize Demo Styling Tokens](2026-04-02-181623-centralize-demo-styling-tokens.md) — introduced the tokens; this change closes the gap for the missed component
- [Demo View Sizing and Fixture Polish](2026-04-02-173536-demo-view-sizing-and-fixture-polish.md) — earlier sizing work for other views

---

**Status**: ✅ Production Ready
**Timeline**: Single session
