# Task T08: New Interaction — Viewport Transition (Zoom/Pan)

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Feature
**Depends on**: T01

## Problem

Dashboard and overview demos need to zoom into specific regions (e.g., zoom into a chart widget, pan across a wide workflow diagram). Currently the entire demo is always shown at the same scale.

## Design

### New action type: `viewport-transition`

```typescript
interface StepAction {
  atPercent: number;
  type: "scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type" | "hover" | "drag" | "viewport-transition";
  target?: string;       // element to zoom into (data-viewport-target)
  viewportZoom?: number;  // zoom factor (default: 1.5)
  viewportReset?: boolean; // if true, resets to original viewport
}
```

### Behavior

1. Find `[data-viewport-target="<target>"]` in the container
2. Calculate the element's position relative to the container center
3. Apply CSS `transform: scale(viewportZoom) translate(dx, dy)` on the content area to center and zoom the target
4. Animate the transition smoothly (Framer Motion or CSS transition)
5. When `viewportReset` is true, animate back to `transform: none`

### Implementation

1. Add `viewport-transition` to the `StepAction.type` union
2. Add `viewportZoom` and `viewportReset` fields to `StepAction`
3. Implement `executeViewportTransition`:
   - Compute target center relative to container
   - Calculate translate values to center the target after zoom
   - Apply transform via React state (so it can be animated)
4. Create a `useViewportTransition` hook that manages the transform state
5. Wire into scenarios via a style prop on the content wrapper
6. Video export: apply transform at computed frame time

### Considerations

- CSS transforms on the content area will affect `getBoundingClientRect` for cursor calculations. `Cursor.tsx` needs to account for the viewport transform when computing positions.
- `scrollIntoView` behavior may change within a transformed container. Test thoroughly.
- The zoom should not affect the demo shell chrome (title bar, sidebar) — only the content area.

## Success Criteria

- `viewport-transition` smoothly zooms into a target region
- `viewportReset` smoothly zooms back out
- Cursor positioning remains correct during and after viewport transitions
- Works in both browser and video export modes
