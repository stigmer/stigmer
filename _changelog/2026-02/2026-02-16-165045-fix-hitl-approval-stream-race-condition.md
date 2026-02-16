# Fix HITL Approval Stream Race Condition and Error Handling

**Date**: February 16, 2026

## Summary

Fixed a race condition in the CLI TUI that caused "stream closed unexpectedly" errors when approving HITL requests after a delay (30-60 seconds). The root cause was two concurrent `listenForEvents` goroutines competing for events on the same Go channel. Also fixed silent discarding of approval submission errors and enhanced Python activity error logging for better diagnostics.

## Problem Statement

When a user waited 30-60 seconds before approving an HITL write tool request, the CLI displayed:

```
Approved: write
Stream closed unexpectedly
Execution failed: size_bytes
Execution failed
```

This happened non-deterministically because of a race condition introduced by duplicate event listeners.

### Pain Points

- **Non-deterministic errors**: The "stream closed unexpectedly" error appeared instead of the actual execution result, confusing users
- **Silent approval failures**: If the approval RPC failed (network error, timeout), the CLI silently continued, leaving the execution stuck in `WAITING_FOR_APPROVAL` indefinitely
- **Opaque error messages**: The Python activity error handler only captured `str(e)`, losing the exception type and traceback, making errors like "size_bytes" impossible to diagnose

## Root Cause

### Bug 1: Double `listenForEvents` Race Condition

The Bubbletea TUI event processing created two concurrent goroutines reading from the same Go channel:

1. When `handleExecutionEvent` processed the `ApprovalNeededEvent`, it returned `listenForEvents(m.cfg.Events)` as a command -- **Listener A** started blocking on `<-events`.
2. When the user pressed `a` to approve, `handleApprovalKey` returned `tea.Batch(sendCmd, listenForEvents(m.cfg.Events))` -- **Listener B** also started blocking on `<-events`.

With two goroutines reading from the same unbuffered channel, Go's runtime arbitrarily selected which goroutine received each item. When the stream goroutine sent a terminal event (`DoneEvent`) and then closed the channel:

- One listener received the event, the other received the channel-close signal
- If the close signal was processed first, the TUI showed "Stream closed unexpectedly" instead of the proper terminal event

### Bug 2: Silently Discarded Approval Errors

In `emitAndWaitApproval`, the approval submission result was discarded:

```go
_, _ = submitAgentApproval(ctx, cfg.conn, cfg.executionID, toolCallID, decision)
```

If the RPC failed, the CLI continued calling `stream.Recv()` indefinitely, waiting for updates that would never arrive because the backend never received the approval.

## Solution

### 1. Remove Duplicate Listener (`approval.go`)

Changed `handleApprovalKey` to return only `sendCmd` instead of `tea.Batch(sendCmd, listenForEvents(...))`. The existing Listener A from `handleExecutionEvent` is still alive in its Bubbletea goroutine, blocking on the events channel. After `sendCmd` delivers the approval response, the gRPC goroutine unblocks and resumes streaming -- Listener A receives the next event naturally.

**Before:**
```go
return m, tea.Batch(sendCmd, listenForEvents(m.cfg.Events))
```

**After:**
```go
return m, sendCmd
```

### 2. Handle Approval Submission Errors (`run_stream_events.go`)

Updated `emitAndWaitApproval` to check the error from `submitAgentApproval`. On failure, it logs the error and emits a `StreamErrorEvent` so the TUI displays an actionable error message to the user.

### 3. Enhanced Error Logging (`execute_graphton.py`)

Updated both error handlers in the Python activity to capture the full exception context:

- Exception type (`type(e).__name__`) is included in the error message
- Full traceback (`traceback.format_exc()`) is logged
- Error messages now include the exception class: `"Execution failed: [ValueError] size_bytes"` instead of `"Execution failed: size_bytes"`

This makes cryptic errors diagnosable from logs without needing to reproduce them.

## Benefits

- **Deterministic stream handling**: Only one goroutine reads from the events channel at any time, eliminating the race condition
- **Actionable approval errors**: Users see a clear error if approval submission fails, rather than an indefinite hang followed by stream closure
- **Diagnosable activity errors**: Exception type and traceback in logs enable root-cause analysis of cryptic errors like "size_bytes"

## Impact

### Who is Affected

- **All CLI users** who use HITL approval (the default for write operations)
- The fix is especially important when users take time to review tool calls before approving

### Changed Components

- **CLI TUI** (`approval.go`): Removed duplicate `listenForEvents` from approval key handler
- **CLI Stream Bridge** (`run_stream_events.go`): Added error handling for approval submission
- **Agent Runner** (`execute_graphton.py`): Enhanced error logging with exception type and traceback

### Verification

Three new tests added to `approval_test.go`:
- `TestApproval_Approve_CmdSendsResponseWithoutExtraListener`: Verifies the returned command sends the response without starting an extra event listener
- `TestApproval_Skip_CmdReturnsNilMsg`: Verifies skip returns a pure sendCmd (not a batch)
- `TestApproval_Reject_CmdReturnsNilMsg`: Verifies reject returns a pure sendCmd (not a batch)

All existing approval and update tests continue to pass.

---

**Status**: Production Ready
**Files Changed**: 3 source files + 1 test file
**Lines Changed**: ~80 lines of functional code and tests
