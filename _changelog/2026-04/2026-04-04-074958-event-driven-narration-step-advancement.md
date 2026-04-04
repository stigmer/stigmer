# Event-Driven Narration Step Advancement

**Date**: April 4, 2026

## Summary

Replaced the duration-based timeout approach for narration step transitions with event-driven advancement using the browser's native `ended` event. The previous fix (250ms safety buffer) was still insufficient — audio clipping persisted on both desktop and mobile because load/decode latency consumed the buffer unpredictably.

## Problem Statement

After the initial narration clipping fix (`NARRATION_SAFETY_BUFFER_MS = 250`), audio was still getting cut short at step transitions. The root cause was architectural: the auto-advance `setTimeout` and `playClip()` fire in the same React effect flush, but the browser needs time to fetch, decode, and buffer audio before it becomes audible. The timer measures wall-clock time from effect execution, not from when audio actually starts playing — so any load/decode latency directly shortens what the user hears.

### Pain Points

- The 250ms buffer was a static guess; actual load/decode latency varies by browser, CPU load, thermal state, and network conditions
- TTS `durationMs` metadata underreports actual MP3 waveform length (trailing frames, speech resonance)
- Mobile browsers amplify both issues: stricter autoplay policies, slower decode, and thermal throttling add unpredictable delays
- The fundamental design of "estimate how long to wait" is fragile — small timing errors compound across steps

## Solution

Replace timeout-based guessing with event-driven advancement: listen for the browser's native HTMLMediaElement `ended` event, which fires only when the audio waveform has genuinely finished playing.

Two coordinated changes across the playback hook and the player engine:

1. **`useNarrationPlayback` fires `onClipEnded`**: Attaches an `ended` listener to the audio element for each step's clip and forwards the event to the consumer via a callback ref.
2. **`ScenarioPlayer` waits for the event**: When narration is active, step advancement requires *both* the `ended` event to fire and the minimum `baseDelay` to elapse. A generous safety timeout (`durationMs + 2000ms`) prevents hanging if the audio element never fires `ended`.

## Implementation Details

### useNarrationPlayback.ts

- Added `onClipEnded` callback to the options interface
- Stored in a ref (`onClipEndedRef`) so the event listener never goes stale across renders
- In the step-change effect, attaches an `ended` event listener before calling `playClip()`, with proper cleanup on effect teardown

### ScenarioPlayer.tsx

- Removed `NARRATION_SAFETY_BUFFER_MS` constant (no longer needed)
- Added `pendingAdvanceRef` to hold the advance function that the `ended` callback resolves
- Added `handleClipEnded` callback that invokes `pendingAdvanceRef.current`
- Rewrote auto-advance effect with three paths:
  - **Final step with narration**: Sets `pendingAdvanceRef` to stop playback; safety timeout at `durationMs + 2000ms`
  - **Non-final step with narration**: Two-condition gate — `clipDone` (from `ended` event) AND `baseDelayDone` (from timer) must both be true before advancing; safety timeout at `max(baseDelay, durationMs) + 2000ms`
  - **No narration / muted**: Unchanged — plain `setTimeout` with `baseDelay`

## Benefits

- Narration clips play to full completion regardless of load/decode latency
- Works reliably across desktop and mobile browsers without tuning magic numbers
- No silent gaps or over-buffering — advances as soon as audio genuinely finishes
- `baseDelay` minimum is still respected for visual animation pacing
- Safety timeouts prevent indefinite hangs if audio fails to load
- Prefetch pipeline (from previous fix) still active — reduces latency, now paired with a reliable completion signal

## Impact

- All demo scenarios with narration benefit — clipping eliminated on both desktop and mobile
- Two files changed: `ScenarioPlayer.tsx` (net +35 lines), `useNarrationPlayback.ts` (+13 lines)
- Zero new dependencies, zero new types, no architectural restructuring

## Related Work

- [Fix Narration Audio Clipping at Step Transitions](2026-04-03-193059-fix-narration-audio-clipping-at-step-transitions.md) — Previous fix (timeout + buffer) that this supersedes
- [Fix Last-Step Narration Cutoff](2026-04-03-170506-fix-last-step-narration-cutoff.md) — Related final-step timing fix
- [Demo Dynamic Timing and Manifest Wiring](2026-04-03-161342-demo-dynamic-timing-and-manifest-wiring.md) — Origin of the `Math.max(baseDelay, narrationDuration)` formula
- [Scenario Player Audio Narration Engine](2026-04-03-151559-scenario-player-audio-narration-engine.md) — Phase 1 foundation

---

**Status**: ✅ Production Ready
**Timeline**: Single session
