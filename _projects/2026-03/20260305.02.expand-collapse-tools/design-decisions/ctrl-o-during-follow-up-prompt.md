# RESOLVED: Ctrl+O During Follow-up Prompt

**Status**: Resolved in Phase 4 of the Bubbletea v2 upgrade (20260305.03)

## Original Limitation

When the user was at the follow-up prompt (text input active between executions), pressing Ctrl+O did not immediately toggle expand/collapse mode. The signal was buffered in `toggleExpandCh` and deferred until the next `renderInline` call.

## Root Cause

The `renderInline` event loop — which processes `toggleExpandCh` via `select` — exited on `DoneEvent` before the follow-up prompt started. During `promptFollowUp`, no goroutine consumed `toggleExpandCh`.

## Resolution

Extended `renderInline`'s lifecycle to remain active during the follow-up phase. When `cfg.followUpEnabled` is true and the terminal event's phase is eligible, the renderer:

1. Calls `activateFollowUp()` instead of returning
2. Nils out `cfg.events` and `cfg.subjectUpdate` (disables those select cases via Go's nil-channel behavior)
3. Adds `followUpInputCh` to the select (activated by `activateFollowUp`)
4. Continues the event loop, keeping `toggleExpandCh` active

Ctrl+O during the follow-up prompt now triggers immediate re-commit. The follow-up text input is preserved across toggles.

## UX Decision

The follow-up prompt stays visible in both compact and expanded modes. Ctrl+O re-commits history in the toggled mode; Bubbletea re-renders `View()` with the preserved text input.

## Key Changes

- `renderResult` struct replaces the 3-value return from `renderInline`
- `activateFollowUp()` and `completeFollowUp()` methods on `inlineRenderer`
- `promptFollowUpViaChannel` removed (dead code — channel path handled inside `renderInline`)
- `promptFollowUp` simplified to legacy paths only (key reader, direct)
- `followUpEnabled` config flag gates the new behavior
