# Task T07: New Interaction — Drag (Drag-and-Drop)

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Feature
**Depends on**: T04

## Problem

Workflow builder and pipeline configuration demos need to show drag-and-drop interactions — moving nodes, reordering items, connecting elements. Currently no interaction type supports multi-point cursor movement with drag semantics.

## Design

### New action type: `drag`

```typescript
interface StepAction {
  atPercent: number;
  type: "scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type" | "hover" | "drag";
  target?: string;      // data-drag-source value (start point)
  dragTarget?: string;  // data-drag-target value (end point)
}
```

### Behavior

1. Move cursor to `[data-drag-source="<target>"]`
2. Dispatch `mousedown` + `dragstart` at source position
3. Animate cursor smoothly from source to `[data-drag-target="<dragTarget>"]`
4. Dispatch `dragover` events during movement (throttled)
5. Dispatch `drop` + `dragend` + `mouseup` at destination
6. Show a subtle drag indicator on the cursor during movement (e.g., opacity shift or grab cursor icon)

### Implementation

1. Add `drag` to the `StepAction.type` union
2. Add `dragTarget` optional field to `StepAction`
3. Implement `executeDragAction`:
   - Find source and destination elements
   - Compute start and end positions via `computeCursorPosition`
   - Animate cursor between positions (use Framer Motion spring or tween)
   - Dispatch HTML5 drag events with proper `DataTransfer` objects
4. In `Cursor.tsx`, support a "dragging" visual state (different cursor icon or effect)
5. Video export: interpolate cursor position between frames, dispatch events at key frames

### Considerations

- HTML5 drag events require a `DataTransfer` object. Creating synthetic `DataTransfer` has browser limitations.
- Many React drag libraries (react-dnd, dnd-kit) use pointer events, not HTML5 drag events. We may need to dispatch both `pointer*` and `drag*` events.
- The cursor animation path between source and target should be a smooth curve, not a straight line, for natural feel.

## Success Criteria

- `drag` moves cursor from source to destination with appropriate drag events
- React drag-and-drop libraries (dnd-kit or react-dnd) respond to the synthetic events
- Visual drag indicator appears during the drag
- Works in both browser and video export modes
