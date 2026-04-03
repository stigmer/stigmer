# Fix ScenarioPlayer play/pause button at end of playback

**Date**: April 3, 2026

## Summary

Fixed the ScenarioPlayer showing a "Pause" button after all steps have been played, when it should show "Play" to allow replay. Also improved scroll re-entry behavior so completed demos auto-replay when the user scrolls back into view.

## Problem Statement

The `ScenarioPlayer` component — the generic playback engine used by every timed demo on the documentation site — had a state management bug at the end of its timeline.

### Pain Points

- After all steps played, the button showed "Pause" even though nothing was advancing — confusing users into thinking the demo was stuck
- Replaying required two clicks: one to pause (no-op), one to actually play
- Scrolling away from a completed demo and scrolling back left a frozen last frame with a misleading Pause icon

## Solution

Two targeted changes to the advance effect and the IntersectionObserver callback in `ScenarioPlayer.tsx`, with zero API or prop changes.

## Implementation Details

**Change 1 — Transition `playing` to `false` on completion.** The advance `useEffect` previously had a single guard (`stepIndex >= lastIndex`) that returned early without touching `playing`. The fix splits this into an explicit branch that calls `setPlaying(false)` when the scenario reaches its final step, correctly transitioning the button from Pause to Play.

**Change 2 — Auto-replay on scroll re-entry.** Added a `stepIndexRef` so the `IntersectionObserver` callback can read the current step position without being re-created on every step change. When the element re-enters the viewport and the scenario had already completed, the observer resets `stepIndex` to 0 before setting `playing` to `true`, giving the user an automatic replay instead of a frozen last frame.

## Benefits

- Play/Pause button now accurately reflects playback state at all times
- Single-click replay after completion (previously required two clicks)
- Completed demos auto-replay when scrolled back into view — better experience for documentation readers revisiting content
- All existing playback scenarios (discover-capabilities, generate-policies, mcp-server-creation-tour, skill-creation-tour, tool-calls, session-memory, quickstart, approval-flow) benefit automatically

## Impact

- **One file changed:** `site/src/components/docs/demos/engine/ScenarioPlayer.tsx`
- No new dependencies, no API surface changes, no prop changes
- Every `ScenarioPlayer` consumer inherits the fix without modification

---

**Status**: ✅ Production Ready
