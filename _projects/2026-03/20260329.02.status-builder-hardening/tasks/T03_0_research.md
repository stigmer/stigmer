# T03: Namespace Injection Feasibility Research

**Created**: 2026-03-29
**Status**: COMPLETE
**Type**: Research (no code changes to production)
**Depends on**: None
**Blocks**: T05 (Replace namespace heuristics with deterministic routing)

## Research Question

Can we replace the 4-strategy heuristic cascade in `_register_sub_agent_namespace`
with a deterministic mechanism for mapping LangGraph namespace strings to
sub-agent identities?

## Answer: YES — via `parent_ids` on v2 events (Approach B)

The `parent_ids` field on v2 `astream_events` events traces the full callback
chain from sub-agent events back to the parent invocation context.  When a
sub-agent event arrives with a new multi-segment namespace, StatusBuilder can
check `parent_ids` for a known task tool `run_id` (already stored in
`_active_sub_agents`) to establish the mapping deterministically.

This eliminates strategies 2–4 of the current heuristic cascade.  Strategy 1
(root-prefix matching for subsequent events from an already-registered
sub-agent) is replaced with full namespace string deduplication — but see
the important caveat about shared namespace roots below.

---

## Full Framework Trace

### How LangGraph constructs `langgraph_checkpoint_ns`

Namespace strings are built in `prepare_single_task` (`langgraph/pregel/_algo.py`).
The formula:

```
checkpoint_ns = parent_ns | node_name
task_checkpoint_ns = checkpoint_ns : task_id
```

Delimiters: `|` (pipe) separates hierarchy levels, `:` separates each level
from its task ID.  `node_name` is the key passed to `add_node("key", runnable)`
on the parent graph.  The full `task_checkpoint_ns` is stored as
`metadata["langgraph_checkpoint_ns"]` on every v2 event.

### How sub-agents are invoked (deepagents architecture)

Sub-agents are **not** separate nodes on the parent graph.  deepagents creates
a single `task` tool via `SubAgentMiddleware`.  Each sub-agent is invoked
inside the tool function body via `subagent.ainvoke(subagent_state)`.

The call chain in production:

```
Parent graph (Pregel)
  → tools node
    → task tool (on_tool_start event — StatusBuilder records run_id)
      → _GatedRunnable.ainvoke()  (SubAgentGate concurrency wrapper)
        → InterruptProxyRunnable.ainvoke()  [to be eliminated]
          → inner_graph.ainvoke(input, config=merged)
            → sub-agent internal nodes produce events
```

After InterruptProxyRunnable is eliminated (separate project), the chain
simplifies to:

```
Parent graph (Pregel)
  → tools node
    → task tool (on_tool_start event — StatusBuilder records run_id)
      → _GatedRunnable.ainvoke()
        → compiled_subagent.invoke(input)  [checkpointer=None, inherits parent]
          → sub-agent internal nodes produce events
```

### What `parent_ids` contains on sub-agent events

The `_AstreamEventsCallbackHandler` builds `parent_ids` by walking the
`RunInfo.parent_run_id` chain in its `_run_map`.  When a sub-agent graph
inherits the parent's callbacks (via config), its events fire through the
same handler, and the `parent_run_id` chain links back through:

1. Sub-agent internal node run
2. Sub-agent graph root run (unique per invocation)
3. Task tool run ← **StatusBuilder knows this from `_handle_sub_agent_start`**
4. Parent tools node run
5. Parent graph root run

Verified by test: `test_parent_ids_link_subagent_events_to_parent_context`
(passes on LangGraph 1.1.2).

### What namespace strings look like (empirical)

From test `test_multiple_subagents_have_distinct_namespaces_and_parent_ids`,
with two sub-agents invoked sequentially from the same parent node:

| Sub-agent | `langgraph_checkpoint_ns` |
|-----------|---------------------------|
| A (work_a) | `tools_node:a503b567...\|work_a:f074cf43...` |
| B (work_b) | `tools_node:a503b567...\|1\|work_b:a92c9e60...` |

Key observations:

- **Namespace roots are SHARED**: both start with `tools_node` because both
  are invoked from the same parent node.  In production this will be `tools`
  (the LangGraph tools node where all task tool invocations execute).

- **Full namespace paths are DISTINCT**: LangGraph assigns unique task IDs
  per invocation and appends a sequential counter (`|1|`) for subsequent
  invocations from the same parent task.

- **`parent_ids` chains are DISTINCT**: the deepest parent ID differs per
  sub-agent invocation (unique sub-agent graph root run_id).

---

## Why Root-Prefix Matching Is Insufficient

The current StatusBuilder strategy 1 (root-prefix matching) assumes that
the namespace root uniquely identifies a sub-agent.  This is **wrong** when
multiple sub-agents are invoked from the same parent node:

```
Sub-agent A namespace root: tools_node
Sub-agent B namespace root: tools_node  ← SAME ROOT
```

Root-prefix matching would map sub-agent B's events to sub-agent A (whichever
was registered first).  This explains why strategies 2–4 (substring matching,
FIFO causal correlation, sole-active fallback) were needed as compensating
complexity.

With `parent_ids`, the disambiguation is at the per-invocation level:

```
Sub-agent A parent_ids: [..., task_tool_A_run_id, sub_a_graph_root]
Sub-agent B parent_ids: [..., task_tool_B_run_id, sub_b_graph_root]
```

StatusBuilder knows `task_tool_A_run_id` and `task_tool_B_run_id` from
`_handle_sub_agent_start`, so it can deterministically map each namespace
to the correct sub-agent.

---

## Proposed Approach for T05

### Registration: `parent_ids` lookup for every new namespace

When `_register_sub_agent_namespace` encounters a new multi-segment namespace:

```python
def _register_sub_agent_namespace(self, namespace: str, event: dict) -> None:
    if not namespace or namespace in self._namespace_to_sub_agent_id:
        return

    if "|" not in namespace:
        return  # Single-segment = main-agent graph node

    parent_ids = event.get("parent_ids", [])
    for pid in parent_ids:
        if pid in self._active_sub_agents:
            self._namespace_to_sub_agent_id[namespace] = pid
            return
        if pid in self._completed_sub_agents:
            self._namespace_to_sub_agent_id[namespace] = pid
            return
```

This is O(P × S) where P = len(parent_ids) (typically 3–5) and
S = number of active sub-agents (typically 1–3).  Negligible cost.

### Lookup: exact match (unchanged)

`_get_execution_context` already does an exact dict lookup on the full
namespace string.  No change needed.

### What gets deleted from StatusBuilder

| Structure | Purpose | Lines |
|-----------|---------|-------|
| `_pending_sub_agent_ids` (list) | FIFO queue for causal correlation (strategy 3) | ~412–414 |
| `_warned_namespaces` (set) | Deduplicate namespace warnings | ~421–422 |
| Strategies 2–4 in `_register_sub_agent_namespace` | Substring, FIFO, sole-active fallback | ~2718–2770 |
| `_subject_counts` (dict) | Remains — unrelated to namespace routing | — |

Strategy 1 (root-prefix matching) is also deleted — `parent_ids` handles
all registrations, including subsequent namespace variants from the same
sub-agent.

### What stays the same

- `_namespace_to_sub_agent_id` dict (key: full namespace string → value: run_id)
- `_get_execution_context` lookup logic
- `_active_sub_agents` / `_completed_sub_agents` lifecycle management
- `_handle_sub_agent_start` / `_handle_sub_agent_end`
- `_run_id_to_tool_call_id` bridge

### API change to `process_event`

`_register_sub_agent_namespace` needs access to the full event dict (for
`parent_ids`), not just the namespace string.  The call in `process_event`
changes from:

```python
if namespace:
    self._register_sub_agent_namespace(namespace)
```

to:

```python
if namespace:
    self._register_sub_agent_namespace(namespace, event)
```

---

## Connection to InterruptProxyRunnable Elimination

A separate project is eliminating `InterruptProxyRunnable` in favor of
LangGraph's native per-invocation subgraph support (`checkpointer=None`).
This T03 research was conducted **assuming the proxy will be eliminated**.

The key interaction: with native per-invocation mode, the sub-agent graph
inherits the parent's callbacks via the config chain.  This is what makes
`parent_ids` work — the sub-agent's events fire through the same
`_AstreamEventsCallbackHandler` as the parent, preserving the parent_run_id
chain.

If the proxy were kept, `InterruptProxyRunnable.ainvoke()` explicitly merges
the parent config (`merge_configs(parent_ctx, sa_config)`), which also
preserves callbacks.  So `parent_ids` would work in both cases.  But the
proxy elimination makes the mechanism simpler and removes a coupling point.

---

## Verification

### Tests added

Two new test classes in `test_native_subgraph_interrupt.py`:

1. **`TestT03NamespaceFormat::test_namespace_is_multi_segment_with_consistent_root`**
   Confirms `langgraph_checkpoint_ns` on sub-agent events contains `|`
   (multi-segment) with a consistent root per invocation.

2. **`TestT03ParentIdsRouting`** (two tests):
   - `test_parent_ids_link_subagent_events_to_parent_context` — confirms
     `parent_ids` traces back to known main-agent run_ids.
   - `test_multiple_subagents_have_distinct_namespaces_and_parent_ids` —
     confirms two sub-agents from the same parent node produce distinct
     full namespace paths and distinct `parent_ids` chains.

All 8 tests pass on LangGraph 1.1.2 in 0.16s.

### LangGraph version

| Package | Pinned (pyproject.toml) | Installed (.venv) |
|---------|-------------------------|-------------------|
| langgraph | >=1.0.0,<2.0.0 | 1.1.2 |
| langchain-core | (via langchain dep) | 1.2.19 |

---

## Surprise: Namespace Roots Are Shared

The original T03 plan hypothesized that namespace injection (Approach A:
inject `checkpoint_ns` in `InterruptProxyRunnable`) could give each sub-agent
a unique namespace root.  The research revealed this is unnecessary AND
would not work with the proxy elimination (no proxy = nowhere to inject).

More importantly, the test data showed that namespace roots are inherently
shared when sub-agents are invoked from the same parent node.  This is
fundamental to LangGraph's architecture, not a quirk.  The correct
disambiguation mechanism is `parent_ids`, not namespace roots.

---

## Conclusion

T03 research is **complete with a confirmed path forward**:

1. **`parent_ids` works**: v2 events from sub-agent graphs include the full
   callback chain tracing back to the parent invocation context.
2. **Approach B confirmed**: StatusBuilder can use `parent_ids` to
   deterministically map new namespaces to sub-agents without heuristics.
3. **Approach A discarded**: `checkpoint_ns` injection is unnecessary,
   couples to a component being eliminated, and wouldn't solve the shared-root
   problem anyway.
4. **T05 is unblocked**: the 4-strategy heuristic cascade can be replaced
   with a single `parent_ids` lookup.  Estimated deletion: ~100-150 lines
   of heuristic code, 2 tracking structures (`_pending_sub_agent_ids`,
   `_warned_namespaces`).
