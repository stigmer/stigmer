# Fix ExecuteCursor False Pause from Heartbeat Timeout

**Date**: May 27, 2026

## Summary

Added periodic heartbeat to the `ExecuteCursor` Temporal activity and improved cancellation message fidelity so that heartbeat timeouts are no longer mislabeled as "Execution paused by user." Previously, if the Cursor SDK agent was silently executing a long tool call (e.g., database query via MCP), the 2-minute heartbeat timeout would cancel the activity and incorrectly report a user-initiated pause.

## Problem Statement

Workflow executions using the Cursor harness were intermittently showing "Execution paused by user. Use resume to continue." even though no user or API caller had issued a pause command.

### Pain Points

- Users see a confusing "paused by user" message when they never paused
- Executions stall and require manual resume for no apparent reason
- The root cause (heartbeat timeout during silent SDK operations) was obscured by the misleading status message
- `ExecuteDeepAgent` (LangGraph path) already solved this with a 2-second periodic heartbeat, but `ExecuteCursor` only heartbeat on stream events

## Solution

Three-pronged fix:

1. **Periodic heartbeat timer** — Start a 30-second `setInterval` heartbeat (via the existing `startHeartbeat` utility) before entering the Cursor SDK stream loop. This keeps Temporal informed during silent operations.

2. **Cancellation message fidelity** — Distinguish between real pause (orchestrator sent CancelledFailure via heartbeat response) and infrastructure cancellation (heartbeat timeout, worker shutdown). Real pauses show "Execution paused by user"; infrastructure cancellations report `EXECUTION_FAILED` with "Execution interrupted: agent was unresponsive."

3. **Increased heartbeat timeout** — Raised the Java orchestrator's `setHeartbeatTimeout` for `ExecuteCursor` from 2 minutes to 5 minutes as a safety net.

## Implementation Details

**Runner (TypeScript):** `backend/services/runner/src/activities/execute-cursor/index.ts`

- Imported `startHeartbeat` from `../../shared/heartbeat.js` (already used by `call-agent`, `run-command`, `call-http`)
- Declared `periodicHeartbeat` at function scope for catch-block accessibility
- Start heartbeat before `agent.send()`, stop after stream ends
- Propagate `periodicHeartbeat.cancelled` to `pauseDetected` (confirms real orchestrator pause)
- Phase 11a: Only set `EXECUTION_PAUSED` when `pauseDetected` is true; report `EXECUTION_FAILED` for bare `cancellationSignal.aborted`
- Catch block: Split `CancelledFailure` handling into pause-confirmed vs infrastructure branches
- Added new infrastructure-cancel path for non-`CancelledFailure` errors during `cancellationSignal.aborted`

**Orchestrator (Java):** `InvokeAgentExecutionWorkflowImpl.java`

- Changed `setHeartbeatTimeout(Duration.ofMinutes(2))` to `Duration.ofMinutes(5)` for the `ExecuteCursor` activity stub

## Benefits

- Eliminates false "paused by user" messages that confuse users
- Users see accurate failure messages when infrastructure issues occur
- Heartbeat timeout window expanded from 2→5 minutes with periodic 30s keepalives
- Consistent with `ExecuteDeepAgent` which already uses periodic heartbeats
- Better diagnostics: log messages now distinguish `(pause)` from `(infrastructure)` cancellations

## Impact

- All Cursor harness executions (sessions, workflow agent_call tasks)
- Users who experienced intermittent false pauses will no longer see them
- Workflow executions with long MCP tool calls or database queries are now resilient

## Related Work

- `2026-05-22-120905-fix-cursor-pause-resume-status-overwrite.md` — Previous pause/resume fix (addressed status overwrite, not heartbeat gap)
- `shared/heartbeat.ts` — Shared utility used by other activities, now adopted by ExecuteCursor

---

**Status**: Production Ready
**Timeline**: Single session
