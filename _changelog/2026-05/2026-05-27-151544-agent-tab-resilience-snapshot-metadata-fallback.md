# Agent Tab Resilience: Snapshot Metadata Fallback

**Date**: May 27, 2026

## Summary

Added a defense-in-depth fallback for the Agent tab in the workflow execution inspector. When `agent_call_started` events are transiently lost (the runner's `emitEvents` closure silently swallows errors), the inspector now falls back to `task.metadata.agent_execution_id` from the task snapshot to show the Agent tab with a "View Agent Execution" link.

## Problem Statement

When viewing a completed workflow execution containing `agent_call` tasks (e.g., `analyze_player_data` in `daily-notification-plan`), the Agent tab was not shown in the execution inspector even though the task was correctly identified as an agent call (the "Agent Call" badge appeared).

### Pain Points

- The Agent tab relied exclusively on `agentCallStarted` events in the event stream
- The runner's event emission (`ctx.emitEvents`) wraps all gRPC calls in try/catch with non-fatal logging, meaning agent_call events can be silently lost
- No fallback data source existed even though `task.metadata.agent_execution_id` was already available from the do-executor's task status accumulator
- Users had no way to navigate to the child agent execution when events were missing

## Solution

Test-first diagnosis: wrote integration tests to prove the backend pipeline works, identified the frontend resilience gap, then added the fallback.

The `buildAgentCall()` function in `derive-task-detail.ts` now accepts the task kind and snapshot metadata as additional parameters. When no `agentCallStarted` event exists but the task is an `agent_call` and the snapshot metadata contains `agent_execution_id`, it returns a minimal `TaskDetailAgentCall` with the child execution ID.

## Implementation Details

- **`derive-task-detail.ts`**: `buildAgentCall()` signature expanded to accept `taskKind` and `snapshotMeta`; fallback path checks `taskKind === WorkflowTaskKind.agent_call` and extracts `agent_execution_id` from metadata
- **`derive-task-detail.test.ts`**: Two new unit tests — one proving the fallback produces a non-null `agentCall` from snapshot metadata, one confirming non-agent tasks are unaffected
- **`workflow_cursor_call_live_events_test.go`**: Four new integration tests covering cursor-harness event lifecycle, event persistence, task snapshot metadata, and an offline variant for CI without API keys

## Benefits

- Agent tab appears even when events are transiently lost (defense-in-depth)
- "View Agent Execution" link available via snapshot metadata fallback
- Cursor-harness agent_call event lifecycle now has dedicated integration test coverage
- Offline CI test verifies event emission without requiring provider credentials

## Impact

- **SDK (`@stigmer/react`)**: `derive-task-detail.ts` API unchanged externally; `buildAgentCall()` is internal
- **Integration tests**: New test file `workflow_cursor_call_live_events_test.go` adds coverage for a previously untested path
- **No breaking changes**: The fallback only activates when events are absent; existing behavior with events is unchanged

## Related Work

- Investigation document: `_cursor/investigations/missing-agent-tab-in-execution-inspector.md`
- Existing native-harness event tests: `test/integration/workflow_agent_call_live_events_test.go`
- Existing cursor-harness tests: `test/integration/workflow_cursor_call_test.go`

---

**Status**: Production Ready
