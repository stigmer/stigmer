# Task T04: New Interaction — Click (UI State Trigger)

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Feature
**Depends on**: T01

## Problem

The current cursor overlay shows an animated pointer with a click ripple, but it does not trigger actual UI state changes. To show "cursor clicks a button, dropdown opens" requires three separate steps: (1) show UI before, (2) show cursor, (3) show UI after. A real `click` interaction would collapse this into a single step.

## Design

### New action type: `click`

```typescript
interface StepAction {
  atPercent: number;
  type: "scroll-to" | "set-cursor" | "clear-cursor" | "click";
  target?: string;  // data-cursor-target value
}
```

### Behavior

1. Move cursor to `[data-cursor-target="<target>"]` (reuse existing cursor positioning)
2. Wait for cursor arrival (spring animation settle — ~450ms, matching `CLICK_DELAY_MS`)
3. Show click ripple (existing behavior)
4. Dispatch a synthetic `click` event on the target element
5. The React component handles the click normally (state updates, dropdown opens, etc.)

### Implementation

1. Add `click` to the `StepAction.type` union in `useStepInteractions.ts`
2. In `executeAction`, the `click` case:
   - Calls `setCursorTarget(action.target)` (triggers cursor animation)
   - Schedules a `dispatchEvent(new MouseEvent('click', { bubbles: true }))` after cursor arrival delay
3. In `Cursor.tsx`, optionally expose a callback for "cursor arrived + clicked" so the click dispatch can be coordinated with the animation
4. Handle video export path: dispatch click synchronously after cursor position is set

### Considerations

- Synthetic clicks may not trigger React's synthetic event system in all cases. Use `element.click()` (native method) which fires through React's event delegation.
- Some SDK components may need `data-cursor-target` added to their clickable elements.
- The click should fire **after** the ripple animation starts, giving visual feedback before the UI changes.

## Success Criteria

- `click` action type works in both browser and video export modes
- Clicking a button in a demo triggers the real component's onClick handler
- The cursor animation + ripple + UI change sequence looks natural and timed correctly
- At least one existing scenario is updated to use the `click` interaction to validate the pattern
