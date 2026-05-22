# Fix Cursor Pause/Resume Status Overwrite Bug

**Date**: May 22, 2026

## Summary

Fixed a status overwrite bug in `ExecuteCursor` where a non-`CancelledFailure` error during an active pause would persist `EXECUTION_FAILED`, overwriting the `PAUSED` state set by the Pause RPC, causing Resume to fail with `FailedPrecondition`. Also hardened the `TestAgentExecution_Pause_Resume` integration test with the slow MCP tool pattern to eliminate timing races.

## Problem Statement

After the P0 FGA authorization fix (runner JWT) and the May 21 pause/resume heartbeat fix, the `Pause_Resume/cursor` integration test still failed:

```
Cannot resume agent execution in EXECUTION_FAILED phase. Only PAUSED executions can be resumed.
```

### Pain Points

- The Pause RPC writes `PAUSED` optimistically to the DB before the activity acknowledges cancellation
- `ExecuteCursor`'s generic catch block checked for `CancelledFailure` but ignored `pauseDetected` and `cancellationSignal.aborted` — any concurrent non-cancellation error was treated as a normal failure
- The activity returned `slimStatus(FAILED)` instead of throwing, so the Go workflow's `err != nil && pauseRequested` guard never fired
- No post-stream cancellation re-check: if the cancellation signal arrived between the last stream event and `run.wait()`, it was missed
- The test used a text-only essay prompt with no mechanism to keep the execution running, creating a timing race

## Solution

Two-layer fix: runner-side cancellation awareness + test hardening.

### Layer A: ExecuteCursor cancellation awareness

1. **Hoisted `pauseDetected`** to the outer function scope (alongside `sessionId`, `session`, `userMessage`) so the catch block can access it

2. **Post-stream cancellation re-check**: After the stream loop exits, re-check `Context.current().cancellationSignal.aborted` before proceeding to `run.wait()`. This catches late-arriving cancellation signals that arrived after the last stream event

3. **Pause-aware generic catch**: Before defaulting to `EXECUTION_FAILED`, check if `pauseDetected || cancellationSignal.aborted`. If a pause was in progress when the error occurred, persist `PAUSED` and throw `CancelledFailure` instead of returning `FAILED`. This ensures the Go workflow's pause loop is triggered correctly

### Layer B: Test hardening

Applied the slow MCP tool pattern (matching `TestAgentExecution_Terminate`) to `TestAgentExecution_Pause_Resume`:
- Added `mcpTestServerBinary` prereq check
- Create and connect stdio MCP test server
- Agent calls the `slow` tool with `seconds=30` (deterministic 30s execution window)
- `WithAutoApproveAll(true)` to bypass approval gates

## Implementation Details

### ExecuteCursor error handling flow (after fix)

```
catch (err) {
  1. CancelledFailure → persist PAUSED, re-throw (existing)
  2. pauseDetected || cancellationSignal.aborted → persist PAUSED, throw CancelledFailure (NEW)
  3. Everything else → persist FAILED, return slimStatus (unchanged)
}
```

### Architectural decision deferred

Gap #5 from the analysis (`updateStatus` blindly overwrites PAUSED with FAILED from the runner) was identified but deferred as a broader design discussion. The runner-side fix (ensuring the activity throws `CancelledFailure` during pause) makes this overwrite unlikely to occur, but a server-side phase guard remains a potential hardening measure for the future.

## Benefits

- `Pause_Resume/cursor` no longer fails with status overwrite
- `Pause_Resume/native` benefits from the slow MCP tool (deterministic timing, no flakiness from fast essay completion)
- The pattern is consistent with `TestAgentExecution_Terminate` (proven pattern)
- No changes required to the Go workflow orchestrator — the `err != nil && pauseRequested` guard is correct once the activity properly throws

## Impact

| Component | Change |
|-----------|--------|
| `backend/services/runner/src/activities/execute-cursor/index.ts` | Hoist `pauseDetected`, add post-stream cancellation check, add pause-aware generic catch |
| `test/integration/agent_execution_06_lifecycle_control_test.go` | Use slow MCP tool pattern for Pause_Resume test |

## Related Work

- [Agent Execution Pause/Resume Fix](2026-05-21-190955-agent-execution-pause-resume-fix.md) — May 21 fix that wired heartbeats and CancelledFailure handling (prerequisite)
- [Fix Runner FGA Auth with Proper JWT](2026-05-22-113306-fix-runner-fga-auth-with-proper-jwt.md) — P0 fix that unblocked status updates (prerequisite)
- Session 9 integration test report — `_cursor/integration-test-session9-report.md`

---

**Status**: Production Ready
**Timeline**: ~45 minutes (single session)
