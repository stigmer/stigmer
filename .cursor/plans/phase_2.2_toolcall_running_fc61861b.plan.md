---
name: Phase 2.2 ToolCall RUNNING
overview: Update StatusBuilder to use TOOL_CALL_RUNNING status when tools start executing, enabling the CLI and frontend to show "Running" indicators for long-running tools instead of misleading "Queued" status.
todos:
  - id: status-change
    content: Change TOOL_CALL_PENDING to TOOL_CALL_RUNNING in _handle_tool_start_event
    status: completed
  - id: duration-tracking
    content: Add tool execution duration tracking with _tool_start_times dict
    status: completed
  - id: structured-logging
    content: Add [TOOL] structured logging for start/end events with duration
    status: completed
  - id: unit-tests
    content: Create TestToolCallStatus class with 7 tests covering status transitions
    status: completed
  - id: verify-existing
    content: Run all existing tests (125) to ensure no regressions
    status: completed
isProject: false
---

# Phase 2.2: Use RUNNING Status for ToolCall

## Problem Statement

Tools currently jump from `PENDING` to `COMPLETED`, skipping `RUNNING`. This is semantically incorrect:

- **PENDING** = "Waiting to execute" - implies queued, not yet started
- **RUNNING** = "Currently executing" - the tool is actively doing work

In LangGraph's event model, `on_tool_start` fires when the tool **begins execution**, not when it's queued. The current `PENDING` status misleads users into thinking tools haven't started yet, when in fact they're actively running.

**Impact**: Long-running tools (kubectl, file operations, API calls) show "Queued" in the CLI/UI for their entire execution duration, providing poor UX.

## Current State Analysis

### Proto Definition (No Changes Needed)

The enum already defines RUNNING - it's simply unused:

```30:31:apis/ai/stigmer/agentic/agentexecution/v1/enum.proto
  TOOL_CALL_PENDING = 1; // Waiting to execute
  TOOL_CALL_RUNNING = 2; // Currently executing
```

### Status Transition Flow

**Current (incorrect)**:

```
on_tool_start → PENDING → on_tool_end → COMPLETED
```

**After fix (correct)**:

```
on_tool_start → RUNNING → on_tool_end → COMPLETED/FAILED
```

### CLI Already Handles RUNNING

The CLI in [client-apps/cli/cmd/stigmer/root/run.go](client-apps/cli/cmd/stigmer/root/run.go) already supports all statuses:

```1682:1695:client-apps/cli/cmd/stigmer/root/run.go
	switch toolCall.Status {
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_PENDING:
		icon = "⏳"
		statusText = "Queued"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING:
		icon = "⚙️"
		statusText = "Running"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED:
		icon = "✓"
		statusText = "Complete"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED:
		icon = "✗"
		statusText = "Failed"
	}
```

## Implementation

### File to Modify

[backend/services/agent-runner/worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)

### Change 1: Update Initial Status (Line 163)

Change from:

```python
status=ToolCallStatus.TOOL_CALL_PENDING,
```

To:

```python
status=ToolCallStatus.TOOL_CALL_RUNNING,
```

### Change 2: Add Structured Logging for Observability

Following the established pattern (`[USAGE]`, `[STREAM]`, `[RETRY]`), add `[TOOL]` prefix logging:

```python
self.logger.debug(
    f"[TOOL] execution={self.execution_id} "
    f"tool={tool_name} run_id={run_id} status=RUNNING"
)
```

And in `_handle_tool_end_event`:

```python
self.logger.debug(
    f"[TOOL] execution={self.execution_id} "
    f"tool={tool_name} run_id={run_id} status=COMPLETED "
    f"duration_ms={duration_ms}"
)
```

### Change 3: Calculate Tool Execution Duration

Track tool start times (similar to message start times in Phase 1.1) and calculate duration on completion:

```python
# In __init__
self._tool_start_times: Dict[str, datetime] = {}  # Key: run_id

# In _handle_tool_start_event
self._tool_start_times[run_id] = datetime.utcnow()

# In _handle_tool_end_event
duration_ms = None
if run_id in self._tool_start_times:
    start_time = self._tool_start_times.pop(run_id)
    duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
```

**Note**: ToolCall proto already has `started_at` and `completed_at` fields but no `duration_ms`. The duration is calculated for logging/observability only.

## Unit Tests

Add tests to [backend/services/agent-runner/tests/test_status_builder.py](backend/services/agent-runner/tests/test_status_builder.py):

### Test Class: TestToolCallStatus

- `test_tool_start_sets_running_status` - Verify RUNNING on tool start
- `test_tool_start_sets_started_at_timestamp` - Verify started_at is set
- `test_tool_end_sets_completed_status` - Verify COMPLETED on tool end
- `test_tool_end_sets_completed_at_timestamp` - Verify completed_at is set
- `test_tool_status_in_messages_list` - Verify status in messages[].tool_calls
- `test_tool_status_in_tool_calls_list` - Verify status in status.tool_calls
- `test_tool_duration_tracking` - Verify duration calculated correctly

## Scope Boundaries

**In scope**:

- Change initial status from PENDING to RUNNING
- Add structured logging for tool lifecycle
- Track tool execution duration for observability
- Comprehensive unit tests

**Out of scope** (future work):

- Detecting tool failures and setting FAILED status (requires analyzing tool output)
- Adding `duration_ms` field to ToolCall proto (would require proto change + stub regeneration)
- PENDING status for queued tools (LangGraph doesn't have a queuing concept)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |

|------|------------|--------|------------|

| Behavioral change breaks frontend | Low | Low | CLI/Mobile already handle RUNNING |

| Existing tests fail | Low | Low | No tests explicitly check for PENDING |

| Metrics/alerts on PENDING status | Low | Medium | Search codebase - none found |

## Success Criteria

- Tools show "Running" (not "Queued") during execution in CLI
- Structured logging provides visibility into tool lifecycle
- All existing tests pass (14 + 44 + 62 + 5 = 125 tests)
- New tests cover tool status transitions (7 new tests)
- No proto changes required (RUNNING already defined)