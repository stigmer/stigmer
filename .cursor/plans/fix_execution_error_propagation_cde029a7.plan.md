---
name: Fix execution error propagation
overview: Fix the missing error message in "EXECUTION FAILED" CLI output by populating the `error` field on the status proto, then diagnose and fix the actual root cause of the current execution failure (likely SQLite-related) by examining runner logs.
todos:
  - id: fix-error-field
    content: Add `status_builder.current_status.error = error_message` in execute_graphton.py error handler (line ~1553) to populate the error field when status_builder exists
    status: completed
  - id: diagnose-root-cause
    content: Run stigmer server logs to examine agent-runner output for execution aex-01khe2pk8aq104zzvxmh7yv8sh and identify the actual failure (SQLite or otherwise)
    status: completed
  - id: fix-root-cause
    content: Based on log diagnosis, implement the fix for the actual execution failure -- scope TBD after diagnosis
    status: completed
isProject: false
---

# Fix Execution Error Propagation and Root Cause Failure

## Problem Analysis

Two distinct issues need to be addressed:

### Issue 1: "EXECUTION FAILED" shows no error reason

When the CLI displays the execution summary panel, it shows:

```
╭─ EXECUTION FAILED ──────────────────────────╮
│                                              │
│  Messages:    2                               │
│  Tool calls:  7                               │
│               ls x1, read x5, read_file x1   │
╰──────────────────────────────────────────────╯
```

There is no "Error:" line. The CLI code at `[run_display_summary.go:67-72](client-apps/cli/cmd/stigmer/root/run_display_summary.go)` correctly checks for and displays the error:

```go
if execution.Status.Phase == EXECUTION_FAILED &&
    execution.Status.Error != "" {
    sections = append(sections, fmt.Sprintf("Error: %s", execution.Status.Error))
}
```

But `execution.Status.Error` is empty because the agent runner never sets it.

**Root cause**: In `[execute_graphton.py:1545-1554](backend/services/agent-runner/worker/activities/execute_graphton.py)`, when the exception handler runs and `status_builder` is initialized (the common case for failures that happen after the agent starts), the code sets `phase = EXECUTION_FAILED` and appends the error to `messages[]`, but **never sets the `error` field** on the status proto:

```python
if status_builder is not None:
    status_builder.current_status.messages.append(error_msg)
    status_builder.finalize_context_info()
    status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
    # ^^^ BUG: error field is never set here
    failed_status = status_builder.current_status
```

Compare with the two other error paths which correctly set it:

- System error handler (line 230): `error=f"System error: {str(system_error)}"` - sets it correctly
- Early failure / no status_builder (line 1562-1563): `error=error_message` - sets it correctly

The proto schema (`[api.proto:60-62](apis/ai/stigmer/agentic/agentexecution/v1/api.proto)`) documents the contract: `string error = 6; // Only populated when phase == EXECUTION_FAILED`

### Issue 2: Actual execution failure root cause

The most recent execution (`aex-01khe2pk8aq104zzvxmh7yv8sh` in `_cursor/logs.md`) failed after completing 7 tool calls. Previous failures in the terminal history had clear error signatures (heartbeat timeouts, recursion limits, `memory_backend` parameter errors) and have been fixed. This current failure has a different, unknown root cause.

The user reports seeing SQLite connection issues in the runner logs. We need to examine those logs to diagnose the actual failure before implementing a fix.

## Plan

### Part 1: Fix error field propagation (surgical, low-risk)

**File**: `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`

Add a single line at line ~1553 to set the `error` field when `status_builder` exists:

```python
if status_builder is not None:
    status_builder.current_status.messages.append(error_msg)
    status_builder.finalize_context_info()
    status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
    status_builder.current_status.error = error_message  # <-- ADD THIS
    failed_status = status_builder.current_status
```

This is a one-line fix that brings the `status_builder` error path in line with the other two error paths. No architectural changes, no new patterns -- just filling in the missing field that the proto contract and all downstream consumers (CLI, API) already expect.

### Part 2: Diagnose the actual execution failure

Run `stigmer server logs` (or equivalent) to examine the agent-runner logs for execution `aex-01khe2pk8aq104zzvxmh7yv8sh`. Look for:

- The actual exception that caused the failure
- Any SQLite connection errors (`aiosqlite`, `AsyncSqliteSaver`, database locking, etc.)
- Any `CheckpointerCreationError` or database initialization failures

**Important**: I will NOT attempt to fix the root cause until we can see the actual error in the logs. Based on what we find, we will decide the appropriate fix together. The error could be:

- An aiosqlite connection issue (version compatibility, WAL mode, file locking)
- A deepagents runtime error (new issue with the 0.4.x upgrade)
- A LangGraph internal error during execution
- Something else entirely

### Part 3: Fix the root cause (after diagnosis)

After reading the runner logs and identifying the actual error, we will collaborate on the appropriate fix. This step is intentionally left open -- we need data before we can design a solution.

## Key Files

- `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` -- main execution activity with error handling (lines 1524-1615)
- `[backend/services/agent-runner/worker/checkpointer/factory.py](backend/services/agent-runner/worker/checkpointer/factory.py)` -- SQLite checkpointer lifecycle management
- `[client-apps/cli/cmd/stigmer/root/run_display_summary.go](client-apps/cli/cmd/stigmer/root/run_display_summary.go)` -- CLI error display (no changes needed here)
- `[apis/ai/stigmer/agentic/agentexecution/v1/api.proto](apis/ai/stigmer/agentic/agentexecution/v1/api.proto)` -- proto contract for `error` field (line 62)
- `[backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go](backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go)` -- server-side status merge (lines 197-198, correctly propagates non-empty error)

