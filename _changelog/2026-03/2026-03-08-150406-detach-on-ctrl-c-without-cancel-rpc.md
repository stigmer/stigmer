# Detach on Ctrl+C Without Cancelling Backend Execution

**Date**: March 8, 2026

## Summary

Changed Ctrl+C behavior in the CLI to detach from the session without sending a Cancel RPC to the backend. Previously, pressing Ctrl+C would both exit the CLI and cancel the running agent execution on the server, causing race conditions and "context canceled" errors on the Temporal workflow cancel path. Now the execution continues running and can be resumed later with `stigmer resume`.

## Problem Statement

When a user pressed Ctrl+C during an agent execution, the CLI fired a Cancel RPC to the backend in a background goroutine and then immediately tore down the gRPC stream and exited. This created two issues:

### Pain Points

- **Race condition**: The Cancel goroutine competed with connection teardown — the gRPC connection could close before the Cancel RPC completed, causing the server to receive a truncated request with a canceled context
- **Server-side errors**: The `CancelTemporalWorkflow` pipeline step failed with `context canceled` because the server propagated the (now-dead) gRPC request context to the Temporal API call
- **Contradictory UX**: The CLI printed "Resume later with: stigmer resume \<session\>" immediately before killing the execution, making the resume hint misleading

## Solution

Removed the Cancel RPC call from both Ctrl+C code paths (idle state and approval prompt). Ctrl+C now acts as a pure "detach" gesture — the CLI exits cleanly while the backend execution continues running. Users who want to actually cancel an execution use the explicit `stigmer cancel <execution-id>` command.

The Esc (interrupt) path retains the Cancel RPC since its semantic is "stop this and let me redirect the agent," which requires the current execution to actually stop.

## Implementation Details

- **`run_stream_inline.go`**: Removed `go r.cfg.cancelExecFn()` from the `cancelCh` case in the `renderInline` event loop
- **`run_stream_inline_approval_display.go`**: Removed `go r.cfg.cancelExecFn()` from `handleSessionExit` (Ctrl+C during approval prompt) and updated the doc comment
- **`run_stream_inline_approval_test.go`**: Updated `TestHandleApproval_SessionExit_CancelsAndExits` → `TestHandleApproval_SessionExit_SkipsAndExits`, removing the cancel function assertion and unused `time` import
- **`run_stream_inline_keypress.go`**: Updated `handleIdleKey` doc comment to reflect detach behavior
- **`run_stream_inline_types.go`**: Updated `cancelCh` field doc comment to describe detach semantics

## Benefits

- Eliminates the race condition between Cancel RPC and connection teardown
- Removes spurious `context canceled` errors from server logs
- Makes the "Resume later" hint actually meaningful — the execution is alive to resume
- Clear separation of concerns: Ctrl+C = detach, `stigmer cancel` = cancel, Esc = interrupt and redirect

## Impact

- **CLI users**: Ctrl+C now safely exits without killing their running agent. Long-running executions survive disconnection.
- **Server operators**: Fewer spurious error logs from race-condition cancel failures.
- **Esc behavior**: Unchanged — Esc still cancels the execution and offers a follow-up prompt.

---

**Status**: ✅ Production Ready
