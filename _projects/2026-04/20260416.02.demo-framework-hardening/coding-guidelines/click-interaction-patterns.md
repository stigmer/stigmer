# Coding Guideline: Click Interaction Patterns

**Created**: 2026-04-16
**Task**: T04

## Two patterns for user-click demos

The demo engine supports two ways to show a cursor clicking a UI element. Both are valid — choose the one that fits the scenario's rendering model.

### Pattern 1: `click` action (interactive rendering)

The engine moves the cursor to the target, plays the click ripple, and dispatches a real DOM click. The React component handles the click and updates its own state.

**When to use**: The step renders an SDK component (or any React component) that has a working `onClick` handler. The click triggers a visible state change within the component — a dropdown opens, a form submits, a toggle flips.

**Wiring checklist**:

1. The target element has `data-cursor-target="<id>"` (SDK components like `ApprovalCard` already expose these).
2. The component has a real handler wired to `onClick` — not `noop`.
3. The scenario tracks local state that changes when the handler fires.
4. The scenario uses `useStepInteractions` with a `click` action at the desired `atPercent`.
5. The `renderStep` function checks local state to decide what to render after the click.

**Example** (from `approval-flow-playback`):

```typescript
const INTERACTIONS: StepInteractions = {
  2: [
    { atPercent: 0.4, type: "click", target: "approve-button" },
  ],
};
```

The `approval-pending` step renders the `ApprovalCard` with a real `onApprovalSubmit` handler. When the click fires, the handler sets `approved = true`, and the step re-renders to show the completed conversation.

### Pattern 2: Three-step snapshot (static rendering)

Three separate steps with different data snapshots: (1) UI before, (2) cursor pointing at target, (3) UI after.

**When to use**: The before and after states are fundamentally different data objects that cannot be produced by clicking a button. For example, transitioning between entirely different page views or showing a resource that was created server-side.

**Wiring**: Use `cursorTargetFor(step)` in `onStepChange` to set the cursor target on the middle step. No `useStepInteractions` needed.

## Timing

The `click` action is two-phase:

1. **Phase 1** (at `atPercent`): cursor animates to the target.
2. **Phase 2** (at `atPercent` + 450ms): click ripple appears and `element.click()` fires.

The 450ms gap matches `CLICK_DELAY_MS` — the spring animation settle time. The React re-render from the click handler happens on the next frame (~16ms), so the viewer sees the ripple start just before the UI changes.

## Clearing the cursor after a click

The engine does not automatically clear the cursor after a `click` action. If the cursor should disappear after the click, add an explicit `clear-cursor` action:

```typescript
const INTERACTIONS: StepInteractions = {
  2: [
    { atPercent: 0.4, type: "click", target: "approve-button" },
    { atPercent: 0.7, type: "clear-cursor" },
  ],
};
```

## Video export

Both phases of the `click` action work in Remotion video export. The frame-driven path in `useStepInteractions` fires phase 1 when the timeline crosses `atPercent * stepDuration` and phase 2 when it crosses `atPercent * stepDuration + CLICK_DELAY_MS`. No additional wiring needed.
