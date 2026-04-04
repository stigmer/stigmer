# Remotion Scenario Compositions, Audio Integration, and Cursor Fix

**Date**: April 4, 2026

## Summary

Completed Phases 2 and 3 of the Remotion video export migration: all 10 demo scenarios now render as pixel-perfect Remotion compositions with frame-accurate audio synchronization. This session also introduced a `TimeSource` abstraction that bridges Remotion's frame-based rendering with ScenarioPlayer's timer-based step progression, and fixed cursor overlays for tour scenarios by compensating for CSS zoom in position calculations.

## Problem Statement

Phase 1 established the Remotion infrastructure (install, config, HelloWorld). However, the actual demo scenarios were still only renderable via the old Playwright pipeline. The core challenge was that ScenarioPlayer uses `setTimeout` to advance steps — fundamentally incompatible with Remotion's frame-by-frame rendering model where the renderer controls time.

### Pain Points

- ScenarioPlayer's `setTimeout`-based step progression doesn't fire in Remotion's render environment
- Narration audio playback via browser `<audio>` elements has no effect in Remotion's headless renderer
- Demo components render at 896×380px (docs scale) — far too small for a 1920×1080 video frame
- Cursor overlays in tour scenarios use `setTimeout` polling for target element positioning, producing no output in Remotion
- CSS zoom applied by the video composition wrapper causes `getBoundingClientRect()` to return viewport coordinates misaligned with `position: absolute` CSS coordinates

## Solution

Introduced a **TimeSource** React context that provides frame-derived `currentTimeMs` and pre-computed `stepStartTimesMs` to engine components. When active, ScenarioPlayer derives step indices mathematically from the current time instead of scheduling timers. Audio is handled by Remotion `<Audio>` components placed at frame-accurate offsets. Cursor positioning divides viewport-coordinate bounding rects by the effective CSS zoom to produce correct absolute positioning.

## Implementation Details

### New Files

| File | Purpose |
|------|---------|
| `site/src/components/docs/demos/engine/TimeSource.tsx` | React context providing `currentTimeMs` and `stepStartTimesMs`; `useTimeSource()` hook returns `null` outside Remotion |
| `site/video/compositions/DemoVideo.tsx` | Remotion composition wrapping scenario components with TimeSource + VideoExport providers, virtual viewport (960×540 @ zoom 2×), and `<Audio>` sequences |

### Modified Files

| File | Change |
|------|--------|
| `ScenarioPlayer.tsx` | Added `deriveStepFromTime()` pure function; conditionally bypasses all `setTimeout` effects and browser audio when TimeSource is active |
| `Cursor.tsx` | Added video-export `useEffect` that synchronously queries target position via `getBoundingClientRect()` with CSS zoom compensation (`cRect.width / container.offsetWidth`) |
| `Root.tsx` | Registered all 10 scenarios as `<Composition>` entries with pre-computed timelines |
| `remotion.config.ts` | Added webpack rule for ESM extensionless import resolution (`fullySpecified: false`) |
| `tokens.ts` | Added `DEMO_VIDEO_SHELL_HEIGHT = 460` for taller AppShell in video mode |
| `AppShell.tsx` | Changed height from hardcoded `DEMO_SHELL_HEIGHT` to CSS variable `var(--demo-shell-height, 380px)` |

### Key Architecture Decisions

1. **TimeSource as a context, not a prop** — Engine components (`ScenarioPlayer`, `Cursor`) detect Remotion mode by presence of context rather than explicit props. This avoids prop-drilling through scenario components and keeps scenario code untouched.

2. **Virtual viewport with CSS zoom** — Rather than redesigning components for 1920×1080, we render at 960×540 (half-resolution) and apply `zoom: 2`. This preserves exact CSS layout while producing crisp output. The ~91% fill with subtle dark framing was selected over 100% fill for professional visual balance.

3. **Zoom compensation for cursor positioning** — `getBoundingClientRect()` returns viewport coordinates (post-zoom), but `position: absolute` inside a zoomed container uses CSS coordinates (pre-zoom). The fix divides offsets by `cRect.width / container.offsetWidth`, making it robust to any zoom factor.

4. **Pre-computed timelines at module load** — `computeTimeline()` runs once per scenario at import time, producing `stepStartTimesMs`, `stepStartFrames`, `audioClips`, and `totalFrames`. No runtime cost during rendering.

## Benefits

- **Pixel-perfect video quality** — Each frame rendered as a lossless screenshot, encoded to H.264 High profile. No VP8 degradation.
- **Deterministic step progression** — Frame-accurate step transitions derived mathematically from timeline, eliminating `setTimeout` non-determinism.
- **Proper audio sync** — Narration clips placed at exact frame offsets via Remotion `<Audio>`, not browser `<audio>`.
- **Zero impact on live site** — All Remotion-specific code paths are gated behind `useTimeSource() !== null`. Scenario components remain untouched.
- **Cursor overlays work in video** — Tour scenarios show animated cursor movement with correct positioning.

## Impact

- All 10 demo scenarios can now be rendered as high-quality videos via `npx remotion render`
- Video output at `site/dist/videos/` (gitignored) — 1.5–2.9 MB per scenario
- Foundation laid for Phase 4 (programmatic render script) and Phase 5 (Playwright removal)

## Related Work

- Predecessor: [Video Export Pipeline](_changelog/2026-04/2026-04-03-173643-video-export-pipeline.md) — Playwright-based pipeline (being replaced)
- Predecessor: [Remotion Video Export Phase 1 Setup](_changelog/2026-04/2026-04-04-132652-remotion-video-export-phase-1-setup.md) — Remotion installation and HelloWorld
- Project: `_projects/2026-04/20260403.02.remotion-video-export/`

---

**Status**: ✅ Production Ready (Phases 2–3 complete; Phases 4–5 remaining)
**Timeline**: ~3 hours (composition design, sizing iteration, cursor fix)
