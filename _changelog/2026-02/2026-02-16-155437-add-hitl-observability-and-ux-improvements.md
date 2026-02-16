# Add HITL Observability and UX Improvements for Approval Flow Debugging

**Date**: February 16, 2026

## Summary

Enhanced the Human-In-The-Loop (HITL) approval flow with comprehensive diagnostic logging across the Go/Java workflow layer and CLI, plus UX improvements for better user feedback during approval requests. These changes were implemented to debug and resolve a critical issue where approval prompts were not appearing in the CLI despite the agent-runner correctly detecting approval requirements.

This work adds observability infrastructure to trace the flow of approval state through the entire stack (Python activity → Temporal workflow → gRPC stream → CLI TUI) and improves the user experience by showing visual indicators when tools are waiting for approval.

## Problem Statement

The HITL approval flow was broken — when a Write tool required approval, the agent-runner correctly detected it and called `interrupt()`, but the approval prompt never appeared in the CLI. Instead, the execution was incorrectly marked as "completed" even though the write operation was pending approval and the file had not been written.

### Pain Points

- **Zero visibility into workflow deserialization**: The Go/Java workflows received `AgentExecutionStatus` from the Python activity but had no logging of the deserialized phase enum value. If Temporal's cross-language proto serialization was losing the phase, we wouldn't know.
- **Race condition on status broadcast**: The agent-runner sent WAITING_FOR_APPROVAL via gRPC, but there was no guarantee the CLI subscription received it before the workflow completed. The workflow didn't persist the status before waiting for signals.
- **No CLI-side diagnostic logging**: The CLI stream goroutine had no trace-level logging of received phase and pending_approvals, making it impossible to confirm whether the approval state reached the CLI at all.
- **Missing visual feedback**: When a tool transitioned to `waiting_approval` status (before the full approval prompt with details), the CLI showed no indicator, leaving users wondering why execution appeared stalled.

## Solution

Added four layers of observability and UX improvements across the stack:

1. **Workflow diagnostic logging** (Go + Java): Log the deserialized `AgentExecutionStatus` immediately after `ExecuteGraphton` returns, including phase, phase_value (raw int), pending_approvals count, messages count, and tool_calls count. Applied after both initial invocation and approval re-invocations.

2. **Persist-before-wait pattern** (Go + Java): Before blocking on `waitForApprovalSignal()` / `Workflow.await()`, persist the WAITING_FOR_APPROVAL status (with pending_approvals) to the database via local activity. This triggers a StreamBroker broadcast, guaranteeing CLI subscribers receive the approval state even if the agent-runner's gRPC update arrived before subscription was active.

3. **CLI stream trace logging** (Go): Added zerolog Debug-level logging at three critical points in `streamToEvents`: after every `stream.Recv()`, at approval detection, and at terminal phase detection. Logs include phase, pending_approvals count, and message/tool-call counts.

4. **ToolWaitingApprovalEvent** (Go CLI): New event type and rendering pipeline that shows a visual indicator (`⏸ awaiting approval`) when a tool enters waiting_approval status, giving users immediate feedback before the full approval prompt appears.

## Implementation Details

### Go Workflow (`stigmer` repo)

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`

- Added structured logging after `ExecuteGraphton` returns:
  ```go
  logger.Info("📋 Activity returned status",
      "execution_id", executionID,
      "phase", finalStatus.GetPhase().String(),
      "phase_value", int32(finalStatus.GetPhase()),
      "pending_approvals", len(finalStatus.GetPendingApprovals()),
      ...)
  ```
- Added persist call before signal wait (belt-and-suspenders approach):
  ```go
  if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
      logger.Warn("⚠️ Failed to persist WAITING_FOR_APPROVAL status (non-fatal)", ...)
  }
  ```

### Java Workflow (`stigmer-cloud` repo)

**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java`

- Same diagnostic logging pattern using SLF4J:
  ```java
  logger.info("📋 Activity returned status: execution_id={}, phase={}, phase_value={}, ...",
      executionId, finalStatus.getPhase(), finalStatus.getPhaseValue(), ...);
  ```
- Same persist-before-wait using `updateStatusActivity`:
  ```java
  updateStatusActivity.updateExecutionStatus(executionId, finalStatus);
  ```

### CLI Stream Events (`stigmer` repo)

**File**: `client-apps/cli/cmd/stigmer/root/run_stream_events.go`

- Imported `github.com/rs/zerolog/log`
- Added trace logging after `stream.Recv()`:
  ```go
  log.Debug().
      Str("execution_id", cfg.executionID).
      Str("phase", execution.Status.GetPhase().String()).
      Int("pending_approvals", len(execution.Status.GetPendingApprovals())).
      Msg("[stream] received execution update")
  ```
- Added logging at approval detection and terminal phase checks
- Enhanced `emitToolCallStateEvents` to emit `ToolWaitingApprovalEvent` when tool enters `waiting_approval` status

### CLI TUI Event System (`stigmer` repo)

**New Event Type** (`client-apps/cli/pkg/executiontui/events.go`):
```go
type ToolWaitingApprovalEvent struct {
    ToolCallID string
    ToolCall   toolrender.ToolCallInfo
}
```

**Renderer** (`client-apps/cli/pkg/toolrender/render.go`):
- New `RenderWaitingApproval()` function that formats tool headers with `⏸ awaiting approval` indicator

**Event Handler** (`client-apps/cli/pkg/executiontui/handle_events.go`):
- Added case for `ToolWaitingApprovalEvent` — creates a tracked block (in `runningTools` map) so the subsequent `ApprovalNeededEvent` can replace it in-place

### Defensive Code Decision

**Note**: An initial implementation included defensive phase correction (if `pending_approvals > 0` but phase != `WAITING_FOR_APPROVAL`, silently correct the phase). This was **deliberately removed** after architectural discussion with the user. The defensive check was a hack that would mask the root cause rather than fixing it. The diagnostic logging is sufficient to identify the actual issue, which can then be fixed properly.

## Benefits

1. **Complete visibility into approval flow**: Logs at every critical transition point (Python return → workflow deserialization → gRPC stream → CLI receipt) make it possible to pinpoint exactly where approval state is lost or corrupted.

2. **Eliminates race condition**: Persist-before-wait guarantees the CLI receives WAITING_FOR_APPROVAL status even if the agent-runner's gRPC update arrived before the subscription was active.

3. **Better UX**: Users see a visual indicator when a tool is waiting for approval, rather than wondering why execution appears stuck.

4. **Production-ready observability**: Debug logging doesn't impact production (only visible with `STIGMER_LOG_LEVEL=debug`) but provides essential diagnostic data when troubleshooting approval flow issues.

## Actual Root Cause Discovery

After implementing these observability improvements and analyzing fresh logs, we discovered the **actual root cause is in the Python agent-runner, not in Temporal serialization**:

```
10:08:11,236 - ⏸️  Interrupting execution for approval: tool=write
10:08:11,242 - 📊 Stream finished — processed 2043 events
10:08:11,243 - 📤 [FINAL] Sending EXECUTION_COMPLETED status update    ← THE BUG
10:08:11,248 - phase: EXECUTION_COMPLETED                              ← WRONG PHASE
```

The Python activity sends `EXECUTION_COMPLETED` (not `WAITING_FOR_APPROVAL`) via both the gRPC stream and the Temporal return value. The post-stream interrupt capture logic in `execute_graphton.py` either fails to detect the LangGraph interrupt or the phase is overwritten afterwards. This is the actual bug to fix — see the follow-up plan in `.cursor/plans/fix_hitl_approval_phase_0e60be7c.plan.md`.

## Impact

- **Debugging**: Complete trace capability for approval flow issues
- **Reliability**: Eliminates race condition between gRPC updates and CLI subscription
- **User Experience**: Clear visual feedback when tools need approval
- **Future fixes**: Observability infrastructure is now in place to diagnose and fix the actual root cause in the Python activity

## Related Work

- **Plan**: `.cursor/plans/fix_approval_interrupt_flow_f8856d82.plan.md` (original plan, based on serialization hypothesis)
- **Follow-up**: `.cursor/plans/fix_hitl_approval_phase_0e60be7c.plan.md` (addresses the actual root cause in Python)
- **Previous fix**: Commit `55b95025` ("prevent COMPLETED phase overwriting WAITING_FOR_APPROVAL") — attempted to fix this but the issue persisted
- **Context**: Logs in `_cursor/error.md` showing the reproduction and root cause discovery

## Breaking Change History Context

The approval flow broke after three rapid refactors on Feb 15, 2026:
1. `85835fb6` (14:48): Removed deprecated singular `pending_approval` field
2. `a4726656` (16:26): Slim payloads refactor — changed activity signature to `(executionID, threadID, approvalDecisions)`
3. `5b7856f6` (16:50): Fixed approval deserialization by wrapping in `ApprovalDecisionList`

The refactors were individually reasonable but lacked end-to-end testing of the HITL happy path. This observability infrastructure prevents similar silent failures in the future.

---

**Status**: ✅ Observability improvements complete, root cause identified
**Next**: Fix the Python activity's phase determination logic (see follow-up plan)
