# Fix Narration Audio Clipping at Step Transitions

**Date**: April 3, 2026

## Summary

Fixed narration audio being cut short during step transitions in the ScenarioPlayer engine. Added a safety buffer to compensate for audio load/decode latency and TTS metadata inaccuracy, and introduced clip pre-fetching to eliminate network delays at transitions.

## Problem Statement

A colleague reported that narration audio was getting cut during step transitions. Investigation revealed two contributing factors in the timing architecture.

### Pain Points

- The auto-advance `setTimeout` and `playClip()` fire in the same React effect flush, but the browser needs time to fetch, decode, and buffer the audio before it becomes audible. This systematic offset means every clip plays ~50-150ms shorter than its `durationMs`.
- Edge TTS word-boundary metadata captures when the last word ends, not the actual end of the MP3 waveform. MP3 encoding adds trailing frames and natural speech has trailing resonance, causing `durationMs` to undercount by ~50-200ms.
- Each clip loads on-demand with `preload="none"`, meaning every step transition pays the full HTTP fetch cost before audio can start.

## Solution

Two targeted fixes in the playback engine, with no architectural changes:

1. **Narration safety buffer**: A 250ms constant added to narration-based delays, compensating for both load/decode latency and metadata inaccuracy.
2. **Clip pre-fetching**: All manifest clip URLs are fetched into the browser HTTP cache when the user unmutes (or at mount for video export), so subsequent `audio.load()` calls resolve from disk.

## Implementation Details

### ScenarioPlayer.tsx

Added `NARRATION_SAFETY_BUFFER_MS = 250` module-level constant. Applied in two branches of the auto-advance effect:

- **Non-final steps**: `Math.max(baseDelay, narrationDuration + BUFFER)` when `narrationDuration > 0`. Steps without narration use `baseDelay` unchanged.
- **Final step**: `setTimeout(() => setPlaying(false), finalNarrationMs + BUFFER)`.

### useNarrationPlayback.ts

- Added `prefetchManifestClips()` helper that iterates manifest entries and calls `fetch(src)` for each non-null clip.
- Added `prefetchedRef` boolean guard to avoid duplicate pre-fetch requests.
- **Interactive path**: Pre-fetch triggers inside `toggleMute` when the user unmutes for the first time.
- **Video export path**: A mount effect pre-fetches when `initialMuted` is false, since all clips will be needed.
- Added `manifest` to `toggleMute`'s `useCallback` dependency array.

## Benefits

- Narration clips play to completion without the tail being cut at step transitions
- Step transitions with narration are smoother — no network latency gap between clips
- No impact on muted playback or steps without narration (buffer only applies when `narrationDuration > 0`)
- Video export pipeline inherits both fixes automatically

## Impact

- All 10 demo scenarios with narration benefit
- Two files changed: `ScenarioPlayer.tsx` (+11 lines), `useNarrationPlayback.ts` (+28 lines)
- Zero new dependencies, zero new types, zero architectural changes

## Related Work

- [Scenario Player Audio Narration Engine](2026-04-03-151559-scenario-player-audio-narration-engine.md) — Phase 1 foundation
- [Fix Last-Step Narration Cutoff](2026-04-03-170506-fix-last-step-narration-cutoff.md) — Related timing fix for the final step
- [Demo Dynamic Timing and Manifest Wiring](2026-04-03-161342-demo-dynamic-timing-and-manifest-wiring.md) — The `Math.max(baseDelay, narrationDuration)` formula this fix extends

---

**Status**: ✅ Production Ready
**Timeline**: Single session
