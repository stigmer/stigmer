# Coding Guideline: Hover Interaction Patterns

**Created**: 2026-04-16
**Task**: T06

## When to use the `hover` action

Use the `hover` action when a demo step needs to show a tooltip, dropdown menu, hover card, or any hover-state visual change **without** clicking the element. The cursor moves to the target, dwells without a click ripple, and the engine dispatches pointer/mouse enter and leave events to trigger component hover behavior.

**Requirements**:

1. The target element has `data-cursor-target="<id>"`.
2. The target element is an `HTMLElement`.
3. The component responds to pointer events (`onPointerEnter`/`onPointerLeave`) or mouse events (`onMouseEnter`/`onMouseLeave`), or uses the `data-hover` attribute for CSS-based hover styling.
4. The scenario uses `useStepInteractions` with a `hover` action at the desired `atPercent`.
5. The scenario provides `setShowRipple` to `useStepInteractions` and passes `showRipple` to `<Cursor>`.

## Wiring checklist

1. Add `data-cursor-target="<id>"` to the hover target element.
2. Define the `hover` action in your `StepInteractions` map with `target` and optionally `hoverDuration` (ms to hold, defaults to 1500ms).
3. Add `showRipple` state to your scenario component:
   ```typescript
   const [showRipple, setShowRipple] = useState(true);
   ```
4. Pass `setShowRipple` to `useStepInteractions` and `showRipple` to `<Cursor>`:
   ```typescript
   useStepInteractions({
     stepIndex, interactions, narrationManifest,
     containerRef, setCursorTarget, steps,
     setShowRipple,
   });
   // ...
   <Cursor target={cursorTarget} containerRef={containerRef} showRipple={showRipple} />
   ```
5. Verify the timing budget: `atPercent * stepDuration + CLICK_DELAY_MS + hoverDuration` must be less than the step duration. A dev-mode console warning fires if this is violated.

## Example

```typescript
export const INTERACTIONS: StepInteractions = {
  3: [
    { atPercent: 0.2, type: "hover", target: "info-icon" },
  ],
};
```

At 20% of step 3's duration, the cursor moves to `[data-cursor-target="info-icon"]` without a click ripple. After 450ms (cursor arrival), pointer/mouse enter events fire and `data-hover="true"` is set. After 1500ms (the default hold duration), leave events fire and `data-hover` is removed.

## Timing

The `hover` action is three-phase:

1. **Phase 1** (at `atPercent`): cursor animates to the target element. `showRipple` is set to `false` so no click ripple appears.
2. **Phase 2** (at `atPercent` + 450ms): enter events are dispatched (`pointerenter`, `pointerover`, `mouseenter`, `mouseover`) and `data-hover="true"` is set on the target.
3. **Phase 3** (at `atPercent` + 450ms + `hoverDuration`): leave events are dispatched (`pointerleave`, `pointerout`, `mouseleave`, `mouseout`), `data-hover` is removed, and `showRipple` is restored to `true`.

The 450ms gap matches `CLICK_DELAY_MS` — the spring animation settle time. This ensures the cursor has visually arrived before the hover effect appears.

Total duration of a `hover` action: `CLICK_DELAY_MS + hoverDuration`. With the default 1500ms hold: 450 + 1500 = 1950ms.

## Event dispatch

The engine dispatches both pointer events and mouse events to maximize compatibility:

- **Pointer events** (`PointerEvent`): `pointerenter`/`pointerover` on enter, `pointerleave`/`pointerout` on leave. Required for Radix UI components (Tooltip, HoverCard, DropdownMenu) which listen for pointer events.
- **Mouse events** (`MouseEvent`): `mouseenter`/`mouseover` on enter, `mouseleave`/`mouseout` on leave. Required for components using `onMouseEnter`/`onMouseLeave` handlers.

`enter`/`leave` events don't bubble. `over`/`out` events do. This matches browser behavior.

## CSS `:hover` limitation

JavaScript cannot trigger CSS `:hover` pseudo-classes. Components that rely on CSS `:hover` for visual changes need the `data-hover` attribute pattern:

```css
.my-element:hover,
.my-element[data-hover="true"] {
  background: var(--hover-bg);
}
```

The engine automatically sets `data-hover="true"` during phase 2 and removes it during phase 3. This is a progressive enhancement — components work normally with real mouse hover, and the `data-hover` selector enables the same styling during programmatic hover in demos.

## Custom hover duration

Override the default 1500ms hold with `hoverDuration`:

```typescript
{ atPercent: 0.1, type: "hover", target: "tooltip-trigger", hoverDuration: 2500 }
```

Longer values keep the tooltip/hover state visible longer. The delay scales with `playbackRate` in browser mode (divided by the rate), so 2x playback makes the hold proportionally shorter.

## Clearing the cursor after hover

The engine does **not** automatically clear the cursor after the hover completes. If the cursor should disappear after the hover, add an explicit `clear-cursor` action:

```typescript
const INTERACTIONS: StepInteractions = {
  3: [
    { atPercent: 0.2, type: "hover", target: "info-icon" },
    { atPercent: 0.85, type: "clear-cursor" },
  ],
};
```

## Combining with other actions

A common pattern: hover over an element to reveal a tooltip, then click a button that appeared:

```typescript
const INTERACTIONS: StepInteractions = {
  5: [
    { atPercent: 0.1, type: "hover", target: "settings-gear", hoverDuration: 1200 },
    { atPercent: 0.7, type: "click", target: "dropdown-item" },
  ],
};
```

The `hover` action finishes (leave events fire at ~0.1 * duration + 450 + 1200), then the `click` action begins. Ensure the `click`'s `atPercent` starts after the hover's total duration to avoid overlap.

## Video export

All three phases of the `hover` action work in Remotion video export. The frame-driven path fires each phase when the timeline crosses the computed threshold. No additional wiring needed — if it works in the browser, it works in the video.

## Limitations (V1)

- **CSS `:hover` requires `data-hover` opt-in.** Components must add `[data-hover="true"]` alongside their `:hover` selectors for demo hover to produce visual changes.
- **Radix tooltip portal positioning.** Radix tooltips render in a portal outside the demo container. Inside `DemoViewport` with CSS zoom, the tooltip may appear at the wrong scale or position. Use Radix's `container` prop to render inside the viewport, or use a non-portal hover pattern for demos.
- **No hover-specific cursor visual.** The cursor arrow stays the same during hover. A subtle dwell indicator (pulse, glow) may be added in a future iteration if the static cursor feels visually dead.
