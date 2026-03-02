# Fix Sub-Agent Tool Approval Not Shown in CLI

**Date**: March 2, 2026

## Summary

Sub-agent tool approvals (e.g., a sub-agent's "write" tool) were silently dropped and never shown to the user. The backend's post-stream interrupt capture loop only searched top-level tool calls when matching LangGraph interrupts to tool call IDs, producing a `PendingApproval` with an empty `tool_call_id`. The CLI then skipped it because its deduplication guard treated empty IDs as invalid.

## Problem Statement

When a sub-agent (e.g., `general-purpose`) invoked a tool requiring approval (e.g., `write`), the CLI showed the sub-agent as working but never displayed the approval prompt. The execution appeared stuck, with the backend correctly in `WAITING_FOR_APPROVAL` phase but the user having no way to respond.

### Root Cause

Three interacting defects across the approval pipeline:

1. **Backend interrupt capture only searched top-level tool calls** (`execute_graphton.py`, line 2780). Sub-agent tool calls live in `sub_agent_executions[].tool_calls`, not the top-level `tool_calls` list. The matching loop never found them, leaving `matched_tool_call_id` as `""`.

2. **CLI silently skipped approvals with empty `tool_call_id`** (`run_stream_events.go`, line 140). The guard `pa.ToolCallId == ""` was intended to skip malformed entries but had no fallback key, so sub-agent approvals were dropped without any log or error.

3. **Backend idempotency check only searched top-level tool calls** (`submit_approval.go`, line 180). A latent defect: re-submitted approvals for sub-agent tools would never be detected as idempotent.

### Impact

- All sub-agent tool approvals were invisible to users.
- Executions involving sub-agents that triggered approval-requiring tools appeared permanently stuck.
- No error was logged on the CLI side, making the issue difficult to diagnose.

## Solution

### 1. Backend: Extend interrupt capture to search sub-agent tool calls

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

After the existing top-level `tool_calls` search, added a fallback search through `sub_agent_executions[].tool_calls` using the same alias-aware matching criteria. This mirrors the pattern already used by `_find_tool_call_by_id` in `status_builder.py`.

### 2. CLI: Resilient deduplication with `interrupt_id` fallback

**File**: `client-apps/cli/cmd/stigmer/root/run_stream_events.go`

Introduced `approvalDedupKey()` that prefers `tool_call_id` but falls back to `interrupt_id` (which is always unique per LangGraph interrupt). Added debug logging when the fallback is used. This makes the CLI resilient even if a future edge case produces an empty `tool_call_id`.

### 3. Backend: Idempotency check covers sub-agent tool calls

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go`

Extracted `findToolCallInExecution()` helper that searches both top-level and sub-agent tool calls. Used it in the idempotency check and the audit-log tool name lookup, both of which previously only searched top-level.

## Files Changed

| File | Change |
|------|--------|
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Extend interrupt capture loop to search sub-agent tool calls |
| `client-apps/cli/cmd/stigmer/root/run_stream_events.go` | Add `approvalDedupKey()` with `interrupt_id` fallback; pass dedup key through `emitAndWaitApproval` |
| `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go` | Extract `findToolCallInExecution()` helper; use in idempotency check and audit log |
