# Fix Structured Output Pipeline Data Loss (v3)

**Date**: May 24, 2026

## Summary

Fixed three independent data-loss points that caused `structuredOutput` extracted
by the runner to never reach the workflow engine, breaking all workflows with
`output.schema` on `agent_call` tasks. The runner extracted structured output
correctly (`hasStructuredOutput=true`), but the data was dropped at every
hand-off point: `slimStatus()`, Java `updateStatus` merge, and Java async
completion payload.

## Problem Statement

The `daily-notification-plan` workflow for Tiny Tactics (and any workflow using
`output.schema` on `agent_call` tasks) failed with:

```
Agent output validation failed for task 'analyze_player_data':
Agent did not return structured output
```

Despite the runner logs confirming successful extraction:

```
ExecuteCursor structured output extracted (text): finalTextLength=2257
ExecuteCursor completed: hasStructuredOutput=true
```

MongoDB query confirmed zero agent executions in the entire database ever had
a `structuredOutput` field, proving the data was being lost at the persistence
layer as well.

### Pain Points

- Workflows with `output.schema` always failed validation — 4+ hours stuck
- $3+ burned per retry loop on futile re-extraction attempts
- No visibility into where structured data was being dropped
- Previous fixes (v1 and v2) addressed extraction but never tested the
  return-path data flow

## Solution

### Root Cause 1: `slimStatus()` stripped `structuredOutput`

`slimStatus()` creates a new proto for the Temporal activity return value,
copying only `phase, error, timestamps, pendingApprovals`. The
`structuredOutput` field was not included. The code then monkey-patched
`slim.structured_output` (wrong key — snake_case instead of camelCase),
which the Go backend's `buildCallbackResult` couldn't find.

**Fix**: Added `structuredOutput: full.structuredOutput` to the `slimStatus()`
proto copy. Removed the monkey-patching in both `execute-cursor/index.ts` and
`execute-deep-agent/index.ts`.

### Root Cause 2: Java `updateStatus` handler dropped the field

The `BuildNewStateWithStatusStep` in `AgentExecutionUpdateStatusHandler.java`
explicitly merges 12 status fields but had no code for `structuredOutput`.
The Go OSS handler (`update_status.go`) already had this merge; the Java
cloud handler was missing it.

**Fix**: Added `if (requestStatus.hasStructuredOutput()) { ... }` merge block.

### Root Cause 3: Java async completion sent plain string

Both `executeCursorFlow()` and `executeDeepAgentFlow()` in
`InvokeAgentExecutionWorkflowImpl.java` completed the parent `CallAgent`
activity with a human-readable string (`"Agent execution completed -
execution_id: X, phase: Y"`) instead of a JSON payload containing
`structured` and `agent_execution_id`.

**Fix**: Replaced with `buildCallbackResultJson()` that serializes
`structuredOutput` as a JSON payload the TS orchestrator can parse.

### Root Cause 4: TS orchestrator didn't parse string results

The `call-agent-orchestrator.ts` cast the async completion result directly
as `AgentCallResult` without handling the case where Java sends a string.

**Fix**: Added JSON string detection and parsing in the `.then()` handler.

## Test Coverage Added

**Test-first (Red-Green) approach** — tests were written and confirmed failing
before fixes were applied.

- `shared/__tests__/status.test.ts` — 3 new tests:
  - `slimStatus` preserves `structuredOutput` when present
  - `slimStatus` omits `structuredOutput` when absent (no spurious empty field)
  - Activity return contains `structuredOutput` accessible by Go backend
- `golden-execution.test.ts` — 3 new integration tests:
  - End-to-end structured output pipeline (analyze → downstream reads `$context`)
  - `ON_INVALID_FAIL` rejects missing structured output
  - Full daily-notification-plan schema with optional fields

## Implementation Details

### stigmer repo (TypeScript runner)

| File | Change |
|------|--------|
| `backend/services/runner/src/shared/status.ts` | Added `structuredOutput` to `slimStatus()` proto copy |
| `backend/services/runner/src/activities/execute-cursor/index.ts` | Removed `slim.structured_output` monkey-patch |
| `backend/services/runner/src/activities/execute-deep-agent/index.ts` | Same |
| `backend/services/runner/src/workflows/call-agent-orchestrator.ts` | Parse JSON string from Java async completion |

### stigmer-cloud repo (Java backend)

| File | Change |
|------|--------|
| `AgentExecutionUpdateStatusHandler.java` | Added `structuredOutput` merge in `BuildNewStateWithStatusStep` |
| `InvokeAgentExecutionWorkflowImpl.java` | Replaced plain string with `buildCallbackResultJson()` in both cursor and deep-agent flows |

## Benefits

- All workflows with `output.schema` on `agent_call` tasks now work end-to-end
- Structured output persists to MongoDB (queryable, debuggable, frontend-visible)
- Both Go OSS and Java cloud paths handle structured output correctly
- 6 new regression tests prevent future data-loss regressions

## Impact

- All `agent_call` tasks with `output.schema` (Cursor and native harness)
- Tiny Tactics `daily-notification-plan` workflow unblocked
- No behavioral change for tasks without `output.schema`

---

**Status**: Production Ready
