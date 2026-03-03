# Context-Cancellable Approval Flow

**Date**: March 3, 2026

## Summary

Introduced a cancellable context for the `streamToEvents` goroutine so it exits cleanly when the TUI exits, instead of leaking with its gRPC connection until process termination. All channel operations in `emitAndWaitApproval` now use `select` with `ctx.Done()`, and a reusable `trySendEvent` helper makes all event sends cancellable.

## Problem Statement

The `streamToEvents` goroutine used `context.Background()` — a context that never cancels. When the TUI exited (user pressed `q`, Ctrl+C, or the program panicked), the goroutine had no mechanism to detect this and remained blocked on either `cfg.events <- ApprovalNeededEvent{...}` or `resp := <-cfg.approvalResponses`, orphaned with its gRPC connection and associated memory.

### Pain Points

- Goroutine leaks: `emitAndWaitApproval` blocked indefinitely on channel sends/receives with no escape hatch
- No lifecycle coordination between the TUI and its background goroutine
- All event sends in the stream loop (error events, phase changes, done events) were also uncancellable, blocking if the channel buffer was full and the TUI was gone

## Solution

**Core principle: context cancellation, not timeouts.** The original plan proposed a 30-second timeout on the approval response receive and a buffer increase from 16 to 64. Both were rejected:

- **30s timeout is bad UX**: Users legitimately take minutes to review complex tool calls. Context cancellation (TUI exit) is the correct exit mechanism, not an arbitrary timer.
- **Buffer increase is a band-aid**: It reduces blocking probability without fixing the cause. With cancellable operations, buffer size is irrelevant to safety.

Instead, a cancellable context is created in both `streamAgentExecution` and `resumeSession`, cancelled immediately after `tea.NewProgram.Run()` returns. This context is shared with all follow-up goroutines via `buildFollowUpFn`.

## Implementation Details

### `run_stream.go` — cancellable context lifecycle

Replaced `context.Background()` with `context.WithCancel(context.Background())`. The `streamCancel()` is called after `p.Run()` returns — before the final execution fetch, which uses a fresh `context.Background()`. The `streamCtx` is passed to `client.Subscribe()`, `streamToEvents()`, and `buildFollowUpFn()` so all goroutines share the same cancellation signal.

### `run_session.go` — same pattern for replay sessions

Applied the identical pattern. `snapshotToEvents` doesn't need cancellation (it closes its channel after emitting all historical events), but `buildFollowUpFn` is called here too, so follow-up goroutines inherit the cancellable context.

### `run_stream_events.go` — `trySendEvent` + cancellable `emitAndWaitApproval`

Added `trySendEvent(ctx, ch, event) bool` — a context-aware channel send using `select`. Returns `false` if the context is cancelled, preventing goroutine hangs. This helper is reusable for Phase 1.3 (dead stream detection).

Changed `emitAndWaitApproval` from `func(...)` to `func(...) error`. All three channel operations now use `select` with `ctx.Done()`:
1. Event send via `trySendEvent`
2. Approval response wait via explicit `select`
3. Error event send via `trySendEvent`

Updated both call sites in `streamToEvents` (Step 3 and Step 3b) to check the returned error and exit cleanly on cancellation.

Also migrated the error-path sends (`StreamErrorEvent` on EOF/error), `PhaseChangeEvent`, and `DoneEvent` to use `trySendEvent` so they don't block when the TUI is gone.

### Tests — 6 new tests

- `TestTrySendEvent_DeliversEvent` — successful send returns true
- `TestTrySendEvent_ReturnsFalseOnCancelledContext` — cancelled context returns false without sending
- `TestTrySendEvent_UnblocksOnCancellation` — goroutine blocked on an unbuffered channel unblocks when context cancels
- `TestEmitAndWaitApproval_CancelledDuringEventSend` — returns `context.Canceled` without blocking, `promptedIDs` not updated
- `TestEmitAndWaitApproval_CancelledDuringApprovalWait` — event sent, then context cancelled during response wait, returns `context.Canceled`
- `TestEmitAndWaitApproval_EventContainsCorrectFields` — all `PendingApproval` fields correctly mapped to `ApprovalNeededEvent`

## Benefits

- Zero goroutine leaks when the TUI exits during an approval wait
- Clean shutdown path for all stream goroutines (initial + follow-ups)
- No user-facing behavioral change — the `select` paths only fire on context cancellation
- `trySendEvent` is a reusable primitive for future stream hardening (Phase 1.3)

## Impact

- **Users**: No visible change in normal operation. The fix eliminates silent resource leaks that could accumulate in long-lived CLI sessions with many follow-ups.
- **Maintainers**: Clear goroutine lifecycle contract — all stream goroutines are tied to `streamCtx` and guaranteed to exit when the TUI exits.
- **Architecture**: Establishes the pattern of context-governed goroutine lifecycles that will be extended in Phase 1.3 (dead stream detection).

## Related Work

- Phase 1.1: Defense-in-depth approval detection on resume (`2026-03-03-204258-fix-approval-not-surfaced-on-resume.md`)
- Phase 1.3 (upcoming): Dead stream connection detection — will reuse `trySendEvent` and the cancellable context pattern

---

**Status**: Production Ready
**Timeline**: 1 session
