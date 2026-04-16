# Task T06: New Interaction — Hover (Tooltip Reveal)

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Feature
**Depends on**: T04

## Problem

Some demo scenarios need to show tooltips, dropdown menus, or hover states without clicking. Currently there is no way to trigger hover interactions — the cursor always ends with a click ripple.

## Design

### New action type: `hover`

```typescript
interface StepAction {
  atPercent: number;
  type: "scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type" | "hover";
  target?: string;  // data-cursor-target value
  hoverDuration?: number; // ms to hold hover (default: 1500)
}
```

### Behavior

1. Move cursor to `[data-cursor-target="<target>"]` (reuse existing positioning)
2. **No click ripple** — distinguish from click interaction
3. Dispatch `mouseenter` and `mouseover` events on the target
4. Hold cursor position for `hoverDuration` ms
5. Dispatch `mouseleave` and `mouseout` events
6. Optionally clear cursor after hover completes

### Implementation

1. Add `hover` to the `StepAction.type` union
2. In `executeAction`, the `hover` case:
   - Calls `setCursorTarget(action.target)` (no ripple flag needed — Cursor can check action type)
   - After cursor arrives, dispatches `mouseenter`/`mouseover`
   - Schedules `mouseleave`/`mouseout` after `hoverDuration`
3. In `Cursor.tsx`, add a prop or mode to suppress the click ripple for hover interactions
4. Video export: synchronous event dispatch at computed frame times

### Considerations

- CSS `:hover` pseudo-class cannot be triggered by JavaScript events. Components that rely on CSS hover need `data-hover` attribute toggling or state-based hover classes.
- Radix UI and Radix-based tooltips use `onPointerEnter`/`onPointerLeave` — dispatch `pointerenter`/`pointerleave` events too.

## Success Criteria

- `hover` moves cursor without click ripple
- Tooltips and hover menus appear when hover interaction fires
- Hover duration is configurable per action
- Works in both browser and video export modes
