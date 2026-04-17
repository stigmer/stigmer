# Demo Engine: Drag (Drag-and-Drop) Interaction Action

**Date**: April 17, 2026

## Summary

Added `drag` as the seventh action type to the demo engine's `useStepInteractions` hook. The drag action animates the cursor from a source element to a destination element with a closed-hand grab icon, dispatches pointer events (`pointerdown`/`pointerup`), and toggles a `data-dragging` attribute for CSS-based drag-state styling. Both browser playback and Remotion video export paths are fully implemented.

## Problem Statement

Workflow builder, pipeline configuration, and task board demos need to show drag-and-drop interactions -- moving nodes, reordering items, dragging cards between columns. No existing interaction type supported multi-point cursor movement with drag semantics.

### Pain Points

- No way to show drag-and-drop in demo playback
- Cursor had no "grab" visual state -- only the pointer arrow and click ripple
- No mechanism to dispatch press/release events at different DOM locations within a single action
- No `data-dragging` attribute for CSS-based drag-state feedback (e.g., dimming the source while dragging)

## Solution

Extended the demo engine with a four-phase `drag` action that follows the multi-phase timing architecture established by `click` (T04), `type` (T05), and `hover` (T06):

1. **Phase 1** (at `atPercent`): cursor moves to drag source, ripple suppressed
2. **Phase 2** (at `atPercent + CLICK_DELAY_MS`): `pointerdown` dispatched on source, `data-dragging="true"` set, cursor switches to grab icon
3. **Phase 3** (at `atPercent + CLICK_DELAY_MS + DRAG_SETTLE_MS`): cursor animates from source to destination
4. **Phase 4** (at `atPercent + CLICK_DELAY_MS + DRAG_SETTLE_MS + CLICK_DELAY_MS`): `pointerup` dispatched on destination, `data-dragging` removed, cursor restored to pointer

## Implementation Details

### Timing constant (`timing.ts`)

Added `DRAG_SETTLE_MS = 200` -- the pause between pressing at the source and starting the drag movement. Mimics the brief human hesitation after mousedown before initiating a deliberate drag gesture.

### Type extension (`useStepInteractions.ts`)

- Added `"drag"` to the `StepAction.type` union
- Added `dragTarget?: string` field for the destination element (resolves via `data-cursor-target`, same as source)
- Added optional `setDragging?: (dragging: boolean) => void` callback to `UseStepInteractionsOptions`

### Cursor drag visual (`Cursor.tsx`)

- Added `isDragging?: boolean` prop (defaults to `false`)
- When `isDragging` is true, renders `GrabCursorIcon` (closed-hand SVG) instead of `CursorIcon` (pointer arrow)
- Click ripple suppressed during entire drag gesture via `!isDragging` guard
- `GrabCursorIcon` sized to match `CursorIcon` to prevent layout shift during icon swap

### Drag dispatch helpers

- `resolveDragElement` -- finds the `data-cursor-target` element for a given target ID, returns `HTMLElement` or `null` with a dev-mode warning distinguishing "source" vs "destination"
- `dispatchDragPressOnTarget` -- dispatches `PointerEvent("pointerdown", { bubbles: true })` and sets `data-dragging="true"` on the source
- `dispatchDragReleaseOnTarget` -- dispatches `PointerEvent("pointerup", { bubbles: true })` on the destination and removes `data-dragging` from the source

### Dev-mode warning

`warnIfDragExceedsStep` fires in development when a drag action's total timing budget (1100ms minimum) exceeds the step duration, following the same pattern as `warnIfTypingExceedsStep` and `warnIfHoverExceedsStep`.

### Validation scenario

Created `drag-reorder-validation` -- a minimal two-column task board (Backlog / In Progress) where a task card is dragged from the left column to the right. Validates cursor animation, grab icon swap, `data-dragging` attribute, opacity feedback on the dragged card, and pointer event dispatch. Not registered in `SCENARIO_REGISTRY` (validation fixture, not a recordable demo).

## Key Design Decisions

1. **Pointer events, not HTML5 drag events**: Modern drag libraries (dnd-kit, react-beautiful-dnd) use pointer events. HTML5 drag events require `DataTransfer` objects with browser limitations when synthesized programmatically. Pointer events are reliably synthesizable and forward-compatible.

2. **`data-cursor-target` for both source and destination**: Rejected the original plan's proposal for separate `data-drag-source` and `data-drag-target` attributes. Preserves the unified targeting model established in T05 ("Reuse `data-cursor-target`, no new `data-type-target`").

3. **Straight-line spring animation for V1**: The original plan mentioned curved drag paths. Used the same Framer Motion spring animation as all other cursor movements. Curved paths deferred as a future enhancement.

4. **Reuse existing Cursor animation**: Phase 1 calls `setCursorTarget(source)`, Phase 3 calls `setCursorTarget(dragTarget)`. No custom animation infrastructure needed -- the existing spring handles both movements.

## Benefits

- Demo scenarios can now show drag-and-drop interactions -- the last major interaction pattern missing from the engine
- Fully backward-compatible: existing scenarios are unaffected (new fields and callbacks are optional)
- Follows established multi-phase timing architecture, making the pattern predictable for scenario authors
- Pointer event dispatch is forward-compatible with dnd-kit and other modern drag libraries
- `data-dragging` attribute enables CSS-based drag styling without JavaScript event wiring

## Impact

- **Demo engine**: 7 action types now cover the full spectrum of user interactions (scroll, cursor, click, type, hover, drag + clear-cursor)
- **Scenario authors**: Can build workflow builder, pipeline, and task board demos with realistic drag-and-drop
- **DemoScope extraction (T09)**: Drag is the last interaction type before the engine is ready for extraction as a standalone product

## Related Work

- T04: Click interaction (two-phase pattern foundation)
- T05: Type interaction (three-phase, unified `data-cursor-target`)
- T06: Hover interaction (three-phase, `showRipple`/`setShowRipple` pattern)
- T08: Viewport Transition (next task -- last interaction type before DemoScope extraction)

---

**Status**: Production Ready
**Timeline**: Single session
