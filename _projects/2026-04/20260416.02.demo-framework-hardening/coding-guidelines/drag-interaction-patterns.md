# Coding Guideline: Drag Interaction Patterns

**Created**: 2026-04-17
**Task**: T07

## When to use the `drag` action

Use the `drag` action when a demo step needs to show an element being picked up and moved to a different location — reordering list items, moving cards between columns, dragging nodes on a canvas. The cursor moves to the source element, switches to a closed-hand grab icon, animates to the destination, and releases.

**Requirements**:

1. The drag source element has `data-cursor-target="<id>"`.
2. The drag destination element has `data-cursor-target="<id>"`.
3. Both elements are `HTMLElement` instances.
4. The scenario uses `useStepInteractions` with a `drag` action at the desired `atPercent`.
5. The scenario provides `setDragging` to `useStepInteractions` and passes `isDragging` to `<Cursor>`.
6. The scenario provides `setShowRipple` to `useStepInteractions` and passes `showRipple` to `<Cursor>` (drag suppresses the click ripple during the entire gesture).

## Wiring checklist

1. Add `data-cursor-target="<source-id>"` to the drag source element.
2. Add `data-cursor-target="<dest-id>"` to the drag destination element.
3. Define the `drag` action in your `StepInteractions` map with `target` (source ID) and `dragTarget` (destination ID).
4. Add `isDragging` state and `showRipple` state to your scenario component:
   ```typescript
   const [isDragging, setIsDragging] = useState(false);
   const [showRipple, setShowRipple] = useState(true);
   ```
5. Pass both callbacks to `useStepInteractions` and both state values to `<Cursor>`:
   ```typescript
   useStepInteractions({
     stepIndex, interactions, narrationManifest,
     containerRef, setCursorTarget, steps,
     setShowRipple,
     setDragging,
   });
   // ...
   <Cursor
     target={cursorTarget}
     containerRef={containerRef}
     showRipple={showRipple}
     isDragging={isDragging}
   />
   ```
6. Verify the timing budget: `atPercent * stepDuration + CLICK_DELAY_MS + DRAG_SETTLE_MS + CLICK_DELAY_MS` must be less than the step duration. A dev-mode console warning fires if this is violated.

## Example

```typescript
export const DRAG_INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.2, type: "drag", target: "task-alpha", dragTarget: "drop-in-progress" },
  ],
};
```

At 20% of step 0's duration, the cursor moves to `[data-cursor-target="task-alpha"]`. After 450ms (cursor arrival), a `pointerdown` fires on the source and `data-dragging="true"` is set. After 200ms (settle pause), the cursor animates to `[data-cursor-target="drop-in-progress"]`. After another 450ms (cursor arrival at destination), a `pointerup` fires on the destination and `data-dragging` is removed from the source.

## Timing

The `drag` action is four-phase:

1. **Phase 1** (at `atPercent`): cursor animates to the drag source element. `showRipple` is set to `false` so no click ripple appears.
2. **Phase 2** (at `atPercent` + 450ms): `pointerdown` is dispatched on the source element, `data-dragging="true"` is set, and the `setDragging(true)` callback fires. The cursor icon switches from the pointer arrow to a closed-hand grab.
3. **Phase 3** (at `atPercent` + 450ms + 200ms): cursor animates from the source to the destination element (using the same spring animation as all other cursor movements).
4. **Phase 4** (at `atPercent` + 450ms + 200ms + 450ms): `pointerup` is dispatched on the destination element, `data-dragging` is removed from the source, `setDragging(false)` fires, and `showRipple` is restored to `true`. The cursor icon switches back to the pointer arrow.

The 450ms gaps match `CLICK_DELAY_MS` — the spring animation settle time. The 200ms gap is `DRAG_SETTLE_MS` — the brief pause that mimics a human hesitating after pressing before starting to drag.

Total duration of a `drag` action: `CLICK_DELAY_MS + DRAG_SETTLE_MS + CLICK_DELAY_MS` = 450 + 200 + 450 = **1100ms**.

## Data attribute conventions

The `drag` action uses `data-cursor-target` for **both** the source and destination — the same attribute used by all other cursor-targeting actions (`set-cursor`, `click`, `type`, `hover`). This preserves the unified targeting model. No `data-drag-source` or `data-drag-target` attributes are needed.

The engine sets `data-dragging="true"` on the source element during the drag (phases 2 through 4). This mirrors the `data-hover="true"` pattern from the `hover` action and enables CSS-based drag-state styling:

```css
.task-card[data-dragging="true"] {
  opacity: 0.5;
  transform: scale(0.95);
}
```

## Event dispatch

The engine dispatches **pointer events** — not HTML5 drag events:

- **Phase 2**: `PointerEvent("pointerdown", { bubbles: true })` on the source
- **Phase 4**: `PointerEvent("pointerup", { bubbles: true })` on the destination

Pointer events are the mechanism used by modern drag libraries (dnd-kit, react-beautiful-dnd). HTML5 drag events (`dragstart`, `dragover`, `drop`) require a `DataTransfer` object that has browser limitations when synthesized programmatically. If a future use case requires HTML5 drag events, they can be added alongside pointer events.

## Responding to drag in scenario components

Two patterns for handling the visual state change:

### Pattern 1: Callback-driven (interactive rendering)

The `setDragging` callback fires during phase 2. The scenario can react to this to update local state (e.g., dimming the source card, highlighting the drop zone). The step data doesn't change — only local component state changes.

```typescript
const handleSetDragging = useCallback((dragging: boolean) => {
  setIsDragging(dragging);
  if (dragging) {
    setDraggingItemId("task-alpha");
  } else {
    setDraggingItemId(undefined);
  }
}, []);
```

### Pattern 2: Step snapshot (data-driven rendering)

The "before drag" and "after drag" states are different step data snapshots. The drag action provides the visual cursor animation during the transition, and the next step renders the new state.

```typescript
const steps = [
  { delayMs: 0, data: { items: ["A", "B", "C"] } },     // drag fires mid-step
  { delayMs: 3000, data: { items: ["B", "A", "C"] } },   // reordered
];
```

Both patterns are valid. Use Pattern 1 when the source element should visually respond during the drag (opacity change, border highlight). Use Pattern 2 when the state change is purely positional and happens between steps.

## Clearing the cursor after drag

The engine does **not** automatically clear the cursor after the drag completes. If the cursor should disappear after the drop, add an explicit `clear-cursor` action:

```typescript
const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.2, type: "drag", target: "task-alpha", dragTarget: "drop-zone" },
    { atPercent: 0.85, type: "clear-cursor" },
  ],
};
```

## Cursor visual

During phases 2 and 3, the `Cursor` component renders a closed-hand (grabbing) icon instead of the standard pointer arrow. The `isDragging` prop controls this. The grab icon is sized to match the pointer icon so swapping between them does not cause a layout shift.

The click ripple is suppressed for the entire drag gesture — `showRipple` is set to `false` at phase 1 and restored to `true` at phase 4.

## Video export

All four phases of the `drag` action work in Remotion video export. The frame-driven path fires each phase when the timeline crosses the computed threshold. No additional wiring needed — if it works in the browser, it works in the video.

## Limitations (V1)

- **Straight-line cursor path.** The cursor moves in a straight line between source and destination using the same spring animation as all other cursor movements. A curved path for more natural drag feel is a future enhancement.
- **No `pointermove` events during drag.** The spring animation is continuous, but no intermediate `pointermove` events are dispatched during the cursor's travel from source to destination. If a future component needs continuous position updates during drag, `pointermove` dispatch can be added.
- **No multi-element drag.** Only one source/destination pair per drag action. Dragging multiple items simultaneously is not supported.
- **No HTML5 drag events.** `dragstart`, `dragover`, `drop`, `dragend` are not dispatched. Components that rely exclusively on HTML5 drag events will not respond to the synthetic drag. Use pointer event handlers or the `data-dragging` attribute.
