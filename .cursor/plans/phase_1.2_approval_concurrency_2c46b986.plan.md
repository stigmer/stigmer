---
name: Phase 1.2 Approval Concurrency
overview: Fix the goroutine lifecycle management in the approval flow by introducing a cancellable context and context-aware channel operations in `emitAndWaitApproval`. This replaces the original plan's buffer-increase and arbitrary-timeout approach with a principled context cancellation design.
todos:
  - id: stream-ctx
    content: Create cancellable context in streamAgentExecution and buildFollowUpFn (run_stream.go) — replace context.Background() with context.WithCancel, cancel after p.Run()
    status: completed
  - id: session-ctx
    content: Apply same cancellable context pattern to run_session.go for the replay+follow-up path
    status: completed
  - id: try-send-helper
    content: Add trySendEvent helper in run_stream_events.go — context-aware channel send with select
    status: completed
  - id: cancellable-approval
    content: Make emitAndWaitApproval return error, use select with ctx.Done() on all three channel operations
    status: completed
  - id: call-site-checks
    content: Update call sites in streamToEvents (Step 3 and Step 3b) to check emitAndWaitApproval error and return on cancellation
    status: completed
  - id: error-sends
    content: Make the error-path event sends in the streamToEvents main loop (EOF/error) use trySendEvent
    status: completed
  - id: tests
    content: "Add unit tests: cancelled during event send, cancelled during approval wait, happy path preserved, trySendEvent helper"
    status: completed
isProject: false
---

# Phase 1.2: Context-Cancellable Approval Flow

## Critical Analysis — Challenging the Original Plan

The original plan (T01_0_plan.md, section 1.2) describes the problem as a "deadlock" and proposes three fixes. After deep-diving into the code, I believe the diagnosis is partly inaccurate and two of the three proposed fixes are wrong. Here is my assessment:

### What the original plan proposes

1. **Increase events channel buffer from 16 to 64** — reduce deadlock probability
2. **Use `select` with `ctx.Done()` on the `ApprovalNeededEvent` send** — make cancellable
3. **Add 30s timeout on `approvalResponses` receive** — prevent permanent hang

### Where I disagree

**"Deadlock" is the wrong diagnosis.** The TUI continuously drains the events channel via `listenForEvents` (a blocking Cmd that reads one event, delivers it, then re-schedules). A temporarily full buffer resolves itself as the TUI consumes events. Both goroutines are never permanently blocked on each other — the classical requirement for a deadlock. What we actually have is a **goroutine lifecycle management failure**: the `streamToEvents` goroutine has no mechanism to exit when the TUI is gone.

**Buffer increase (16 to 64) is a band-aid.** It masks a symptom without fixing the cause. The `run_session.go` replay path already uses 256 because replay dumps an entire execution history at once — a fundamentally different workload. The streaming path produces 1-5 events per `Recv()` call. Buffer 16 is adequate for the workload. Once we make channel operations cancellable, buffer size is irrelevant to the safety properties.

**30s timeout on approval response is bad UX.** Users legitimately take minutes to review complex tool calls — reading shell commands, checking file paths, discussing with colleagues. A 30-second timeout would kill the execution because the user was *thinking*. Context cancellation (TUI exit) is the correct exit mechanism, not an arbitrary timer.

### The real problem

Looking at [run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go) line 49 and [run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go) lines 533-545:

- `context.Background()` is used — it never cancels
- `cfg.events <- ApprovalNeededEvent{...}` is a blocking send with no escape hatch
- `resp := <-cfg.approvalResponses` is a blocking receive with no escape hatch
- When the TUI exits (user presses `q`, Ctrl+C, or panic), the goroutine is orphaned with its gRPC connection and associated memory until process exit

The goroutine has **no way to know the TUI is gone**, because:

- The TUI doesn't close the events or approvalResponses channels (the goroutine owns events via `defer close`)
- No context cancellation signal exists

## Solution Design

### Core principle: context cancellation, not timeouts

Create a cancellable context that is cancelled when the TUI exits (`tea.NewProgram.Run()` returns). Use `select` with `ctx.Done()` on all channel operations in `emitAndWaitApproval`. No arbitrary timeouts.

### Changes

#### 1. `run_stream.go` — cancellable context + cleanup

`**streamAgentExecution`** (line 49): Replace `context.Background()` with a cancellable context. Cancel it after `p.Run()` returns so the goroutine cleans up. Use a separate `context.Background()` for the final execution fetch (which needs a live context).

```go
// Cancellable context for the stream goroutine lifecycle.
// Cancelled after the TUI exits so the goroutine can clean up.
streamCtx, streamCancel := context.WithCancel(context.Background())

// ...gRPC subscribe uses streamCtx...
// ...go streamToEvents(streamCtx, cfg)...

p := tea.NewProgram(model, tea.WithAltScreen())
finalModel, err := p.Run()

// TUI has exited — signal the stream goroutine to stop.
streamCancel()

// Fetch final state with a fresh context (streamCtx is now cancelled).
finalExec, err := fetchFinalExecution(context.Background(), conn, latestExecID)
```

`**buildFollowUpFn**` (line 162): Pass `streamCtx` into the closure so follow-up goroutines share the same cancellable context.

#### 2. `run_session.go` — same pattern for the replay+follow-up path

Apply the same cancellable context pattern. `snapshotToEvents` doesn't need `select` (it has no blocking channel waits), but `buildFollowUpFn` is called here too, so the follow-up goroutines need the cancellable context.

#### 3. `run_stream_events.go` — make `emitAndWaitApproval` cancellable, return error

Change `emitAndWaitApproval` signature from `func(...)` to `func(...) error`. Use `select` on all three channel operations:

- **Event send**: `select { case cfg.events <- event: / case <-ctx.Done(): return ctx.Err() }`
- **Response wait**: `select { case resp = <-cfg.approvalResponses: / case <-ctx.Done(): return ctx.Err() }`
- **Error event send**: same `select` pattern

Also make the error-path sends in the main `streamToEvents` loop (lines 54, 58) context-aware, using a small helper:

```go
func trySendEvent(ctx context.Context, ch chan<- executiontui.Event, event executiontui.Event) bool {
    select {
    case ch <- event:
        return true
    case <-ctx.Done():
        return false
    }
}
```

This helper is reusable for Phase 1.3 (dead stream detection) without scattering `select` blocks everywhere.

Update the two call sites in `streamToEvents` (lines 152 and 182) to check the returned error:

```go
if err := emitAndWaitApproval(ctx, cfg, tc, pa, promptedIDs, dedupKey); err != nil {
    return // context cancelled, goroutine exits
}
```

#### 4. Tests — cancellation behavior

Add tests to [run_stream_events_test.go](client-apps/cli/cmd/stigmer/root/run_stream_events_test.go):

- **Context cancelled during event send**: Create a full events channel and a cancelled context. Verify `emitAndWaitApproval` returns `context.Canceled` without blocking.
- **Context cancelled during approval wait**: Send an `ApprovalNeededEvent` successfully, then cancel context. Verify `emitAndWaitApproval` returns `context.Canceled` without blocking on the response.
- **Happy path preserved**: Verify the approval flow works end-to-end with the new `select` pattern (event sent, response received, decision submitted).
- `**trySendEvent` helper**: Verify it returns false on cancelled context, true on successful send.

### What we are NOT changing (and why)

- **Buffer size**: Staying at 16. With cancellable operations, buffer size is not a safety concern.
- **Helper function sends** (`emitMessageEvents`, `emitToolCallStateEvents`, etc.): These do direct `events <-` sends but they are in the main loop body, not in an unbounded wait. If the buffer fills, they block temporarily until the TUI drains. If the TUI is gone, `stream.Recv()` will return error on next iteration (gRPC stream is cancelled by the same context). We introduce `trySendEvent` now for reuse; migrating the helpers to use it is scope for Phase 1.3.
- `**sendApprovalResponse` in the TUI**: This runs in Bubbletea's Cmd goroutine pool. If it blocks (unlikely — the channel buffer of 1 is almost always empty), it's a minor leak bounded to process lifetime. Not critical for this phase.

### Risk assessment

- **Low risk**: All changes are in the `streamToEvents` goroutine and its call sites. The TUI model is untouched.
- **Backward compatible**: No behavioral change in the happy path. The `select` paths only fire on context cancellation, which previously didn't exist.
- **Testable**: Each change can be unit-tested with synthetic channels and context cancellation.

## Files to modify

- `client-apps/cli/cmd/stigmer/root/run_stream.go` — cancellable context, streamCancel() after Run()
- `client-apps/cli/cmd/stigmer/root/run_stream_events.go` — `trySendEvent` helper, cancellable `emitAndWaitApproval`, call-site error checks
- `client-apps/cli/cmd/stigmer/root/run_session.go` — cancellable context for follow-up goroutines
- `client-apps/cli/cmd/stigmer/root/run_stream_events_test.go` — cancellation tests

