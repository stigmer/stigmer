# Demo Engine: Click Interaction Action Type

**Date**: April 16, 2026

## Summary

Added a `click` action type to the demo engine that moves the cursor to a target element, plays the click ripple, and dispatches a real DOM click event. This enables demos where SDK components handle their own state transitions instead of requiring the three-step snapshot pattern. The `approval-flow-playback` scenario was updated to validate the new pattern, collapsing from 5 steps to 4.

## Problem Statement

The demo engine supported three mid-step action types (`scroll-to`, `set-cursor`, `clear-cursor`), but none that could trigger real UI state changes. To show "cursor clicks a button, dropdown opens," scenario authors had to use a three-step snapshot pattern: (1) UI before the click, (2) cursor pointing at the target, (3) UI after the click. Each step required a separate data snapshot for what is conceptually a single interaction.

### Pain Points

- Three steps and three data snapshots for one conceptual action — verbose to author and maintain
- The "click" step was purely visual — cursor pointed at a button but nothing happened
- The before/after UI states had to be manually kept in sync with separate data objects
- SDK components already had `data-cursor-target` attributes and real `onClick` handlers that went unused in demos

## Solution

Implemented `click` as a two-phase mid-step action in `useStepInteractions`:

- **Phase 1** (at `atPercent`): Moves the cursor to the target element via `setCursorTarget`
- **Phase 2** (at `atPercent` + 450ms): Dispatches `element.click()` on the target after the cursor spring animation settles and the ripple appears

The native `HTMLElement.click()` fires through React's event delegation, triggering the component's `onClick` handler normally. The SDK component handles the click and updates its own state — no snapshot swapping needed.

## Implementation Details

### Engine changes

- **New file `engine/timing.ts`**: Extracted `CLICK_DELAY_MS` (450ms) from `Cursor.tsx` into a shared module. Both `Cursor.tsx` (for the ripple) and `useStepInteractions.ts` (for the click dispatch) import the same constant, keeping timing synchronized.
- **`useStepInteractions.ts`**: Extended `StepAction.type` union with `"click"`. Browser path schedules two `setTimeout` calls per click action (cursor move + click dispatch). Video/Remotion path uses two-key deduplication in `firedRef` (`click-cursor` and `click-dispatch`). New `dispatchClickOnTarget` helper queries `[data-cursor-target]` and calls `el.click()` with dev-mode warnings for missing targets.
- **`Cursor.tsx`**: Replaced local constant with import from `./timing`. No behavioral changes — the cursor continues to handle animation and ripple rendering without knowledge of click dispatch.

### Validation scenario

- **`approval-flow-playback`**: Collapsed from 5 steps to 4. The old `cursor-approve` step (purely visual cursor) was replaced by a `click` action at 40% of the `approval-pending` step. The scenario now wires a real `onApprovalSubmit` handler that sets local state, and the component re-renders to show the completed conversation within the same step.

### Coding guideline

- **`click-interaction-patterns.md`**: Documents when to use the `click` action (component has a real handler) vs. the three-step snapshot pattern (transition between fully different data snapshots). Includes timing details, wiring checklist, and video export notes.

## Benefits

- **Reduced authoring overhead**: One step with a `click` action replaces three manually synchronized steps
- **More authentic demos**: SDK components handle their own clicks, matching real product behavior
- **DemoScope-ready**: The `click` API (`{ atPercent, type: "click", target }`) is clean and intuitive for future DemoScope users who will author their own demos
- **Zero migration cost**: Existing scenarios using the three-step pattern continue to work unchanged
- **Dual-path parity**: Works identically in browser playback and Remotion video export

## Impact

- **Demo engine**: New capability available to all 22+ interactive demo scenarios
- **Scenario authors**: New pattern choice — interactive rendering with `click` or static snapshots
- **DemoScope (T09)**: The `click` action type becomes part of the DemoScope public API surface
- **T05/T06/T07**: All three dependent tasks (type, hover, drag) are now unblocked

## Related Work

- **T01: Fixed Virtual Viewport** (prerequisite) — stable coordinates for cursor positioning
- **T05-T07: Type, Hover, Drag** (unlocked by T04) — follow the same `StepAction` extension pattern
- **T09: DemoScope Extraction** — `click` is part of the engine's public API surface

---

**Status**: Production Ready
**Timeline**: Single session
