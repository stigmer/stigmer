# Video-Style Demo Player Redesign

**Date**: April 9, 2026

## Summary

Redesigned the ScenarioPlayer controls from a custom widget UX (dots, chevron arrows, separate mute toggle) to a YouTube-style video player experience. The live SDK component rendering engine is preserved — users see what feels like a polished video, but underneath it's still real React components that adapt to theme, scale to any resolution, and update automatically when the product changes.

## Problem Statement

The existing demo player on the docs site used bespoke controls that required users to learn a custom interface: tiny progress dots, small chevron arrows for prev/next, a separate mute button, and auto-play on scroll. While functional, this UX didn't match the polished, instantly-recognizable video player pattern that every user already knows.

### Pain Points

- Auto-play on scroll was aggressive for a documentation site — content started playing before the user was ready
- Audio was muted by default, hiding the narration that explains what the user is seeing
- Progress dots exposed implementation details ("5 / 5 steps") instead of showing continuous progress
- The controls felt like a custom widget rather than a familiar media player
- The progress indicator jumped in discrete chunks per step instead of moving smoothly

## Solution

Replace the controls chrome with a YouTube-inspired video player UX while keeping the live component rendering engine underneath. Three-state playback model (idle → playing → paused), poster overlay, smooth progress bar, and audio-first experience.

## Implementation Details

### New file: `site/src/components/docs/demos/engine/timeline.ts`

Extracted shared timeline computation (`computeStepTimeline`) from the Remotion-specific `site/video/lib/timeline.ts`. Returns `stepStartTimesMs[]` and `totalDurationMs` without frame/fps coupling. Both the browser ScenarioPlayer (progress bar) and Remotion video export now share this logic.

### ScenarioPlayer rewrite (`ScenarioPlayer.tsx`)

- **Three-state playback**: `idle | playing | paused` replacing the boolean `playing` + IntersectionObserver
- **Poster overlay**: Step 0 rendered live with a semi-transparent scrim and large centered play button (64px white circle, hover-to-scale)
- **Smooth 60fps progress bar**: `requestAnimationFrame` loop drives the filled track and playhead position via direct DOM refs (no React re-renders per frame). Within each step, the bar glides smoothly from the step's start to its end on the timeline
- **Playhead circle**: Small circular indicator at the current position, hidden by default, appears on hover (YouTube pattern)
- **Chapter markers**: Step boundaries rendered as subtle gaps in the progress bar (like YouTube chapter dividers), clickable to seek
- **Controls auto-hide**: Bar disappears after 3 seconds during playback, reappears on mouse movement, always visible when paused
- **Click-to-toggle**: Clicking the content area pauses/resumes (standard video behavior)
- **Audio unmuted by default**: `initialMuted` set to `false` for browser mode — narration plays immediately on first play click
- **No step counter**: Removed the "3 / 7" display that leaked implementation details
- `autoPlay` prop deprecated (kept for API compat, no-op)

### Narration playback changes (`useNarrationPlayback.ts`)

- Added `playingRef` to prevent audio from starting on mount when `initialMuted` is `false` (only plays when `playing` is true)
- Separated the `ended` event handler into a persistent effect so it survives idle→playing transitions without re-attachment gaps
- Playing-state-change effect loads clips from scratch when audio src was cleared (transitioning out of idle) vs. resuming when just paused

### Remotion timeline (`site/video/lib/timeline.ts`)

- Now delegates ms-level computation to the shared `computeStepTimeline` utility
- Retains Remotion-specific frame conversion and `AudioClip` types on top

### Zero scenario changes

All 19 scenarios with narration manifests get the new player chrome automatically through the render-prop pattern. No `index.tsx` or `steps.ts` files were modified.

## Benefits

- **Instantly familiar UX**: Every user knows how to interact with a video player — no learning curve
- **Audio-first experience**: Narration plays by default when the user clicks play, delivering the guided walkthrough as intended
- **No accidental playback**: Content stays static until the user explicitly clicks play
- **Smooth, polished feel**: 60fps progress bar movement instead of discrete step jumps
- **No implementation leaks**: Users see a continuous timeline, not "step 3 of 7"
- **Preserved live rendering**: All benefits of real SDK components (theme adaptation, resolution independence, accessibility, instant load, no video bandwidth) are maintained

## Impact

- All 19 playback/tour demo scenarios across the docs site
- Document writer workflow unchanged — same `ScenarioStep` authoring, same narration generation pipeline
- Remotion video export pipeline unchanged — still uses its own timing/controls
- No breaking changes to scenario component APIs

## Related Work

- Original ScenarioPlayer and demo framework
- Remotion video export pipeline (`site/video/`)
- Narration generation system (`site/scripts/generate-narration.ts`)

---

**Status**: ✅ Production Ready
