# Demo Engine Resilience, Cross-Device Consistency, and Playback Speed

**Date**: April 14, 2026

## Summary

Hardened the demo engine against cross-device visual breakage, added Playwright-based interaction validation, introduced playback speed control, and fixed a CSS scope inconsistency that caused sidebar rendering differences between demo steps. Establishes runtime validation infrastructure and a consistent visual baseline enforced by four automated checks in `validate-demos.ts`.

## Problem Statement

The demo framework had accumulated several fragilities: the animated cursor broke on iPad rotation and viewport resize, narration audio desynchronized at non-1x playback speeds, the validation script used heuristic text matching instead of runtime checks, and the `StigmerProvider` CSS scope (`stgm`) was applied inconsistently — some demo steps rendered the sidebar inside the SDK's CSS reset and others didn't, producing visible differences in line-height, font smoothing, and text wrapping.

### Pain Points

- Cursor position was stale after iPad rotation or browser resize (no `ResizeObserver`)
- Live-site cursor path did not account for CSS `zoom` on ancestors, unlike the Remotion path
- `validate-demos.ts` used a "narration count > 4" heuristic that was both imprecise and unaware of actual element visibility
- Demo shell height used the video export ceiling (460px) as the clamp maximum, inflating the shell by 60-80px on desktop
- `StigmerProvider` wrapped `AppShell` in some steps but not others, causing the sidebar to render in two different CSS contexts within the same demo
- `audio.load()` resets `playbackRate` to `defaultPlaybackRate` per the HTML spec, so every step transition silently reverted narration speed to 1x
- No playback speed control existed for users who wanted faster or slower demo playback

## Solution

Six-layer fix: cursor resilience, Playwright runtime validation, responsive shell height, consistent CSS scope, narration sync, and speed control.

## Implementation Details

### Cursor Resilience

Extracted a shared `computeCursorPosition()` function that always divides by the effective CSS zoom (`cRect.width / container.offsetWidth`). Both the Remotion and live-site code paths now use this function. Added a debounced `ResizeObserver` that recomputes cursor position when the container's dimensions change (iPad rotation, browser resize, dynamic layout shifts).

### Playwright Demo Test Suite

Created `site/e2e/demos/` with a Playwright test that loads each demo page at desktop (1280x800) and iPad Pro 11 viewports. Explicit visibility contracts declare which `data-scroll-target` or `data-cursor-target` elements must be visible at specific steps. Visibility is checked via `page.evaluate` with `getBoundingClientRect` inside the page context — avoiding Playwright's known CSS `zoom` coordinate issues entirely.

### Responsive Shell Height

Replaced the fixed `380px` fallback with `clamp(320px, 55vh, 380px)`. On desktop, `55vh` exceeds 380px so the clamp resolves to the original calibrated height. On shorter tablet viewports, it shrinks gracefully to a 320px floor. The video export path (`--demo-shell-height: 460px`) overrides the entire expression.

### Consistent CSS Scope

Added the `stgm` class directly to `AppShell`'s root element. This ensures every demo step renders the sidebar with the SDK's CSS reset (`line-height: 1.5`, font smoothing, border-box) regardless of whether `StigmerProvider` is present. Moved `StigmerProvider` inside `AppShell`'s content area in 6 scenarios where it previously wrapped the shell, reducing unnecessary DOM nesting.

### Narration Audio Sync

Fixed the desync caused by `audio.load()` resetting `playbackRate`. The `playClip` function now sets both `audio.defaultPlaybackRate` and `audio.playbackRate` before and after `load()`. A `playbackRateRef` ensures effects that fire on step transitions always apply the latest speed. Step advancement timers read the rate from a ref (not the dependency array) so mid-step speed changes don't restart timers and cause desync.

### Playback Speed Control

Added `playbackRate` state to `ScenarioPlayer` with a YouTube-style popover menu (0.5x / 1x / 1.5x / 2x). Step advancement `setTimeout` delays are divided by the rate, and `useNarrationPlayback` sets the audio element's native `playbackRate` for synchronized narration. The `useStepInteractions` hook also scales its browser-path timeouts. Speed control is visible by default in the player control bar and hidden in video export mode.

### Validation Enforcement

Expanded `validate-demos.ts` with two new checks:

| Check | What it validates |
|-------|-------------------|
| `shell-height-tokens` | View files do not reference `DEMO_VIDEO_SHELL_HEIGHT` or `DEMO_SHELL_HEIGHT_MAX` as the clamp ceiling |
| `appshell-stgm-scope` | `AppShell.tsx` root element includes the `stgm` CSS class |

Removed the heuristic `checkInteractionCoverage` function. Interaction coverage is now validated by the Playwright suite.

## Benefits

- Demo cursor survives iPad rotation, browser resize, and ancestor zoom changes
- Sidebar renders identically across all steps in every demo — no more line-height or text-wrapping differences
- Narration audio stays synchronized at any playback speed, including mid-step speed changes
- Users can watch demos at 0.5x to 2x speed with a YouTube-familiar popover selector
- Playwright tests validate real browser rendering at multiple viewports instead of heuristic text matching
- Four automated checks prevent regression of shell height, CSS scope, token usage, and manifest alignment

## Impact

- **All 25 demo scenarios** — consistent sidebar rendering via `stgm` scope on `AppShell`
- **6 scenarios fixed** — `StigmerProvider` moved inside `AppShell` content area (marketplace-connect-tour, connect-tools-tour, oauth-connect-flow, create-agent-tour, byoa-setup, connect-playback)
- **Demo engine** — cursor, narration, step advancement, and progress bar all handle playback speed correctly
- **Tablet users** — responsive shell height and cursor recomputation on resize
- **`make check`** — four validation checks integrated into pre-commit workflow
- **Future demo authors** — Playwright test fixtures document visibility expectations per step

## Related Work

- `_changelog/2026-04/2026-04-13-211043-demo-visual-consistency.md`: Original visual consistency pass (pixel font sizes, interaction wiring, token compliance)
- `_changelog/2026-04/2026-04-09-195939-video-style-demo-player-redesign.md`: ScenarioPlayer video-style controls
- `_changelog/2026-04/2026-04-03-151559-scenario-player-audio-narration-engine.md`: Original narration engine

---

**Status**: ✅ Production Ready
**Files changed**: 19 modified, 8 new (Playwright config, test suite, fixture files)
