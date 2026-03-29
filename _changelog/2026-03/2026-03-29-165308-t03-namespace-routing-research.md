# T03: Deterministic Namespace Routing via parent_ids

**Date**: March 29, 2026

## Summary

Completed T03 research for the StatusBuilder hardening project, confirming that `parent_ids` on LangGraph v2 events provides a deterministic mechanism for mapping namespace strings to sub-agent identities. This eliminates the need for the 4-strategy heuristic cascade currently in `_register_sub_agent_namespace`, unblocking T05 (namespace heuristic deletion).

## Problem Statement

StatusBuilder's `_register_sub_agent_namespace` uses a 4-strategy heuristic cascade to map LangGraph namespace strings to sub-agent identities:

1. Root-prefix matching (correct but depends on initial registration)
2. Substring matching (run_id in namespace string)
3. FIFO causal correlation (`_pending_sub_agent_ids` queue)
4. Sole-active-agent fallback

### Pain Points

- Strategies 2-4 are heuristic — they can misroute events under concurrent sub-agent execution
- Root-prefix matching (strategy 1) is inherently wrong for concurrent sub-agents because namespace roots are shared across all sub-agents invoked from the same parent node
- The FIFO queue and sole-active fallback are compensating complexity for incorrect modeling
- ~150 lines of heuristic code plus 2 tracking structures (`_pending_sub_agent_ids`, `_warned_namespaces`)

## Solution

Use `parent_ids` on v2 `astream_events` events for deterministic first-event namespace registration. When a new multi-segment namespace arrives, check its `parent_ids` for a known task tool `run_id` (already in `_active_sub_agents` from `_handle_sub_agent_start`). Single lookup, zero heuristics.

## Research Findings

### Framework trace

- LangGraph constructs `langgraph_checkpoint_ns` as `parent_ns | node_name : task_id` in `prepare_single_task`
- Sub-agents in deepagents are NOT graph nodes — they run inside the `task` tool function body
- The `_AstreamEventsCallbackHandler` builds `parent_ids` by walking the `RunInfo.parent_run_id` chain
- Sub-agent events inherit the parent's callback handler via config, so the chain is intact

### Key surprise: namespace roots are shared

Two sub-agents invoked from the same parent node produce:

```
Sub-agent A: tools_node:<task_id>|work_a:<task_id>
Sub-agent B: tools_node:<task_id>|1|work_b:<task_id>
```

Same root (`tools_node`), different full paths. Root-prefix matching was architecturally wrong for disambiguation. `parent_ids` differs per invocation, providing the correct identity mechanism.

### Approach A (checkpoint_ns injection) discarded

Originally hypothesized injecting `checkpoint_ns` into `InterruptProxyRunnable._current_thread_config()`. Discarded because: (1) unnecessary — `parent_ids` already works, (2) couples to a component being eliminated, (3) wouldn't solve the shared-root problem anyway.

## Implementation Details

### Tests added

Three new test classes in `test_native_subgraph_interrupt.py`:

- `TestT03NamespaceFormat` — confirms multi-segment `langgraph_checkpoint_ns` with consistent root
- `TestT03ParentIdsRouting::test_parent_ids_link_subagent_events_to_parent_context` — confirms `parent_ids` traces back to known main-agent run_ids
- `TestT03ParentIdsRouting::test_multiple_subagents_have_distinct_namespaces_and_parent_ids` — confirms distinct full namespace paths and distinct `parent_ids` chains for concurrent sub-agents

All 8 tests pass on LangGraph 1.1.2 in 0.16s.

### Research document

Full framework trace, proposed approach, and T05 impact documented in `tasks/T03_0_research.md`.

## Benefits

- T05 can replace ~150 lines of heuristic code with a ~10-line `parent_ids` lookup
- Eliminates 2 tracking structures (`_pending_sub_agent_ids`, `_warned_namespaces`)
- Zero heuristic namespace matching — all routing is identity-based
- Works with both current architecture and post-InterruptProxy-elimination architecture

## Impact

- **StatusBuilder hardening project**: T03 complete, T05 unblocked
- **InterruptProxy elimination project**: T03 findings complement — `parent_ids` works regardless of whether the proxy exists
- **No production code changes**: Research phase only — tests and documentation

## Related Work

- T02 research (`_projects/2026-03/20260329.02.status-builder-hardening/tasks/T02_0_research.md`): Confirmed `ToolCallIdCapture` callback handler approach
- T04 implementation: Replaced fingerprint dedup with identity-based lookup (-197 lines)
- InterruptProxy elimination (separate project): Deleting `InterruptProxyRunnable` in favor of LangGraph native per-invocation subgraph support

---

**Status**: Research Complete
**Timeline**: ~2 hours (exploration + test writing + documentation)
