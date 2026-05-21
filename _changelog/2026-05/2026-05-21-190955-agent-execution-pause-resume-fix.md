# Agent Execution Pause/Resume Fix

**Date**: May 21, 2026

## Summary

Fixed agent execution pause/resume end-to-end by wiring Temporal activity heartbeating into ExecuteDeepAgent (required for cancellation signal delivery), adding CancelledFailure detection to both ExecuteDeepAgent and ExecuteCursor activities, persisting rich PAUSED status before throwing CancelledFailure, and un-skipping the integration test. Without heartbeats, the Temporal TS SDK never delivered cancellation signals to the activity — the root cause was a protocol gap, not a logic bug.

## Problem Statement

Agent execution pause/resume was broken across the entire stack. The Go/Java orchestrators correctly sent pause signals and cancelled the activity context, but the TS runner activities never responded. Six distinct gaps were identified:

### Pain Points

- ExecuteDeepAgent sent zero heartbeats — Temporal had no channel to deliver cancellation signals (`cancellationSignal` stayed `false` forever)
- `isCancelledFn` and `heartbeatFn` were defined in `streaming.ts` but never wired from `index.ts`
- `CancelledFailure` caught by generic error handler → persisted `EXECUTION_FAILED` instead of `EXECUTION_PAUSED`
- PAUSED `terminalStatus` returned from `streamExecution()` but never persisted to DB
- Activity returned normally instead of throwing `CancelledFailure` — Go orchestrator's `err != nil && pauseRequested` check never triggered
- ExecuteCursor had `heartbeat()` calls (cancellation would fire) but no CancelledFailure handling — same FAILED conversion

## Solution

Surgical changes to 5 existing files, zero new files:

1. **ExecuteDeepAgent heartbeating**: Wired `heartbeatFn` (inline via streaming loop for stall-detection compatibility) and `isCancelledFn` (polls `cancellationSignal.aborted`) into `streamExecution()`. Heartbeats fire every 2s during event processing; if the agent stalls, heartbeats stop and Temporal's 2-minute HeartbeatTimeout activates.

2. **CancelledFailure flow in ExecuteDeepAgent**: When `streamExecution()` returns PAUSED terminal status, the activity persists the rich status (with messages, tool calls, artifacts) to DB, then throws `CancelledFailure`. The catch block detects `CancelledFailure` first, persists a minimal PAUSED status as defense-in-depth, and re-throws. Generic errors fall through to the existing FAILED handler.

3. **Post-stream PAUSED handling**: `processPostStream()` now treats `EXECUTION_PAUSED` like `EXECUTION_WAITING_FOR_APPROVAL` — drains pending publish/writeback promises (in-flight artifact writes complete) but skips auto-publish safety net and writeback finalize (those run on resume).

4. **ExecuteCursor cancellation**: Protected the `heartbeat()` call inside the `onDelta` callback with a try/catch — if `CancelledFailure` fires (cancellation delivered via heartbeat response), sets `pauseDetected` flag and returns gracefully instead of crashing the Cursor SDK. Added `pauseDetected || cancellationSignal.aborted` check at the top of the streaming loop. After loop exit, finalizes messages, persists PAUSED status, saves session memory (needed for continuation prompt on resume), and throws `CancelledFailure`. Catch block detects `CancelledFailure` first and re-throws.

5. **Integration test**: Un-skipped `TestAgentExecution_Pause_Resume` — validates the full E2E flow (start → IN_PROGRESS → pause → PAUSED → resume → COMPLETED).

## Implementation Details

### LangGraph Checkpoint Behavior

LangGraph checkpoints are saved automatically after each graph node completes — no explicit save-on-pause is needed. The checkpointer type determines resume durability:

| Mode | Checkpointer | Same worker resume | Different worker resume |
|------|-------------|-------------------|------------------------|
| OSS | MemorySaver | Checkpoint available | Checkpoint lost — fresh start |
| Cloud | HttpCheckpointSaver | Checkpoint available | Checkpoint available (durable) |

OSS graceful degradation is accepted — cloud mode is fully durable.

### ExecuteCursor "Soft Pause"

Cursor agents have no checkpoint mechanism. Pause stops the current turn. Resume re-invokes the activity, which calls `resolveAgent()` (may resume existing agent or create fresh) and uses `buildContinuationPrompt()` from `SessionMemory` — identical to the existing HITL reinvocation flow.

### Architectural Decisions

- **AD-1**: No heartbeats during ExecuteDeepAgent setup phase — setup takes 2-10 seconds, well within the 2-minute HeartbeatTimeout
- **AD-2**: Inline heartbeats via `heartbeatFn` (not `startHeartbeat()` background timer) — preserves stall-detection behavior
- **AD-3**: `sendHeartbeat()` swallowing `CancelledFailure` is correct — `cancellationSignal` is set before the throw, `isCancelledFn` detects it on next iteration

## Benefits

- Agent execution pause/resume works end-to-end for both LangGraph and Cursor harnesses
- Cloud mode (HTTP checkpointer) gets fully durable pause/resume
- OSS mode gets best-effort resume (acceptable for local development)
- No new files, no new dependencies, no API changes
- Integration test validates the full flow

## Impact

| Component | Change |
|-----------|--------|
| `execute-deep-agent/index.ts` | Wire heartbeatFn + isCancelledFn, persist PAUSED, detect + re-throw CancelledFailure |
| `execute-deep-agent/post-stream.ts` | Skip auto-publish/finalize for PAUSED (drain pending only) |
| `execute-cursor/index.ts` | Protect onDelta heartbeat, add pauseDetected flag, handle PAUSED, detect CancelledFailure |
| `execute-deep-agent/__tests__/streaming.test.ts` | 3 new cancellation tests (message content, event preservation, pending promises) |
| `agent_execution_06_lifecycle_control_test.go` | Un-skip TestAgentExecution_Pause_Resume |

## Related Work

- [Workstream B: Orchestrator Rewrite with Pause/Resume](2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md) — Built the Go/Java orchestrator and CNCF workflow engine pause/resume (prerequisite)
- Pre-deploy integration test expansion project — `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/`

---

**Status**: Production Ready
**Timeline**: ~30 minutes (single session)
