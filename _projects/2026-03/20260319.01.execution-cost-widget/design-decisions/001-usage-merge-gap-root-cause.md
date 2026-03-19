# Design Decision 001: Usage Merge Gap Root Cause

**Date**: 2026-03-19
**Status**: Confirmed via code investigation

## Context

The question was raised whether cost/usage data updates happen live during execution or only at terminal state. Investigation revealed the answer is nuanced: **the Python worker sends usage on every update, but the Go server drops it**.

## Findings

### Python worker (sends usage progressively)

In `status_builder.py`, the `_handle_chat_model_end_event()` method calls `self._usage_tracker.record_llm_call()` after every LLM call and immediately updates `self.current_status.usage`. This status object is sent to the server on the hybrid update schedule (500ms / 50 events / force).

### Go server (drops usage during merge)

In `update_status.go`, the `BuildNewStateWithStatusStep` function merges incoming status fields selectively:

**Merged**: messages, tool_calls, sub_agent_executions, todos, artifacts, phase, error, started_at, completed_at, pending_approvals

**NOT merged**: usage, context_info, resolved_context

The incoming `usage` field is simply ignored. After merge, the execution is persisted and broadcast — without usage data.

### Result

- During streaming, `status.usage` is always empty/stale on the client
- At terminal state, `finalize_usage()` runs and the final status update includes usage — but since the merge still skips it, even the final usage may not persist correctly (depends on whether the full execution object is replaced at terminal state)

## Decision

Fix the merge to include `usage` (replace semantics — if incoming usage is non-nil, use it). Also fix `context_info` and `resolved_context` while at it — same gap, same pattern.

## Files to Change

- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/update_status_impl.go`
