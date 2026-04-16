# Fix Demo Responsiveness — Fixed Virtual Viewport

**Date**: April 16, 2026

## Summary

Introduced `DemoViewport`, a fixed virtual viewport wrapper that renders all interactive demos at a canonical 896x380 layout and scales via CSS `zoom` to fit the available page width. This eliminates cursor and scroll misplacement at different viewport sizes — the root cause being a variable-height `clamp(320px, 55vh, 380px)` on shell views that shifted internal layout dimensions under interactions.

## Problem Statement

Demo containers used `clamp(320px, 55vh, 380px)` for height, which made internal layout dimensions change with the browser viewport. Cursor positions and scroll offsets were computed at authoring time against one container size, but when the viewport shrank (iPad split-view, small laptops, mobile), the content overflowed differently and interactions landed in wrong places.

### Pain Points

- Cursor pointed at wrong targets on short viewports (scroll position stale, layout shifted)
- `scroll-to` actions fired once via `scrollIntoView({ block: "center" })` and never re-evaluated after resize
- Cursor recomputed on resize (ResizeObserver in `Cursor.tsx`), but the scroll position it pointed at was stale
- No consistent internal coordinate system across viewport sizes

## Solution

Adopted the same fixed virtual viewport pattern that `DemoVideo.tsx` already uses for Remotion export (960x540 canonical, CSS zoom to fill). For the docs site: 896x380 canonical viewport, CSS zoom to fit available width.

Key architectural choice: CSS `zoom` (not `transform: scale()`) because it changes layout geometry, the existing `Cursor.tsx` zoom correction handles it transparently, and `DemoVideo.tsx` already uses it — proven pattern.

## Implementation Details

### New component: `DemoViewport`

`site/src/components/docs/demos/engine/DemoViewport.tsx` — wraps scenario content in a two-div structure:
- **Outer div**: `max-w-4xl mx-auto not-prose`, `ResizeObserver` watches width
- **Inner div**: fixed 896px width, `position: relative` for Cursor, CSS `zoom = min(availableWidth/896, 1)` floored at 0.5, `--demo-shell-height: 380px`

Video-export passthrough: when `isVideoExport` is true, renders a simple wrapper and defers sizing to `DemoVideo.tsx`.

### New tokens

- `DEMO_CANONICAL_WIDTH = 896` — matches Tailwind `max-w-4xl`
- `DEMO_MIN_VIEWPORT_ZOOM = 0.5` — safety floor for narrow screens

### Scenario migration

All 22 `DEMO_PLAYER_CLASSES` scenarios migrated: `<div ref={containerRef} className={DEMO_PLAYER_CLASSES}>` replaced with `<DemoViewport containerRef={containerRef}>`. Three patterns handled:
- Scenarios with `containerRef` + `useStepInteractions` + `Cursor` (13 files)
- Scenarios with `containerRef` + `Cursor` only (6 files)
- Scenarios with no ref/cursor (3 files — `containerRef` prop omitted)

### Playwright viewport expansion

Added `small-desktop` (1024x600) and `mobile` (Pixel 5) projects to `playwright.config.ts`.

## Benefits

- Cursor positions are correct at every viewport size — computed against stable 896x380 coordinate system
- Scroll targets remain visible after `scroll-to` at every viewport size
- Zero changes to `Cursor.tsx`, `scroll-utils.ts`, `useStepInteractions.ts`, all 6 shell views, or `DemoVideo.tsx`
- T02 (Resize-Aware Scroll Recovery) eliminated — the fixed viewport means scroll positions never become stale on resize

## Impact

- **22 demo scenarios** migrated to `DemoViewport`
- **75 Playwright tests** pass across desktop (1280x800), small-desktop (1024x600), and mobile (393x851)
- **DemoScope extraction** (T09): `DemoViewport` becomes part of the future DemoScope public API surface

## Related Work

- Project: `_projects/2026-04/20260416.02.demo-framework-hardening`
- Design decision: `003-fixed-virtual-viewport.md`
- Prior fix: `2026-04-15-201200-fix-demo-dialog-centering-and-testing-gaps.md`

---

**Status**: Production Ready
**Timeline**: Single session
