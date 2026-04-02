# Fix ScenarioPlayer Scroll Trap

**Date**: April 2, 2026

## Summary

Fixed a scroll-trap UX issue in the `ScenarioPlayer` engine where the IntersectionObserver reset loop prevented users from scrolling past auto-playing demo scenarios on documentation pages. The player now pauses on viewport exit and resumes on re-entry, with content always rendered to maintain stable layout height.

## Problem Statement

The `ScenarioPlayer` component — used by the Quickstart Playback and Skill Creation Tour demos embedded in docs pages — created a scroll trap that made it impossible for users to scroll past the demo to read the remaining content.

### Pain Points

- Users could not scroll past the demo on the "Your first Skill" docs page
- The page felt broken — content below the demo was unreachable during auto-play
- The demo reset from scratch every time it re-entered the viewport, losing playback progress

### Root Cause

Two behaviors combined to create a layout-shift feedback loop:

1. **Conditional rendering** — at `stepIndex === -1` (initial/reset state), children were not rendered, collapsing the container to ~40px
2. **Reset on viewport exit** — the IntersectionObserver reset `stepIndex` to `-1` on every enter and exit

The cycle: scrolling away collapsed the container → content below yanked upward → demo pulled back into viewport → auto-play re-triggered → container expanded again → user trapped.

## Solution

Changed the `ScenarioPlayer` from a reset-on-intersection model to a pause/resume model:

- **Always render content** — initial `stepIndex` starts at `0` instead of `-1`, so the first frame is always visible and the container height is always stable
- **Pause, don't reset** — scrolling out of view pauses playback at the current step; scrolling back resumes from where it left off
- **No layout shifts** — since content is always rendered, the container height never changes due to visibility changes

## Implementation Details

All changes confined to a single file: `site/src/components/docs/demos/engine/ScenarioPlayer.tsx`.

- Changed initial `stepIndex` from `-1` to `0` — first frame always rendered
- Simplified IntersectionObserver callback to `setPlaying(entry.isIntersecting)` — one line replacing the reset/toggle block
- Removed the `isStarted` concept (`stepIndex >= 0` guard) — no longer needed since `stepIndex` is always valid
- Updated replay logic to reset to step `0` instead of `-1`
- Simplified button disabled states and caption derivation

**Lines changed**: -22 / +14 (net reduction of 8 lines)

## Benefits

- Users can freely scroll past demos without any interference
- Demos show a meaningful first frame on page load (poster state) instead of a blank void
- Scrolling away preserves playback progress — returning picks up where it left off
- Simpler code with fewer state branches and no sentinel value (`-1`)

## Impact

- **ScenarioPlayer engine** — behavioral change, public API unchanged
- **QuickstartPlayback** — works without modification (no props affected)
- **SkillCreationTour** — works without modification; step 0 now creates a natural poster state with the cursor pointing at the Library nav item
- **Future scenarios** — any new scenario using `ScenarioPlayer` inherits the fix automatically

## Related Work

- `2026-04-02-102646-session-2-scenario-player-prototype.md` — original ScenarioPlayer implementation
- `2026-04-02-161605-demo-visual-storytelling-and-quickstart-upgrade.md` — visual storytelling additions
- `2026-04-02-164409-demo-components-three-tier-architecture.md` — engine/views/scenarios reorganization

---

**Status**: ✅ Production Ready
