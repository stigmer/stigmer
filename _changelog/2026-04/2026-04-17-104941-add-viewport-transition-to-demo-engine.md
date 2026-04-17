# Add Viewport Transition (Zoom/Pan) to Demo Engine

**Date**: April 17, 2026

## Summary

Added `viewport-transition` as the eighth action type to the demo engine, enabling smooth zoom-into-region and pan-to-element camera movements in interactive demos. The implementation introduces a `ViewportTransformLayer` component that applies CSS transforms via Framer Motion, with a cursor isolation architecture that keeps cursor positioning correct through the transform layer without any changes to the existing `Cursor` component.

## Problem Statement

Dashboard and overview demos needed the ability to zoom into specific regions (e.g., a chart widget, a metric card) and pan across wide layouts. The demo engine supported user-input simulations (click, type, hover, drag) and navigation (scroll-to, set-cursor), but had no way to change the camera perspective -- the entire demo was always shown at the same scale.

### Pain Points

- Demos showing dense dashboards couldn't draw attention to specific widgets without resorting to separate full-screen step snapshots
- Wide workflow diagrams required horizontal scrolling rather than cinematic panning
- No mechanism to zoom in, interact with elements at higher magnification, and zoom back out

## Solution

Implemented viewport transition as a camera movement action in the demo engine. The action computes CSS transform values (scale + translate) to center a target element in the viewport at a specified zoom level, then animates smoothly via Framer Motion's spring physics. A new `ViewportTransformLayer` engine component isolates the transform from the cursor overlay.

## Implementation Details

### New Engine Component: `ViewportTransformLayer`

- Wraps demo content in a Framer Motion `motion.div` with `animate={{ scale, x, y }}`
- Uses `transformOrigin: "0 0"` for predictable scale + translate composition
- Applies `overflow: hidden` only when zoomed (preserves portaled content at identity)
- Soft spring parameters (`stiffness: 100, damping: 20, mass: 0.8`) for cinematic zoom feel
- Exports `ViewportTransform` interface and `VIEWPORT_TRANSFORM_IDENTITY` constant

### Cursor Isolation Architecture

The critical architectural decision: `Cursor` is a **sibling** of `ViewportTransformLayer`, not a child. CSS transforms affect `getBoundingClientRect()` return values, so target elements inside the transform layer report their visual (post-transform) positions. The cursor, positioned absolutely in the container (outside the transform), uses these visual positions directly. Zero changes to `Cursor.tsx` were needed.

### Action Integration in `useStepInteractions`

- Extended `StepAction.type` union with `"viewport-transition"`
- Added `viewportZoom` (default 1.5) and `viewportReset` fields
- Added `setViewportTransform` callback to `UseStepInteractionsOptions` (same pattern as `setShowRipple`/`setDragging`)
- Single-phase execution in both browser (setTimeout) and video (firedRef) paths
- `computeViewportTransformForTarget` helper uses the same `getBoundingClientRect` + CSS zoom correction math as `computeCursorPosition`

### Timing and Dev Warnings

- `VIEWPORT_SETTLE_MS = 500` -- expected spring settle time
- `warnIfViewportTooCloseToAction` -- cross-action warning when cursor actions fire within settle time of a viewport transition

### Validation Scenario

- `viewport-zoom-validation`: 2x2 metric dashboard that zooms into a card at 1.8x, sets cursor during zoom (verifying positioning), and resets

## Benefits

- Demo authors can now direct viewer attention via zoom/pan without fragmented step snapshots
- Cursor interactions work correctly during zoom, enabling "zoom in, click something, zoom out" sequences
- Viewport transform persists across steps for multi-step zoomed interactions
- Both browser playback and Remotion video export work identically
- Zero changes to existing scenarios -- the feature is fully opt-in via `ViewportTransformLayer` wrapper

## Impact

- **Demo authors**: New `viewport-transition` action type available in `StepInteractions`
- **Engine internals**: `StepAction` type union extended, new optional callback on `UseStepInteractionsOptions`
- **Existing scenarios**: No impact -- all 28 scenarios pass validation unchanged
- **DemoScope extraction (T09)**: `ViewportTransformLayer` becomes part of the public API surface

## Related Work

- T01: Fixed Virtual Viewport (`DemoViewport` with CSS zoom) -- the foundation this builds on
- T04-T07: Click, Type, Hover, Drag interactions -- established the action patterns followed here
- T09: DemoScope Extraction Architecture -- now unblocked (depends on T01-T08)

---

**Status**: Production Ready
**Timeline**: T08 of the Demo Framework Hardening project (20260416.02)
