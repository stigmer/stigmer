# Demo Engine: Hover Interaction Action

**Date**: April 16, 2026

## Summary

Added `hover` as the sixth action type to the demo engine's `useStepInteractions` hook. The hover action moves the cursor to a target element without a click ripple, dispatches pointer and mouse enter/leave events to trigger tooltip and hover-card behavior, and toggles a `data-hover` attribute for CSS-based hover styling. Both browser playback and Remotion video export paths are fully implemented.

## Problem Statement

Some demo scenarios need to show tooltips, dropdown menus, or hover states without clicking. The cursor always ended with a click ripple, and there was no mechanism to dispatch hover-related DOM events or trigger CSS hover states programmatically.

### Pain Points

- No way to show tooltips or hover cards in demo playback
- Cursor always displayed a click ripple on arrival, even when the interaction was purely a hover
- CSS `:hover` cannot be triggered by JavaScript, leaving no path for visual hover feedback in demos
- Radix UI components (tooltips, hover cards) require pointer events that were never dispatched

## Solution

Extended the demo engine with a three-phase `hover` action that follows the same multi-phase timing architecture established by `click` (T04) and `type` (T05):

1. **Phase 1** (at `atPercent`): cursor moves to target with ripple suppressed
2. **Phase 2** (at `atPercent + CLICK_DELAY_MS`): pointer/mouse enter events dispatched, `data-hover="true"` set
3. **Phase 3** (at `atPercent + CLICK_DELAY_MS + hoverDuration`): leave events dispatched, `data-hover` removed

## Implementation Details

### Timing constant (`timing.ts`)

Added `HOVER_HOLD_MS = 1500` -- the default hold duration between enter and leave event dispatch, long enough for viewers to read a tooltip in both browser and video modes.

### Type extension (`useStepInteractions.ts`)

- Added `"hover"` to the `StepAction.type` union
- Added `hoverDuration?: number` field (defaults to `HOVER_HOLD_MS`)
- Added optional `setShowRipple?: (show: boolean) => void` callback to `UseStepInteractionsOptions`

### Cursor ripple control (`Cursor.tsx`)

- Added `showRipple?: boolean` prop (defaults to `true`)
- Gated both browser `setBrowserClicking` scheduling and video `videoClicking` computation on `showRipple`
- Fully backward-compatible: existing scenarios that don't use hover are unaffected

### Hover dispatch helpers

- `resolveHoverTarget` -- finds the `data-cursor-target` element, returns `HTMLElement` or `null` with dev warning
- `dispatchHoverEnterOnTarget` -- dispatches `pointerenter`, `pointerover`, `mouseenter`, `mouseover` and sets `data-hover="true"`
- `dispatchHoverLeaveOnTarget` -- dispatches `pointerleave`, `pointerout`, `mouseleave`, `mouseout` and removes `data-hover`

Event bubbling matches browser behavior: `enter`/`leave` don't bubble, `over`/`out` do. Events are proper `PointerEvent`/`MouseEvent` instances for Radix UI compatibility.

### Dev-mode warning

`warnIfHoverExceedsStep` fires in development when a hover action's total timing budget exceeds the step duration, following the same pattern as `warnIfTypingExceedsStep`.

### Validation

Wired hover into the `api-key-setup` scenario: step 4 now hovers over the "New API key" button before step 5 clicks it. Added `group` + `group-data-[hover=true]:opacity-80` for observable visual feedback during the hover hold phase.

## Benefits

- Demo scenarios can now show tooltips, hover cards, dropdown menus, and any hover-triggered UI
- The `data-hover` attribute pattern provides a clean bridge for CSS `:hover` styling in programmatic demos
- Optional `setShowRipple` callback preserves full backward compatibility -- zero changes required for existing scenarios
- Both browser and video export paths work identically

## Impact

- **Demo authors**: new `hover` action type available in `StepInteractions` maps
- **SDK component authors**: can adopt `[data-hover="true"]` alongside `:hover` for demo compatibility
- **Existing demos**: zero impact -- all changes are additive and backward-compatible

## Related Work

- T04: Click interaction (`_changelog/2026-04/2026-04-16-153122-demo-engine-click-interaction.md`)
- T05: Type interaction (`_changelog/2026-04/2026-04-16-162324-demo-engine-type-interaction.md`)
- T01: Fixed virtual viewport (`_changelog/2026-04/2026-04-16-143424-fix-demo-responsiveness-fixed-virtual-viewport.md`)

---

**Status**: Production Ready
**Timeline**: T06 of the Demo Framework Hardening project
