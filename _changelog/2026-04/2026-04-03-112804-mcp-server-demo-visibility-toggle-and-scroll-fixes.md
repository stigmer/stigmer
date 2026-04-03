# MCP Server Demo: Visibility Toggle & Cursor Scroll Fixes

**Date**: April 3, 2026

## Summary

Added the Private/Public visibility toggle to the MCP server detail demo so it matches the production web app, removed the hardcoded validation state that had no production equivalent, and fixed demo cursor scroll handling for CSS zoom compatibility.

## Problem Statement

The MCP server detail demo in the docs rendered differently from the production web app in two visible ways: it showed a green "Valid" badge (from hardcoded `validationState: valid` in the fixture) that production servers don't display, and it was missing the Private/Public visibility toggle that the production app shows.

Separately, the demo cursor engine's manual `scrollTop` arithmetic broke under CSS `zoom`, causing the cursor to position incorrectly after scrolling.

### Pain Points

- Docs demo didn't match production UI, creating confusion about which elements are real
- Hardcoded validation state in the fixture had no basis in production data
- Demo cursor mispositioned after scroll when CSS zoom was applied
- Generate Policies playback jumped directly to the Policies tab without showing the scroll and tab-click interaction

## Solution

- Pass `onVisibilityChange` to the docs `McpServerDetailView` so the interactive segmented toggle renders
- Set initial visibility to `visibility_private` and wire local state for demo interactivity
- Remove `validationState: ValidationState.valid` from the fixture
- Replace manual `scrollTop` arithmetic with native `scrollIntoView` for zoom-safe scrolling
- Add a settle delay after scroll before cursor positioning and click
- Expand the Generate Policies playback from 4 to 6 steps with explicit scroll and tab-click

## Implementation Details

- **`mcp-server-detail/index.tsx`**: Added `onVisibilityChange` prop backed by `useState`/`useCallback`, set `metadata.visibility = visibility_private`, removed `validationState` from status fixture, cleaned up `ValidationState` import.
- **`Cursor.tsx`**: Replaced `scrollIntoScrollParent` with `scrollTargetIntoView` using native `scrollIntoView({ block: "center", behavior: "smooth" })`. Added `findScrollParent` helper and `SCROLL_SETTLE_MS` delay. Page scroll is immediately restored after internal scroll to prevent demo block jump.
- **`Tabs.tsx`**: Added `data-cursor-target={tab-${tab.id}}` attribute for cursor targeting in demos.
- **`generate-policies-playback/steps.ts`**: Expanded sequence to 6 steps with `tools-overview`, `scroll-to-capabilities`, `click-policies-tab`, `no-policies`, `click-generate`, `policies-applied`.

## Benefits

- Docs demos now visually match the production web app
- Cursor scrolling works correctly regardless of CSS zoom level
- Generate Policies playback tells a clearer story with explicit scroll and tab interactions

## Impact

Documentation site demos — specifically the MCP server detail static demo and the Generate Policies playback. No production app changes.

---

**Status**: ✅ Production Ready
