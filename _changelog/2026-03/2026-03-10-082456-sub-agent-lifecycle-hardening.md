# Sub-Agent Lifecycle Hardening (PR3)

**Date**: March 10, 2026

## Summary

Hardened the sub-agent lifecycle in StatusBuilder to handle edge cases around event ordering, parent termination, and namespace routing. Late-arriving events now route to the correct completed sub-agent instead of polluting the main agent. Active sub-agents are properly transitioned to terminal states when the parent execution fails or stalls.

## Problem Statement

The sub-agent execution model had several lifecycle gaps that could result in silent data corruption or lost context:

### Pain Points

- **Lost completions**: `_handle_sub_agent_end` silently dropped unmatched `run_id` values with no warning, making it impossible to diagnose why a sub-agent was stuck in `IN_PROGRESS` forever.
- **Late event misattribution**: When a sub-agent completed, all its namespace mappings were immediately deleted. LangGraph event ordering is not strictly guaranteed — events arriving after `on_tool_end` (e.g., `on_chat_model_end` finalizing a streamed message) had no namespace mapping, fell through to main agent context, and were misattributed.
- **Orphaned sub-agents**: When the parent execution failed or stalled, active sub-agents remained in `IN_PROGRESS` in the persisted status indefinitely. Consumers could not tell whether a sub-agent was still running or was abandoned.
- **Missing status push**: Sub-agent completion did not set `force_next_update`, so the status change was not immediately pushed to consumers (unlike sub-agent start, which did set it).

## Solution

Four focused changes to `StatusBuilder` and `execute_graphton.py`, each addressing one gap:

1. **End-event guard** (Gap 8): Added a `found` flag to the `_handle_sub_agent_end` loop with a warning log when no `SubAgentExecution` matches the `run_id`. Added `force_next_update = True` for symmetry with `_handle_sub_agent_start`.

2. **Late event routing** (Gap 9): Introduced `_completed_sub_agents` dict. On completion, sub-agents are moved from `_active_sub_agents` to `_completed_sub_agents` instead of being deleted. Namespace mappings are preserved. `_get_execution_context` checks `_completed_sub_agents` as a fallback, so late events route to the correct sub-agent proto.

3. **Parent termination propagation** (Gap 10): Added `finalize_active_sub_agents(status, error)` method that transitions all active sub-agents to a terminal state. Called from the `TimeoutError` (stall) and `Exception` (error) handlers in `execute_graphton.py` with `SUB_AGENT_FAILED`.

4. **Namespace observability** (Gap 7): Added a test documenting the known limitation with concurrent sub-agents — when 2+ sub-agents are active and a namespace can't be resolved, the event falls through to main agent context with a warning.

## Implementation Details

### `_completed_sub_agents` lifecycle

```
on_tool_start("task") → _active_sub_agents[run_id] = proto
on_tool_end("task")   → _completed_sub_agents[run_id] = _active_sub_agents.pop(run_id)
                        (namespace mappings preserved)
parent error/stall    → finalize_active_sub_agents() moves all remaining to _completed
```

### `_get_execution_context` lookup order

1. `_namespace_to_sub_agent_id` → `_active_sub_agents` (primary path)
2. `_namespace_to_sub_agent_id` → `_completed_sub_agents` (late event path, debug logged)
3. Fall through to main agent context (unresolvable, warning logged for multi-segment namespaces)

### Architectural decisions

- **Pause handler left unchanged**: The `CancelledError` handler is a pause (EXECUTION_PAUSED), not a cancellation. Sub-agents are left as IN_PROGRESS on pause — resume-path reconstruction of routing state is deferred.
- **Misattribute over drop**: Unresolvable multi-segment namespaces continue to fall through to main agent. Changing to "drop" would require refactoring all callers of `_get_execution_context` and is deferred until production data shows this is a real problem.

## Benefits

- Late events from LangGraph no longer corrupt the main agent's tool_calls and messages
- Sub-agent completion is immediately pushed to consumers (no delayed status update)
- Orphaned sub-agents are now clearly marked FAILED with an explanatory error message
- Unmatched sub-agent completions produce a warning log for diagnostics
- The concurrent sub-agent failure mode is documented with a test, not just a code comment

## Impact

- **Agent Runner**: Sub-agent event routing is correct even when LangGraph emits events after `on_tool_end`
- **CLI/Consumers**: Sub-agent status is always terminal after parent termination — no more phantom IN_PROGRESS sub-agents
- **Observability**: Warning logs for unmatched completions and unresolvable namespaces enable production monitoring

## Related Work

- PR1: Proto model changes (SUB_AGENT_CANCELLED enum, pending_approvals field)
- PR2: Subject simplification and pending approvals dual-surfacing
- PR4 (next): CLI display changes — rename "Task" to "Sub-agent", show output, typed status enum

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
