---
name: Phase 1.3 Dead Stream
overview: Phase 1.3 needs a revised scope. The original plan's three main components are either already done or proven anti-patterns. The real gap is error message quality when the existing keepalive infrastructure detects a dead connection — raw gRPC internals leak to the user instead of actionable guidance.
todos:
  - id: classify-stream-error
    content: Create classifyStreamError function that translates gRPC/io errors into actionable user messages with re-attach instructions
    status: completed
  - id: session-id-config
    content: Add sessionID to streamToEventsConfig and update both call sites in run_stream.go
    status: completed
  - id: apply-translation
    content: Replace raw error wrapping in streamToEvents recv error path with classifyStreamError, log raw error at debug level
    status: completed
  - id: tui-error-rendering
    content: "Update StreamErrorEvent handler in handle_events.go: remove 'Stream error:' prefix, add follow-up reconnect hint"
    status: completed
  - id: unit-tests
    content: Write tests for classifyStreamError (all error types), session ID inclusion, and StreamErrorEvent rendering
    status: completed
isProject: false
---

# Phase 1.3: Dead Stream Connection Detection — Revised Plan

## Architectural Review: Challenging the Original Plan

The original T01 plan prescribes three components for Phase 1.3. After reading the codebase, **all three need to be challenged**:

### 1. "Add gRPC keepalive (10s/5s)" — Already Done

`[client-apps/cli/internal/cli/backend/client.go](client-apps/cli/internal/cli/backend/client.go)` lines 129-144 already configures keepalive:

```go
opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
    Time:                30 * time.Second,
    Timeout:             10 * time.Second,
    PermitWithoutStream: false,
}))
```

When the server stops responding to HTTP/2 PINGs, the transport closes the connection within ~40s, `stream.Recv()` returns an error, and the CLI handles it via `StreamErrorEvent`. This is correct and working.

The original plan's 10s/5s values would be too aggressive — 10s is barely enough for a single round trip on a slow network, and risks false positives.

### 2. "60s inactivity timeout on stream.Recv()" — Anti-Pattern

The comment on the keepalive config explicitly documents this:

> *"This replaces the previous application-level 'connection stale' heuristic that falsely triggered during normal LLM thinking pauses (no events != broken connection)."*

An application-level timeout on `stream.Recv()` cannot distinguish between "server is dead" and "LLM is thinking for 90 seconds on a complex reasoning chain." This was already tried, caused false positives, and was removed in favor of transport-level keepalive.

**Recommendation: Do NOT add this.**

### 3. "30s stale connection warning in TUI footer" — Same Anti-Pattern

Showing "connection may be stale" after 30s of silence during `in_progress` would trigger during every non-trivial LLM inference. The user would learn to ignore it, defeating the purpose. Worse, it would create anxiety ("Is my connection broken?") when nothing is wrong.

The existing "Thinking..." indicator (2s idle threshold) already communicates that the agent is processing. A stale-connection warning on top of that contradicts the thinking indicator's message.

**Recommendation: Do NOT add this.**

---

## The Actual Gap

The detection infrastructure works. The **UX quality** of the response when detection triggers is the gap.

### Current UX on disconnect (broken)

When keepalive detects a dead server:

1. `stream.Recv()` returns a gRPC transport error
2. The error is wrapped: `errors.Wrap(err, "execution stream error")`
3. The TUI renders: **"Stream error: execution stream error: rpc error: code = Unavailable desc = connection closed before server preface received"**
4. No re-attach instructions. No guidance on what happened or what to do.

This violates the CLI/TUI UX mandate: *"Every error must be caught and 'translated' into a human-actionable message: What happened, Why it happened, and How to fix it."*

### Target UX on disconnect

The TUI should render something like:

```
Connection to server lost.
Re-attach to this session: stigmer run <session-id>
```

If `FollowUpFn` is available (conversational mode), the input activates and a hint appears:

```
Connection to server lost. You can send a follow-up to reconnect,
or re-attach later: stigmer run <session-id>
```

---

## Revised Scope

### Task 1: Stream error translation function

Create a `classifyStreamError` function in `[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` that translates raw gRPC/io errors into actionable messages.

Classification logic:

- `io.EOF` -> "Server closed the connection unexpectedly"
- gRPC `Unavailable` -> "Connection to server lost"
- gRPC `Canceled` + `ctx.Err() == nil` -> "Server cancelled the stream"
- gRPC `DeadlineExceeded` -> "Server response timed out"
- Other gRPC errors -> "Stream error: " + status message (without raw code prefix)
- Non-gRPC errors -> "Unexpected stream error: " + err.Error()

Each classification returns a user-facing message. The raw error is preserved for debug logging.

### Task 2: Add `sessionID` to `streamToEventsConfig`

Add a `sessionID string` field to `streamToEventsConfig` so the error translation function can include re-attach instructions:

```go
type streamToEventsConfig struct {
    executionID       string
    sessionID         string  // For actionable re-attach instructions in error messages
    stream            agentexecutionv1.AgentExecutionQueryController_SubscribeClient
    events            chan<- executiontui.Event
    approvalResponses <-chan executiontui.ApprovalResponse
    conn              *grpc.ClientConn
}
```

Update both call sites in `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` (lines 114 and 203) to pass `sessionID`.

### Task 3: Apply error translation at the `stream.Recv()` error site

Replace the current raw error wrapping in `streamToEvents` (lines 64-78 of `[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)`):

**Before:**

```go
if err == io.EOF {
    trySendEvent(ctx, cfg.events, executiontui.StreamErrorEvent{
        Err: errors.New("execution stream ended unexpectedly"),
    })
} else {
    trySendEvent(ctx, cfg.events, executiontui.StreamErrorEvent{
        Err: errors.Wrap(err, "execution stream error"),
    })
}
```

**After:** Call `classifyStreamError(err, cfg.sessionID)` which returns a `*streamError` with the actionable message as `Error()` and the original as `Unwrap()`. Log the raw error at debug level for diagnostics.

### Task 4: Update TUI error rendering to use the actionable message

In `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)` lines 169-188, the `StreamErrorEvent` handler currently renders:

```go
m.blocks = append(m.blocks, newErrorBlock(
    renderErrorContent("Stream error: "+e.Err.Error()),
))
```

After Task 3, `e.Err.Error()` already returns the actionable message. But we should also:

- Remove the redundant "Stream error: " prefix (the error message is now self-descriptive)
- When `FollowUpFn` is set, append a hint to the error block: "Send a follow-up message to reconnect."
- Set `m.exitError` to the actionable message (not raw gRPC)

### Task 5: Deferred trySendEvent migration assessment

Phase 1.2 checkpoint deferred this question: *"Should helper functions (`emitMessageEvents`, `emitToolCallStateEvents`, etc.) also use `trySendEvent`?"*

**Recommendation: Do NOT migrate.** Reasoning:

- These helpers run inside the `for { stream.Recv() }` loop
- The loop already exits when `ctx.Err() != nil` (checked on every `Recv()` error)
- When `streamCancel()` fires, `stream.Recv()` returns an error within one round trip, the loop exits, and the goroutine terminates
- The window where a helper send could block (between last Recv and the send) is microseconds
- Adding `trySendEvent` to every helper would require threading return values through all call paths, adding complexity for a near-zero probability scenario

If you disagree and want defense-in-depth here regardless, I can do it — but I want your explicit sign-off because it changes the helper function signatures.

### Task 6: Unit tests

- `classifyStreamError`: Test each error classification (EOF, Unavailable, Canceled, DeadlineExceeded, unknown gRPC, non-gRPC) produces the correct actionable message
- `classifyStreamError` with session ID: Verify re-attach instructions include the session ID
- Integration-style: Simulate a stream error in `streamToEvents` and verify the `StreamErrorEvent` carries the translated message
- Verify debug logging still captures the raw error for diagnostics

---

## What This Plan Does NOT Include (and why)


| Excluded Item                    | Reason                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| gRPC keepalive changes           | Already configured correctly at 30s/10s                                                                                  |
| Application-level recv timeout   | Anti-pattern; already tried and removed; false positives during LLM thinking                                             |
| 30s stale-connection TUI warning | Same anti-pattern; contradicts existing "Thinking..." indicator                                                          |
| `PermitWithoutStream: true`      | Between executions there's no stream to monitor; connection failures surface naturally when follow-up RPCs are attempted |
| Blanket trySendEvent migration   | Over-engineering for near-zero probability; adds complexity to all helper signatures                                     |


---

## Files Changed

- `[client-apps/cli/cmd/stigmer/root/run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` — `classifyStreamError` function, updated error handling in `streamToEvents`, `sessionID` in config
- `[client-apps/cli/cmd/stigmer/root/run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` — Pass `sessionID` to both `streamToEventsConfig` call sites
- `[client-apps/cli/pkg/executiontui/handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)` — Improved `StreamErrorEvent` rendering (remove "Stream error:" prefix, add follow-up hint)
- `[client-apps/cli/cmd/stigmer/root/run_stream_events_test.go](client-apps/cli/cmd/stigmer/root/run_stream_events_test.go)` — Unit tests for error classification

## Estimated Scope

~100-120 lines of production code, ~100-150 lines of tests. Focused, surgical change.