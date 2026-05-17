# Build from Plan UX Flow

**Date**: May 17, 2026

## Summary

Added an inline "Implement" CTA that appears in the message thread after a Plan-mode execution completes, enabling a one-click transition from analysis to implementation. The button switches the interaction mode to Agent, pre-fills the composer with a suggested message, and focuses the textarea for immediate editing or sending.

## Problem Statement

After a Plan-mode execution completes, users must manually toggle the mode picker from "Plan" to "Agent" and decide what to type. There is no affordance guiding them through this natural workflow transition.

### Pain Points

- Mode picker stays on "Plan" after plan completion — user must manually switch
- No prompt or suggestion for what to type to begin implementation
- The Plan-to-Agent transition is the most common workflow after planning, yet it requires three separate actions (toggle mode, type message, send)

## Solution

A `PlanCompletionCard` renders as an inline thread item after the last message of a completed Plan-mode execution. Clicking "Implement" switches to Agent mode, pre-fills the composer with "Implement the plan above", and focuses the textarea. The user can edit the message or hit Enter immediately.

## Implementation Details

- **`SessionComposerHandle`** — new imperative API on `SessionComposer` via `forwardRef` + `useImperativeHandle`, exposing `setMessage()` and `focus()` for programmatic composer interaction
- **`PlanCompletionCard`** — new SDK component in `sdk/react/src/execution/`, renders "Plan complete — ready to implement?" with an "Implement" CTA button; opt-in via `onImplement` prop (renders nothing when omitted)
- **`plan-completion` ThreadItem variant** — new discriminated union member in `buildThreadItems`, emitted when the last execution is `EXECUTION_COMPLETED` with `InteractionMode.PLAN`
- **`onBuildFromPlan` callback** — new optional prop on `MessageThread`, threaded through `NonVirtualizedThread`, `VirtualizedThread`, and `ThreadItemRenderer`
- **Client app wiring** — both web and desktop `SessionPage` wire `composerRef`, `handleBuildFromPlan`, and pass `onBuildFromPlan` to `MessageThread` (DD-016 parity)
- **14 unit tests** — 8 for `buildThreadItems` plan-completion logic (positive and negative cases), 6 for `PlanCompletionCard` rendering, click handling, disabled state, and accessibility

## Benefits

- Reduces Plan-to-Agent transition from 3 actions (toggle + type + send) to 2 (click Implement + Enter)
- Pre-filled message eliminates "what do I type?" friction
- Composer focus means the user can immediately edit or send
- `SessionComposerHandle` is a general-purpose capability useful for future features (template actions, deep links, "try this example" buttons)

## Impact

- **SDK consumers**: New optional `onBuildFromPlan` prop on `MessageThread` and optional `ref` on `SessionComposer` — fully backward compatible
- **Platform builders**: `SessionComposerHandle` enables programmatic composer interaction for custom UX flows
- **End users**: Smoother Plan-to-Agent workflow with visual guidance

## Related Work

- Phase 4: Plan/Agent Interaction Mode (`_changelog/2026-05/2026-05-16-204605-plan-agent-interaction-mode.md`)
- Deferred: CLI `--mode=plan` flag, configurable suggested message, Plan-to-Agent auto-summarization

---

**Status**: Production Ready
**Timeline**: Single session
