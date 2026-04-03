# Fix Last-Step Narration Cutoff in ScenarioPlayer

**Date**: April 3, 2026

## Summary

Fixed a timing bug in the ScenarioPlayer auto-advance engine where the final step's narration audio was immediately paused after starting. The auto-advance effect called `setPlaying(false)` synchronously on the last step, which cascaded into the narration playback hook pausing the audio in the next render cycle. All 10 demo scenarios were affected.

## Problem Statement

When testing narrated demos, the final step's narration clip started but was inaudible — it played for roughly one frame (~16ms) before being killed.

### Pain Points

- Every scenario's closing narration was silenced, cutting off the most important summary line (e.g., "Your key is ready. Copy it now — you won't see the full key again after this.")
- The bug was invisible in muted mode (default) and only surfaced when a user unmuted and let the demo play through to the end
- All 10 scenarios were affected since every one has narration on its final step

## Solution

Defer `setPlaying(false)` on the final step by the narration clip's `durationMs` when unmuted. When muted or when no narration is present, stop immediately (preserving existing behavior). Single-line logic change in the auto-advance timer effect — no changes to the narration hook, step definitions, or any other file.

## Implementation Details

In `ScenarioPlayer.tsx`, the auto-advance timer effect's `stepIndex >= lastIndex` branch now checks for an active narration clip before stopping playback:

- If unmuted with narration: sets a `setTimeout` for `durationMs`, then calls `setPlaying(false)` after the clip finishes
- If muted or no narration: calls `setPlaying(false)` immediately (unchanged)
- The timer cleanup function ensures correct behavior on mid-narration mute toggles, manual pause, or replay

## Benefits

- All 10 demo scenarios now play their final narration to completion
- Zero behavior change for muted playback or non-narrated scenarios
- Consistent timing pattern — uses the same `durationMs` source as non-final-step timing

## Impact

- **Users**: Final narration clip is now audible in all unmuted demo playbacks
- **Authors**: No changes needed to step definitions — existing narration text works as intended
- **Engine**: 1 file, ~10 lines changed, zero new types or dependencies

## Related Work

- `2026-04-03-151559-scenario-player-audio-narration-engine.md` — Phase 1: audio engine
- `2026-04-03-161342-demo-dynamic-timing-and-manifest-wiring.md` — Phase 4: timing logic where the gap originated

---

**Status**: Production Ready
**Timeline**: Single session fix
