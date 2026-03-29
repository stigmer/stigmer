# Fix InterruptProxyRunnable Callback Context Propagation

**Date**: March 29, 2026

## Summary

Fixed sub-agent tool calls not appearing in the UI by restoring callback context propagation in `InterruptProxyRunnable`. The gated general-purpose sub-agent change (`2026-03-29-080321`) introduced `InterruptProxyRunnable` which created an isolated config for inner graph invocations, severing the parent's `astream_events` callback manager and preventing sub-agent events from carrying proper namespace metadata.

## Problem Statement

After the gated general-purpose sub-agent change, sub-agent tool calls stopped appearing in the execution UI. The `SubAgentExecution.messages` field was empty in the `AgentExecutionStatus` proto, even though the sub-agent was running and completing work.

### Pain Points

- Sub-agent sections in the UI showed no tool calls, read operations, or intermediate messages
- `CHECKPOINT_VALIDATION` errors in production logs: "Graph has pending nodes ['tools'] but stream ended without WAITING_FOR_APPROVAL or PAUSED phase"
- `RESUME_ID_MISMATCH` warnings from misrouted sub-agent tool call IDs
- Executions ending in `FAILED` status due to phantom pending tool nodes in the parent graph's checkpoint

## Solution

Merged the parent's callback context with the sub-agent's thread config in `InterruptProxyRunnable.ainvoke()` instead of replacing it. This preserves checkpoint isolation (sub-agent gets its own `thread_id` for HITL) while restoring the callback chain that `astream_events` depends on for namespace-tagged event propagation.

## Implementation Details

### Root Cause

`InterruptProxyRunnable._current_thread_config()` returns a minimal config: `{"configurable": {"thread_id": "sa-general-purpose-0"}}`. When passed as `config=sa_config` to `self.inner_graph.ainvoke()`, this explicitly overrides any inherited callback context from the parent graph's `astream_events` session.

**Before the gated GP change:** deepagents called `subagent.ainvoke(state)` with no config. The compiled graph inherited the parent's callback manager via Python's `contextvars`. Events flowed properly through `astream_events` with correct `langgraph_checkpoint_ns` metadata.

**After the gated GP change:** The explicit `config=sa_config` parameter severed this automatic inheritance.

### The Fix

In `interrupt_proxy.py`, at the top of `ainvoke()`:

1. `ensure_config(config)` captures the parent's callback context (including the `astream_events` callback manager that carries namespace metadata)
2. `merge_configs(parent_ctx, sa_config)` layers the sub-agent's `thread_id` on top — the second argument's keys override, so checkpoint isolation is preserved

The merged config is used for all 3 `self.inner_graph.ainvoke()` call sites (resume, fresh, and post-interrupt resume). Checkpoint state lookups (`_safe_get_state`) continue to use the bare `sa_config` since they only need the `thread_id`.

When the thread counter advances (sequential sub-agent calls), `merged` is recomputed with the new `sa_config` to maintain the correct `thread_id`.

### Key Design Decision: Isolation Preserved

Two types of context in a LangChain config serve orthogonal purposes:

- **Checkpoint context** (`configurable.thread_id`): Controls state persistence. Sub-agents must be isolated. `sa_config` overrides `thread_id` in the merge — isolation preserved.
- **Callback context** (callback manager): Controls event observability. The parent needs to observe sub-agent events for UI rendering. `parent_ctx` provides the callback chain — observability restored.

## Files Changed

- `backend/libs/python/graphton/src/graphton/core/interrupt_proxy.py`
  - Added import: `ensure_config`, `merge_configs` from `langchain_core.runnables.config`
  - Added config merging at top of `ainvoke()`
  - Changed 3 `self.inner_graph.ainvoke()` calls from `config=sa_config` to `config=merged`
  - Added `merged` recomputation on thread counter advance

## Benefits

- **Sub-agent visibility restored**: Tool calls, read operations, and intermediate messages from sub-agents appear in the UI
- **Checkpoint validation fixed**: Sub-agent tool events route to the correct namespace, eliminating phantom pending nodes
- **No HITL regression**: Interrupt proxying continues to work with isolated checkpoint threads
- **Minimal change surface**: Single file, 4 lines of logic added

## Impact

- **Agent Runner**: All HITL agent executions with gated GP sub-agents now emit properly namespaced events
- **StatusBuilder**: `_register_sub_agent_namespace` receives multi-segment namespaces, enabling correct event routing to `SubAgentExecution` entries
- **Frontend**: `MessageThread` and `SubAgentSection` components receive populated `SubAgentExecution.messages` for rendering
- **Test suite**: All 1254 graphton tests pass

## Related Work

- `2026-03-29-080321-gated-general-purpose-sub-agent.md` — introduced `InterruptProxyRunnable` wrapper that caused this regression
- `2026-03-29-083706-fix-gp-subagent-compiled-without-tools.md` — follow-up fix for tool compilation in the same change

---

**Status**: ✅ Production Ready
**Timeline**: Single session
