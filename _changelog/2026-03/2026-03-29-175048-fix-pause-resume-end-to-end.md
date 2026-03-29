# Fix Pause/Resume Mechanism — End-to-End Across Go, Java, and Python

**Date**: March 29, 2026

## Summary

Fixed a fundamental architectural gap in the agent execution pause/resume mechanism. The Go Temporal workflow was not consuming pause signals at all, the Java Cloud service lacked RPC handlers to send them, and the Python activity was using an unreliable fire-and-forget pattern for status persistence. This cross-platform fix ensures pause/resume works reliably end-to-end across all three languages.

## Problem Statement

Agent execution pause/resume was broken at multiple levels across the polyglot stack.

### Pain Points

- **Go workflow ignored pause signals**: `executeGraphtonFlow` had no signal channel listener for pause — when a user paused an execution, the activity continued running and eventually overwrote the PAUSED status with its own terminal status
- **Java Cloud lacked RPC handlers**: While the Java Temporal workflow had correct pause/resume logic internally (CancellationScope + Async.procedure), there were no `AgentExecutionPauseHandler` or `AgentExecutionResumeHandler` to actually receive and route pause/resume requests
- **Python used unreliable persistence**: `_handle_pause` in `streaming.py` used `asyncio.create_task` to fire-and-forget a gRPC status update — the task could be garbage-collected before completing, leaving the PAUSED status unpersisted
- **Status race condition**: Even when Python did persist PAUSED, the activity kept running (because the workflow never cancelled it), and its normal completion status overwrote the PAUSED status

## Solution

Coordinated fix across all three languages, modeled around the proven Java workflow pattern:

1. **Go workflow**: Refactored `executeGraphtonFlow` with an outer pause/resume loop using `workflow.Go()` + `workflow.WithCancel()` for concurrent signal monitoring and activity cancellation
2. **Java handlers**: Created full pipeline-based RPC handlers following the established handler pattern
3. **Python persistence**: Unified all terminal status persistence (pause, stall, recursion limit) through the existing `retry_executor` mechanism

## Implementation Details

### Go Workflow (stigmer OSS)

Added signal constants (`SignalPause`, `SignalResume`) to `workflow_types.go` and updated `lifecycle_steps.go` to use them instead of inline strings.

Refactored `executeGraphtonFlow` in `invoke_workflow_impl.go`:
- Outer `for {}` loop manages pause/resume cycles
- `workflow.WithCancel(ctx)` creates a cancellable context per activity invocation
- `workflow.Go(activityCtx, ...)` runs a goroutine that listens for `SignalPause` and calls `cancelActivity()` when received
- Extracted `executeGraphtonWithHitl()` for the activity + HITL approval logic
- On cancellation + `pauseRequested`: persists PAUSED status (defense-in-depth), waits for `SignalResume`, then continues the loop
- `MaxPauseCycles = 50` safety limit prevents infinite loops

### Java Cloud (stigmer-cloud)

Added `SIGNAL_PAUSE`/`SIGNAL_RESUME` constants to `AgentExecutionTemporalWorkflowTypes` and explicit `@SignalMethod(name=...)` attributes to the workflow interface.

Created two new RPC handlers following the established pipeline pattern:
- `AgentExecutionPauseHandler`: LoadExisting → Authorize → ValidatePausable → SignalPauseToTemporal → UpdatePhase → Persist → PublishToRedis
- `AgentExecutionResumeHandler`: LoadExisting → Authorize → ValidateResumable → SignalResumeToTemporal → UpdatePhase → Persist → PublishToRedis

### Python Activity (shared)

Simplified `_handle_pause` in `streaming.py` to pure in-memory proto mutation — no more gRPC calls. The caller (`execute_graphton.py`) handles all terminal status persistence uniformly through `retry_executor`, which provides exponential backoff and structured error handling.

### Tests

- **Go**: 5 workflow tests covering pause→resume, normal completion, HITL approval loop, multi-cycle pause/resume, and FAILED activity propagation
- **Java**: 2 signal tests for pause/resume completion and normal completion without signals
- **Python**: 5 unit tests for `_handle_pause` return semantics and terminal status persistence through `retry_executor`

## Benefits

- **Pause actually works**: User can pause a running execution and it stops — the activity is cancelled, a LangGraph checkpoint is saved, and the workflow waits for resume
- **Resume resumes from checkpoint**: After resume signal, the workflow re-invokes the Python activity which loads from the saved LangGraph checkpoint
- **Reliable persistence**: Terminal status always goes through `retry_executor` with exponential backoff — no more fire-and-forget
- **Defense-in-depth**: Both the Python activity and the workflow persist PAUSED status, ensuring at least one write succeeds
- **Cross-language consistency**: Signal names are defined as constants in both Go and Java, eliminating string drift

## Impact

- **Users**: Pause/resume functionality now works as designed — executions can be reliably paused and resumed
- **Go workflow**: `invoke_workflow_impl.go` gained ~120 net lines but is now architecturally correct with a clear pause/resume lifecycle
- **Java Cloud**: Gained the Pause/Resume RPC endpoints that were missing from the API surface
- **Python activity**: Lost ~10 lines of unreliable code, gained ~25 lines of reliable persistence through the established retry path
- **Testing**: 12 new tests across three languages provide regression coverage

## Related Work

- T04 (fingerprint dedup → identity lookup) and T05 (namespace heuristics → parent_ids) were completed in earlier sessions as part of the same StatusBuilder hardening project
- InterruptProxyRunnable elimination (separate project) further simplifies the pause path
- T07 (ExecutionState reducer refactor) is the next task in the hardening sequence

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (including research, cross-language implementation, and testing)
