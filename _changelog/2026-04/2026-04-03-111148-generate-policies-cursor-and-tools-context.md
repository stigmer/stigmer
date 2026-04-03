# Add cursor overlay and tools context step to Generate Policies demo

**Date**: April 3, 2026

## Summary

Added an animated cursor overlay and a tools-context step to the Generate Policies playback demo on the "Connect your tools" page. The demo now shows 4 steps: tools tab (so the reader sees which tools were discovered), policies tab (empty), cursor clicking Generate, and the resulting approval policy on `process_return`.

## Problem Statement

The Generate Policies demo had no cursor and jumped straight from "no policies" to "policies applied" without visual guidance or context about the tools being evaluated.

### Pain Points

- No cursor overlay — the reader had no visual cue about where to click
- Missing tools-tab context — the reader didn't see which tools were being classified before policies were generated

## Solution

Added the `Cursor` component to the playback, added a `data-cursor-target` to the Generate button in `McpServerDetailView`, and expanded the step sequence from 3 to 4 steps with a tools-tab opener.

## Implementation Details

- **`McpServerDetailView`**: Added `data-cursor-target="generate-policies-button"` on the Generate/Regenerate button in `PoliciesTabContent`
- **`steps.ts`**: Added `tools-tab` step type; expanded from 3 to 4 steps with tab-switching between tools and policies
- **`index.tsx`**: Added `Cursor` component, `containerRef`, `cursorTargetFor()` mapping, and `defaultTabFor()` to switch the initial capability tab per step; forced remount via `key={step.view}`

## Benefits

- Cursor draws the reader's eye to the Generate button
- Tools-tab opener provides context about what's being evaluated before policy generation
- Consistent with the Discover Capabilities demo pattern established in the previous change

## Impact

- **Docs site**: "Connect your tools" Getting Started page — the Generate Policies demo is now interactive and self-explanatory
- **SDK**: `McpServerDetailView` gains a cursor target on the Generate button (useful for tours and automation)

## Related Work

- 2026-04-03-110746 — Discover Capabilities cursor and credential flow (same pattern)
- 2026-04-02-195258 — Connect your tools Getting Started page

---

**Status**: ✅ Production Ready
