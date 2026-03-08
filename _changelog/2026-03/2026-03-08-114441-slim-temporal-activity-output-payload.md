# Slim Temporal Activity Output: Eliminate Large ExecuteGraphton Return Payloads

**Date**: March 8, 2026

## Summary

The `ExecuteGraphton` Temporal activity now returns a slim `AgentExecutionStatus` containing only workflow-critical fields (phase, pending_approvals, error, usage, timestamps). Heavy fields like messages, tool_calls, sub_agent_executions, todos, artifacts, and context_info are stripped from the return value because they are already persisted to the database via progressive gRPC updates during execution. This eliminates the "Complete result exceeds size limit" error that occurred when agents interacted with large MCP tool catalogs.

## Problem Statement

The `ExecuteGraphton` activity was returning the full `AgentExecutionStatus` proto as its Temporal activity result. For agents working with large MCP server catalogs (e.g., the Planton MCP server with 100 tools and rich JSON schemas), the accumulated messages and tool_call results in the status easily exceeded Temporal's ~2 MB payload size limit, causing the activity to fail with:

```
Error: activity 'ExecuteGraphton' failed: Complete result exceeds size limit
```

The Feb 15 "Slim Temporal Activity Payloads" change had already fixed the **input** side (sending only `execution_id` instead of the full `AgentExecution` proto), but the **output** side still returned the full status.

## Solution

Added a `_slim_status_for_temporal()` helper in the Python activity that creates a lightweight copy of the status containing only the fields the Go/Java workflows actually use:

- `phase` — drives the HITL approval loop and failure detection
- `pending_approvals` — determines signal collection count and parent notification
- `error` — logged on failure paths
- `usage` — small token usage metadata
- `started_at` / `completed_at` — timestamps

All return paths (5 total) now call this helper before returning.

### Payload Size Comparison

| Path | Before | After | Reduction |
|------|--------|-------|-----------|
| Normal completion | 200 KB - 2+ MB | ~1-5 KB | 99%+ |
| HITL approval return | 200 KB - 2+ MB | ~2-5 KB | 99%+ |
| Error / failure | 5-50 KB | ~1 KB | 90%+ |

### Safety of `persistFinalStatus`

The existing belt-and-suspenders `persistFinalStatus` calls in both Go and Java workflows remain unchanged. The `UpdateExecutionStatus` merge logic is conditional on non-empty repeated fields (`if len(statusUpdates.GetMessages()) > 0`), so a slim status with empty messages/tool_calls will not overwrite the full data already in the database from gRPC updates.

## Implementation Details

### stigmer repo

**1. Python Activity** (`backend/services/agent-runner/worker/activities/execute_graphton.py`)
- Added `_slim_status_for_temporal()` helper function
- Updated all 5 return paths to wrap through the helper
- Diagnostic logging still logs full counts from `status_builder.current_status` before slimming

**2. Go Activity Interface** (`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/execute_graphton.go`)
- Updated docstring to document slim output pattern alongside existing slim input pattern

**3. Go Workflow** (`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`)
- Removed `messages` and `tool_calls` count from diagnostic logging (always 0 in slim result)
- All phase, pending_approvals, and error logic unchanged

### stigmer-cloud repo

**4. Java Activity Interface** (`ExecuteGraphtonActivity.java`)
- Updated Javadoc to document slim output pattern

**5. Java Workflow** (`InvokeAgentExecutionWorkflowImpl.java`)
- Removed `getMessagesCount()` and `getToolCallsCount()` from diagnostic logging
- Removed messages count from external activity completion result string
- All phase, pending_approvals, and error logic unchanged

**6. Java Tests** — No changes needed. Test assertions only verify `phase` and `pendingApprovalsCount`, both of which are kept in the slim status.

## Deployment

Backward-compatible change — the return type stays `AgentExecutionStatus` (no interface change). Python returns fewer populated fields; Go/Java workflows that only read phase/pending_approvals work identically.

**Deployment order:** Python agent-runner first (fixes the payload limit error immediately), then Go/Java workflow services (logging cleanup). No coordination required.

## Related Work

- **Slim Activity Input** (Feb 15, 2026): Changed activity input from full `AgentExecution` to `execution_id` string — this change completes the pattern by slimming the output as well.
- **Claim Check Pattern** (workflow-runner): Offloads large payloads to R2 storage — a different approach for the workflow-runner service, not applicable to agent-runner.
