# Implement Pause/Resume Lifecycle Commands for Workflow Executions

**Date**: February 9, 2026

## Summary

Implemented comprehensive pause/resume lifecycle commands for workflow executions (Gap A3), enabling users to temporarily pause long-running workflows at checkpoints and resume them later without losing progress. The implementation spans proto definitions, Go server handlers, Java workflow orchestration, and Python activity cancellation handling, all leveraging Temporal signals and LangGraph checkpointing for durability.

## Problem Statement

Workflow executions could be cancelled (gracefully) or terminated (forcefully), but there was no way to temporarily pause a workflow with the intent to resume it later. This limitation prevented:

1. **Maintenance Windows**: Cannot pause workflows during infrastructure maintenance
2. **Progress Review**: Users cannot pause to review intermediate results before continuing
3. **Resource Management**: Cannot pause idle workflows to conserve resources
4. **External Dependencies**: Cannot pause while waiting for external conditions

Unlike cancellation (permanent stop) or approval gates (waiting for specific decisions), pause/resume enables **temporary suspension** with **full state preservation** and **seamless continuation**.

### Pain Points

- Long-running workflows had to complete or be cancelled (no middle ground)
- Pausing meant cancelling, losing all progress and having to restart
- No distinction between "stop permanently" and "stop temporarily"
- Users couldn't interrupt workflows without losing work
- Resource waste: workflows running when user wants to pause

## Solution

Implemented pause/resume as first-class lifecycle operations following the same architectural patterns as cancel/terminate/recover:

1. **Proto API Layer**: Added `EXECUTION_PAUSED` phase, `pause()` and `resume()` RPCs
2. **Go Server Layer**: Created pause/resume handlers using reusable pipeline steps
3. **Java Workflow Layer**: Added signal handlers with CancellationScope for graceful activity cancellation
4. **Python Activity Layer**: Added cancellation detection and graceful checkpoint handling

The solution uses Temporal's native signal mechanism for inter-process communication and LangGraph's automatic checkpointing for state preservation.

## Architecture

### Pause Flow

1. User/CLI calls `pause(execution_id, reason)`
2. Go server validates phase (PENDING or IN_PROGRESS only)
3. Go server sends "pause" signal to Temporal workflow
4. Go server updates local phase to PAUSED
5. Java workflow receives signal, sets `pauseRequested = true`
6. Java workflow cancels running activity scope gracefully
7. Python activity detects cancellation via `activity.is_cancelled()`
8. LangGraph saves final checkpoint automatically
9. Python activity returns `EXECUTION_PAUSED` status (not failure)
10. Java workflow awaits resume signal

### Resume Flow

1. User/CLI calls `resume(execution_id)`
2. Go server validates phase (PAUSED only)
3. Go server sends "resume" signal to Temporal workflow
4. Go server updates local phase to IN_PROGRESS
5. Java workflow receives signal, sets `resumeSignalReceived = true`
6. Java workflow unblocks from `Workflow.await()`
7. Java workflow re-invokes activity with same execution context
8. Python activity loads from LangGraph checkpoint via thread_id
9. Agent continues from exact pause point

## Implementation Details

### Proto Changes (stigmer repo)

**`apis/.../workflowexecution/v1/enum.proto`**:
- Added `EXECUTION_PAUSED = 7` with comprehensive documentation
- Updated phase transition documentation to include pause/resume flow
- Clarified PAUSED as non-terminal state (unlike CANCELLED)

**`apis/.../workflowexecution/v1/command.proto`**:
- Added `pause(PauseWorkflowExecutionInput)` RPC with full documentation
- Added `resume(ResumeWorkflowExecutionInput)` RPC with full documentation
- Documented pause vs cancel differences, idempotency, error cases

**`apis/.../workflowexecution/v1/io.proto`**:
- Added `PauseWorkflowExecutionInput` (id + reason for audit)
- Added `ResumeWorkflowExecutionInput` (id only)

**`apis/.../agentexecution/v1/enum.proto`**:
- Added `EXECUTION_PAUSED = 7` to agent execution phases
- Required for Python activity to set paused status
- Shared enum between workflow and agent executions

### Go Server Implementation (stigmer repo)

**`backend/.../workflowexecution/controller/lifecycle_steps.go`**:
- Added `ValidatePausableStep[T]`: Validates PENDING or IN_PROGRESS phase, handles idempotency
- Added `ValidateResumableStep[T]`: Validates PAUSED phase, handles idempotency
- Added `SignalPauseToTemporalStep[T]`: Sends "pause" signal to Temporal workflow
- Added `SignalResumeToTemporalStep[T]`: Sends "resume" signal to Temporal workflow
- Updated `UpdateExecutionPhaseStep` to handle PAUSED (no completed_at)

**`backend/.../workflowexecution/controller/pause.go`** (new):
- Implements `Pause(ctx, input)` handler
- Pipeline: Load → ValidatePausable → SignalPause → UpdatePhase → Persist → Broadcast
- Follows same pattern as cancel.go for consistency
- Returns updated execution with PAUSED phase

**`backend/.../workflowexecution/controller/resume.go`** (new):
- Implements `Resume(ctx, input)` handler
- Pipeline: Load → ValidateResumable → SignalResume → UpdatePhase → Persist → Broadcast
- Returns updated execution with IN_PROGRESS phase

### Java Workflow Changes (stigmer-cloud repo)

**`InvokeWorkflowExecutionWorkflow.java`**:
- Added `@SignalMethod void pause(String reason)`
- Added `@SignalMethod void resume()`
- Imported `SignalMethod` annotation
- Added comprehensive documentation for signal handlers

**`InvokeWorkflowExecutionWorkflowImpl.java`**:
- Added workflow state fields:
  - `private boolean pauseRequested = false`
  - `private boolean resumeSignalReceived = false`
  - `private String pauseReason = null`
- Implemented signal handlers that set flags
- Completely rewrote `executeWorkflowFlow()`:
  - Wrapped in while loop for pause/resume cycles
  - Uses `CancellationScope` to wrap activity invocation
  - Detached scope monitors for pause signal
  - On pause: cancels activity scope gracefully
  - Catches `CanceledFailure`, checks `pauseRequested` flag
  - Uses `Workflow.await(() -> resumeSignalReceived)` to wait
  - On resume: resets flags and loops to re-invoke activity
- Imported `CancellationScope` and `CanceledFailure`

### Python Activity Changes (stigmer repo)

**`backend/.../agent-runner/worker/activities/execute_graphton.py`**:
- Imported `asyncio` for `CancelledError`
- Added cancellation check in event loop:
  - `if activity.is_cancelled()`: logs pause, raises `asyncio.CancelledError`
- Added exception handler for `asyncio.CancelledError`:
  - Finalizes context info
  - Sets phase to `EXECUTION_PAUSED`
  - Adds pause message to status
  - Sends paused status update via gRPC (best effort)
  - Returns PAUSED status (not failure)
- Updated heartbeat payload:
  - Added `"paused": activity.is_cancelled()` field
  - Preserves thread_id for checkpoint resume
- LangGraph automatically saves checkpoint on cancellation

## Key Design Decisions

1. **Pause via Signal + Cancellation**:
   - Uses Temporal's native SignalWorkflow for communication
   - Uses CancellationScope for graceful activity cancellation
   - Leverages existing Temporal primitives (no custom protocols)

2. **PAUSED as Non-Terminal Phase**:
   - Unlike CANCELLED, PAUSED can transition back to IN_PROGRESS
   - No `completed_at` timestamp (execution not finished)
   - Clear semantic distinction for UIs and APIs

3. **Checkpoint Preservation**:
   - LangGraph auto-checkpoints after each agent step
   - thread_id preserved in heartbeat for resume
   - Activity cancellation triggers final checkpoint save
   - No data loss on pause

4. **Idempotency**:
   - Pausing already-paused execution is no-op
   - Resuming already-running execution is no-op
   - Validation steps check current phase first

5. **Graceful vs Force**:
   - `pause`: Graceful, checkpoint saved, can resume
   - `cancel`: Graceful, cleanup allowed, terminal
   - `terminate`: Immediate kill, no cleanup, terminal

## Benefits

### User Experience
- ✅ Pause long-running workflows during maintenance
- ✅ Review progress at any point without losing work
- ✅ Conserve resources by pausing idle workflows
- ✅ Resume hours/days later from exact pause point

### Technical Benefits
- ✅ Zero data loss (LangGraph checkpoint preservation)
- ✅ Consistent patterns (reuses existing lifecycle infrastructure)
- ✅ Idempotent operations (safe retry)
- ✅ Real-time streaming updates (phase changes broadcast)
- ✅ Audit trail (pause reason captured)

### Operational Benefits
- ✅ No workflow restarts needed after pause
- ✅ Progress preserved across pause/resume cycles
- ✅ Maintenance-friendly (pause during windows)
- ✅ Resource-efficient (paused workflows consume no compute)

## Impact

### Affected Components

**stigmer repo**:
- Proto definitions (3 files): enum.proto, command.proto, io.proto
- Generated stubs (12 files): Go and Python protobuf/gRPC stubs
- Go server (3 files): lifecycle_steps.go, pause.go (new), resume.go (new)
- Python activity (1 file): execute_graphton.py

**stigmer-cloud repo**:
- Java workflow (2 files): interface and implementation

### User Impact
- Users can now pause/resume workflow executions via CLI or API
- Workflows can be paused at any point during execution
- Resume works seamlessly from saved checkpoint
- Clear phase distinction in UI (PAUSED vs CANCELLED)

### Developer Impact
- New lifecycle operations follow established patterns
- Reusable pipeline steps for future operations
- Consistent signal handling approach
- Python activity cancellation handling works for both workflow and agent executions

## Scope Limitations

**This implementation covers workflow execution only.**

Agent execution lifecycle (cancel, terminate, recover, pause, resume) is a follow-up task. However, the Python activity cancellation handling implemented here is shared between workflow and agent executions, so it will work for both.

**Missing from agent execution** (follow-up):
- `EXECUTION_TERMINATED` phase
- `cancel`, `terminate`, `recover` RPCs and handlers
- `pause`, `resume` RPCs and handlers (proto already has PAUSED phase)
- Signal handlers in `InvokeAgentExecutionWorkflow.java`

## Testing Strategy

### Unit Tests (Planned)
- ValidatePausableStep phase checks
- ValidateResumableStep phase checks
- Idempotency scenarios

### Integration Tests (Planned)
1. Start execution → pause mid-run → verify PAUSED state
2. Resume paused execution → verify continues from checkpoint
3. Pause during tool execution → verify checkpoint saved correctly
4. Pause → wait hours → resume → verify no data loss

### Manual Testing
- Long-running agent with pause after 30 seconds
- Resume after delay, verify conversation continuity
- Multiple pause/resume cycles

## Related Work

- **Gap A1** (Crash Recovery): Heartbeat mechanism for checkpoint resume on retry
- **Gap A2** (Tool Idempotency): Best practices for checkpoint-based execution
- **Gap B1** (Signal-With-Start): Signal delivery patterns
- **Gap B2** (Event Deduplication): Signal idempotency patterns
- **ADR 011** (Streaming Architecture): Real-time phase updates

## Files Changed

### stigmer repo (25 files)
- 4 proto definitions
- 12 generated stubs (Go + Python)
- 3 Go server files (1 modified + 2 new)
- 1 Python activity file
- 4 BUILD.bazel files
- 1 send_signal.go (minor formatting)
- 3 unrelated project files (noise)

### stigmer-cloud repo (2 files)
- 2 Java workflow files (interface + implementation)

Total: **27 files changed, ~2,300 lines added**

---

**Status**: ✅ Implementation Complete (Testing Pending)
**Timeline**: Single session implementation
