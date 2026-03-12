# Detect Abnormal Graph Termination and Report Accurate Execution Status

**Date**: March 12, 2026

## Summary

When the LangGraph event stream ends silently (due to context overflow, unhandled exceptions inside nodes, or other internal failures), the execution was incorrectly marked as `EXECUTION_COMPLETED` even when sub-agents were still tracked as in-progress. This fix adds post-stream reconciliation that detects orphaned sub-agents and correctly reports `EXECUTION_FAILED` with differentiated sub-agent statuses.

## Problem Statement

The observation layer in `execute_graphton.py` could not distinguish between "graph completed normally" and "graph crashed internally and the stream ended silently." The finalization code blindly set `EXECUTION_COMPLETED` for any non-WAITING/non-PAUSED stream end.

### Pain Points

- Production execution `aex-01kkg22yeeez6579b8mcaz5bwt` was marked `EXECUTION_COMPLETED` with 9 of 14 sub-agents still `IN_PROGRESS`
- Some sub-agents were spawned 1-2 seconds before termination with zero messages — never actually executed
- Users saw a "completed" status when the agent had clearly not finished its work
- No error message explaining what happened, making debugging impossible

## Solution

Added a post-stream reconciliation step that validates execution state before setting the final phase. Active sub-agents at stream end is **always** abnormal in a healthy execution (sub-agents are synchronous subgraphs), making orphan detection a reliable signal for silent termination.

## Implementation Details

### StatusBuilder Enhancements (`status_builder.py`)

- **`has_orphaned_sub_agents`** property — returns `True` when `_active_sub_agents` is non-empty after the event stream ends
- **`get_orphaned_sub_agents_diagnostic()`** — returns structured diagnostics: total count, zero-message vs mid-execution breakdown, per-sub-agent details (run_id, subject, message/tool call counts)
- **`finalize_active_sub_agents_differentiated(error_context)`** — new method that applies different terminal statuses based on sub-agent activity:
  - Zero-message sub-agents (spawned but never executed) → `SUB_AGENT_CANCELLED`
  - Mid-execution sub-agents (have messages/tool calls) → `SUB_AGENT_FAILED`
- Original `finalize_active_sub_agents()` preserved for existing error paths (stall, recursion limit, generic exception)

### Post-Stream Reconciliation (`execute_graphton.py`)

Replaced the blind `EXECUTION_COMPLETED` assignment with a reconciliation block:

1. `WAITING_FOR_APPROVAL` / `PAUSED` → preserved (unchanged)
2. Orphaned sub-agents detected → `EXECUTION_FAILED` with descriptive error, sub-agents finalized with differentiated statuses, diagnostic details logged at ERROR level
3. No orphans → `EXECUTION_COMPLETED` (validated happy path)

### Test Suite (`test_status_builder.py`)

Added `TestOrphanedSubAgentDetection` class with 13 tests covering:
- Orphan detection: empty, all completed, active, mixed completed-and-active
- Diagnostic classification: zero-message, mid-execution, mixed
- Differentiated finalization: CANCELLED for zero-message, FAILED for mid-execution, mixed, no-op, timestamp verification
- Regression: original `finalize_active_sub_agents` still applies uniform status

## Benefits

- **Accurate execution status**: Silent terminations now correctly report `EXECUTION_FAILED` instead of `EXECUTION_COMPLETED`
- **User-visible error messages**: Descriptive error explaining how many sub-agents were orphaned and their state
- **Differentiated sub-agent statuses**: Users see which sub-agents were cancelled (never started) vs failed (mid-execution)
- **Observability**: ERROR-level logs with structured diagnostics for debugging production incidents
- **Backward-compatible**: Existing error handling paths (stall, recursion limit, generic exception) are unchanged

## Impact

- **Users**: No longer see false "completed" status when the agent terminated abnormally
- **CLI**: Error message rendered in the terminal explaining what happened
- **Debugging**: Production incidents like `aex-01kkg22yeeez6579b8mcaz5bwt` would now be immediately identifiable as failures rather than appearing as successful completions
- **Architecture**: Validates that the sub-agent execution model (synchronous subgraphs via `interrupt_proxy.py`) is correct — the bug was only in the observation layer

## Related Work

- Part of project `20260312.01.agent-execution-consistency-guardrails` (PR5 of 5)
- Previous PRs in the project fixed: dead loop detection middleware (PR1), mid-execution context compaction (PR2), recursion limit inflation (PR3)
- Remaining: PR4 (sub-agent completion UX in CLI)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (including forensic analysis of production data)
