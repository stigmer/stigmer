# Unblock Ctrl+O During Follow-up Prompt (Phase 4)

**Date**: March 5, 2026

## Summary

Extended `renderInline`'s event loop lifecycle to remain active during the follow-up prompt, enabling immediate Ctrl+O expand/collapse toggling between executions. Previously, Ctrl+O signals were buffered and deferred until the next execution started — now they trigger instant re-commit with the toggled display mode while the user continues typing.

## Problem Statement

When the user finished an execution and the follow-up prompt appeared, `renderInline`'s event loop had already exited. The `select` statement that consumes `toggleExpandCh` was no longer running, causing Ctrl+O keypresses to buffer silently in the channel and only fire when the next execution began.

### Pain Points

- Ctrl+O appeared non-responsive during the follow-up prompt (the most natural time to review output)
- Signals were not lost but deferred — a perceptible and confusing delay
- The lifecycle mismatch between the Bubbletea program (runs continuously) and the renderer's event loop (exited on DoneEvent) was architecturally dishonest: the renderer's committed content was still visually active during follow-up, but the event loop pretended it was done

## Solution

Extended `renderInline` to remain active during the follow-up phase instead of returning on DoneEvent. When `followUpEnabled` is true and the terminal event's phase is eligible, the renderer activates the Bubbletea text input and continues its event loop. The `select` keeps consuming `toggleExpandCh`, so Ctrl+O triggers re-commit immediately. The renderer returns only when the user submits or cancels the follow-up.

## Implementation Details

### New return type: `renderResult`

Replaced the `(phase, exitErr, history)` triple return with a struct that also carries `followUpInput`:

```go
type renderResult struct {
    phase         string
    exitErr       string
    history       []committedItem
    followUpInput string
}
```

### Nil-channel pattern for conditional select cases

After entering follow-up mode, Go's nil-channel semantics cleanly disable execution-phase channels:

- `cfg.events = nil` — no more execution events expected
- `cfg.subjectUpdate = nil` — subject updates are done
- `r.followUpInputCh` transitions from nil to a real channel — activates the new case

### `activateFollowUp` / `completeFollowUp` methods

Two focused methods on `inlineRenderer`:

- `activateFollowUp(phase, exitErr)`: stops spinner, flushes pending reads, stores terminal state, creates inputCh, sends `textInputStartMsg` to Bubbletea
- `completeFollowUp(input)`: on non-empty input, commits styled human message to both terminal and history; on empty, hides the prompt and returns

### Dead code removal

`promptFollowUpViaChannel` was removed entirely — the channel path is now inside `renderInline`. `promptFollowUp` was simplified to handle only legacy paths (key reader, direct writes for non-TTY).

### Test infrastructure

Introduced `followUpTestModel` — a minimal Bubbletea model that captures the `inputCh` from `textInputStartMsg` and forwards it to the test, enabling precise control over when follow-up input is submitted. This allows testing the full event loop including Ctrl+O toggles during follow-up.

## Benefits

- **Immediate Ctrl+O response**: Users can toggle expand/collapse while reviewing output at the follow-up prompt — the most natural point to want a different view
- **Architecturally honest**: The renderer's lifecycle now matches its visual activity (committed content is visible during follow-up, and the event loop reflects that)
- **Simpler follow-up flow**: Removed the external `promptFollowUpViaChannel` intermediary; the channel path is a natural part of the event loop
- **Clean nil-channel pattern**: No boolean flags or conditional logic around select cases — Go's language semantics handle it

## Impact

- **Users**: Ctrl+O now works consistently throughout the entire session, including between executions
- **Codebase**: `renderInline` returns a struct instead of three values (6 test callsites updated); `promptFollowUpViaChannel` removed; 8 new tests added
- **Architecture**: The renderer/model boundary is preserved — history, expandMode, and re-commit remain on `inlineRenderer`, not the Bubbletea model

## Related Work

- Predecessor: `_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/ctrl-o-during-follow-up-prompt.md` (now RESOLVED)
- Phase 1: Bubbletea v2 mechanical API migration
- Phase 2: Scrollback fix and follow-up prompt UX overhaul
- Phase 3: Replace custom text input with bubbles/textinput v2

---

**Status**: ✅ Production Ready
**Timeline**: Phase 4 of Bubbletea v2 upgrade project
