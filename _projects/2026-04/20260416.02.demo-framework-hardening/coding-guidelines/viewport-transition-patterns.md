# Coding Guideline: Viewport Transition Patterns

**Created**: 2026-04-17
**Task**: T08

## When to use the `viewport-transition` action

Use the `viewport-transition` action when a demo step needs to zoom into a specific region of the content — focusing on a dashboard widget, highlighting a form section, or panning across a wide layout. The engine scales and translates the content area via CSS transform to center the target element in the viewport at the specified zoom level, then animates smoothly back to the default view on reset.

**Requirements**:

1. The zoom target element has `data-cursor-target="<id>"`.
2. The scenario uses `ViewportTransformLayer` to wrap content (but NOT the `Cursor`).
3. The scenario uses `useStepInteractions` with a `viewport-transition` action at the desired `atPercent`.
4. The scenario provides `setViewportTransform` to `useStepInteractions` and passes the transform state to `ViewportTransformLayer`.

## Wiring checklist

1. Add `data-cursor-target="<id>"` to the element you want to zoom into.
2. Define the `viewport-transition` action in your `StepInteractions` map with `target` (the element to center) and optionally `viewportZoom` (scale factor, defaults to 1.5). Use `viewportReset: true` to animate back to the default view.
3. Add `viewportTransform` state to your scenario component:
   ```typescript
   const [viewportTransform, setViewportTransform] = useState<ViewportTransform>(
     VIEWPORT_TRANSFORM_IDENTITY,
   );
   ```
4. Wrap your content in `ViewportTransformLayer` and keep `Cursor` as a sibling:
   ```typescript
   <DemoViewport containerRef={containerRef}>
     <ViewportTransformLayer transform={viewportTransform}>
       <ScenarioPlayer ...>{(step) => <Content />}</ScenarioPlayer>
     </ViewportTransformLayer>
     <Cursor target={cursorTarget} containerRef={containerRef} />
   </DemoViewport>
   ```
5. Pass `setViewportTransform` to `useStepInteractions`:
   ```typescript
   useStepInteractions({
     stepIndex, interactions, narrationManifest,
     containerRef, setCursorTarget, steps,
     setViewportTransform,
   });
   ```
6. Reset the viewport in `onStepChange` when the scenario restarts (step 0):
   ```typescript
   const handleStepChange = useCallback((_step, index) => {
     setCursorTarget(undefined);
     setStepIndex(index);
     if (index === 0) {
       setViewportTransform(VIEWPORT_TRANSFORM_IDENTITY);
     }
   }, []);
   ```

## Example

```typescript
export const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.3, type: "viewport-transition", target: "chart-widget", viewportZoom: 1.8 },
    { atPercent: 0.7, type: "set-cursor", target: "data-point-3" },
  ],
  2: [
    { atPercent: 0.2, type: "viewport-transition", viewportReset: true },
  ],
};
```

At 30% of step 0's duration, the viewport zooms into `[data-cursor-target="chart-widget"]` at 1.8x magnification. At 70% (well after the zoom spring settles), the cursor targets an element inside the zoomed region. In step 2, the viewport animates back to the default view.

## Timing

The `viewport-transition` action is **single-phase**: at `atPercent`, the engine computes the transform values and calls `setViewportTransform`. Framer Motion's spring animation handles the visual transition — there are no setTimeout-driven secondary phases.

The spring parameters (`stiffness: 100`, `damping: 20`, `mass: 0.8`) produce a smooth zoom that settles in approximately `VIEWPORT_SETTLE_MS` (500ms). This is softer than the cursor spring, giving the zoom a cinematic feel rather than a snappy mechanical one.

## Cursor interactions during zoom

Cursor actions (set-cursor, click, type, hover, drag) work correctly while the content is zoomed. The `Cursor` component is a sibling of `ViewportTransformLayer`, not a child, so it is never affected by the CSS transform. Target elements inside the transform layer report their visual (post-transform) positions via `getBoundingClientRect()`, which `computeCursorPosition` uses to place the cursor correctly.

**Timing constraint**: Schedule cursor actions at least `VIEWPORT_SETTLE_MS` (500ms) after a viewport-transition. If a cursor action fires while the zoom spring is still animating, the target element's position is mid-transition and the cursor may land at an intermediate location. A dev-mode console warning fires when this constraint is violated.

```typescript
const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.1, type: "viewport-transition", target: "widget", viewportZoom: 1.5 },
    { atPercent: 0.5, type: "click", target: "widget-button" },
  ],
};
```

With a 4000ms step duration, the viewport transition fires at 400ms and the click fires at 2000ms — a 1600ms gap, well past the 500ms settle time.

## Viewport transform persistence

The viewport transform **persists across steps** until explicitly reset. This enables multi-step sequences:

1. Step N: `viewport-transition` zooms into a region
2. Step N+1: cursor interactions while still zoomed
3. Step N+2: `viewport-transition` with `viewportReset: true`

The scenario's `onStepChange` callback should reset the viewport when the scenario restarts (step 0) to prevent zoom state from leaking across playback loops.

## Custom zoom level

Override the default 1.5x zoom with `viewportZoom`:

```typescript
{ atPercent: 0.2, type: "viewport-transition", target: "tiny-icon", viewportZoom: 2.5 }
```

Higher values zoom in more. Values between 1.0 and 1.0 are technically valid but not useful (they would scale down). The engine does not clamp the value — the scenario author is responsible for choosing a zoom level that keeps the target region readable without excessive clipping.

## Pan without zoom

To pan to a different region without changing the scale, use `viewportZoom: 1`:

```typescript
{ atPercent: 0.3, type: "viewport-transition", target: "right-panel", viewportZoom: 1 }
```

This translates the content to center the target element without scaling. Useful for wide layouts where different regions need sequential attention.

## DOM structure invariant

The `ViewportTransformLayer` must wrap the demo content but **NOT** the `Cursor`:

```
DemoViewport (containerRef)
  +-- ViewportTransformLayer (overflow: hidden when zoomed)
  |     +-- motion.div (animate={{ scale, x, y }})
  |           +-- ScenarioPlayer / content
  +-- Cursor (position: absolute, z-50, OUTSIDE transform)
```

If the `Cursor` is placed inside `ViewportTransformLayer`, the cursor's absolute positioning would be in the transformed coordinate space, causing it to move with the zoom and land at incorrect positions. The dev-mode check in `Cursor.tsx` (retry/warn for missing targets) will still fire correctly because target elements are inside the same `containerRef` regardless of the transform layer.

## Overflow clipping

When `scale !== 1` (or `x !== 0` / `y !== 0`), `ViewportTransformLayer` applies `overflow: hidden` to clip content that extends beyond the viewport bounds. At the identity transform, overflow is unrestricted so portaled content (dropdowns, tooltips) is not clipped during normal playback.

## Video export

The `viewport-transition` action works in Remotion video export. The frame-driven path fires the action when the timeline crosses `atPercent * stepDuration`. Framer Motion advances its spring simulation frame-by-frame, so the zoom animation renders deterministically. No additional wiring needed — if it works in the browser, it works in the video.

## Combining with other actions

A common pattern: zoom into a region, interact with elements inside it, then zoom out:

```typescript
const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.15, type: "viewport-transition", target: "metrics-panel", viewportZoom: 1.8 },
    { atPercent: 0.55, type: "click", target: "refresh-button" },
  ],
  1: [
    { atPercent: 0.3, type: "viewport-transition", viewportReset: true },
    { atPercent: 0.7, type: "clear-cursor" },
  ],
};
```

Ensure the click's `atPercent` starts well after the viewport transition's settle time to avoid positioning issues.

## Limitations (V1)

- **Element-targeted only.** The viewport transition centers on an element identified by `data-cursor-target`. Arbitrary coordinate-based zoom (e.g., "zoom to pixel position 400, 200") is not supported. If needed, add an invisible marker element at the desired position.
- **No continuous pan.** The viewport jumps between discrete target positions. Continuous "camera tracking" that follows the cursor or scrolls smoothly across a wide layout is a future enhancement.
- **Single transform at a time.** Each `viewport-transition` action replaces the previous transform. Composing multiple zooms (e.g., zoom into a panel, then zoom further into a button within it) requires computing the combined transform — which the engine does not do. The second zoom targets the element at its original (pre-first-zoom) position.
- **Spring duration is approximate.** The `VIEWPORT_SETTLE_MS` (500ms) is an estimate based on the spring parameters. The actual settle time varies with travel distance. For large zoom changes or long translations, allow more time before subsequent cursor actions.
