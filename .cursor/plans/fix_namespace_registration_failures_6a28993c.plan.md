---
name: Fix namespace registration failures
overview: "The `[NS_DIAG] Namespace registration failed` flood in status_builder.py is caused by a gap in the namespace-to-sub-agent mapping strategy: when a sub-agent produces events with multiple different namespace roots, only the first root gets registered (via causal correlation), and all subsequent different-root namespaces fail all three strategies. This misroutes sub-agent events to the main agent context, affecting status tracking, token attribution, and UI accuracy."
todos:
  - id: strategy-4
    content: Add Strategy 4 (sole-active-agent fallback) to _register_sub_agent_namespace() in status_builder.py
    status: completed
  - id: diag-logging
    content: "Improve [NS_DIAG] logging: change to WARNING, deduplicate with _warned_namespaces"
    status: completed
  - id: tests
    content: "Add test cases for Strategy 4: single sub-agent multi-root namespaces, multi-sub-agent no-fallback, log deduplication"
    status: completed
isProject: false
---

# Fix Namespace Registration Failures in StatusBuilder

## Root Cause Analysis

The error originates from [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) `_register_sub_agent_namespace()` (line 2244).

The method uses three strategies to map LangGraph checkpoint namespaces to sub-agent IDs:

1. **Root-prefix matching** - same root as an already-registered namespace
2. **Substring matching** - sub-agent run_id appears in the namespace string
3. **Causal correlation** - first unregistered multi-segment namespace inherits `_pending_sub_agent_id`

**The gap:** Strategy 3 consumes `_pending_sub_agent_id` on the first registration (line 2308). When the sub-agent later produces events from a **different namespace root** (which is normal -- LangGraph sub-graphs emit events from multiple internal nodes, each with distinct namespace prefixes), all three strategies fail:

- Strategy 1 fails: different root than the first registered namespace
- Strategy 2 fails: the sub-agent `run_id` (`019c961f-...`) doesn't appear in the namespace string (`namespace-tools:5bf93eea-...|...`)
- Strategy 3 fails: `_pending_sub_agent_id` is already `None`

This produces the flood of `[NS_DIAG]` logs visible in the screenshot, with `active_sub_agents=['019c961f-...']` but `pending=None`.

## Impact (Why This Matters)

This is not just log noise -- it causes **real data routing errors**:

- **Misattributed events**: Sub-agent tool calls and LLM messages fall through to `_get_execution_context()` fallback (line 2242), which routes them to the **main agent** context instead of the sub-agent
- **Inaccurate status tracking**: Sub-agent sections in the UI show incomplete activity; main agent section shows activity that doesn't belong to it
- **Wrong token attribution**: Token usage from sub-agent LLM calls gets counted against the main agent
- **Scaling risk**: As agents spawn more sub-agents with complex graph structures, the problem gets proportionally worse

## Proposed Fix

Add **Strategy 4: Sole-active-agent fallback** to `_register_sub_agent_namespace()` in [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py).

The logic: when all three existing strategies fail, if exactly **one** sub-agent is active, the multi-segment namespace must belong to it (there's no other candidate). This is a safe, zero-ambiguity heuristic.

```python
# Strategy 4: sole-active-agent fallback.
# When exactly one sub-agent is active, all multi-segment namespaces
# must originate from it -- there is no other candidate.
if is_multi_segment and len(self._active_sub_agents) == 1:
    sub_agent_id = next(iter(self._active_sub_agents))
    self._namespace_to_sub_agent_id[namespace] = sub_agent_id
    self.logger.debug(
        f"[SUBAGENT] Sole-active fallback: namespace={namespace} "
        f"-> sub_agent={sub_agent_id}"
    )
    return
```

Insert this between the current Strategy 3 block (line 2313) and the diagnostic log (line 2315).

## Secondary Improvement: Reduce Log Noise for Remaining Failures

After adding Strategy 4, the `[NS_DIAG]` log should only fire in the **multi-sub-agent ambiguity** case (2+ active sub-agents and no match). This is a genuine warning worth keeping, but should be:

- Changed from `INFO` to `WARNING` (it indicates actual routing failure)
- Deduplicated using `_warned_namespaces` (log once per unique namespace, not per event)

## Files to Change

- [backend/services/agent-runner/worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) -- add Strategy 4 and improve diagnostic logging
- [backend/services/agent-runner/tests/test_status_builder.py](backend/services/agent-runner/tests/test_status_builder.py) -- add test cases for:
  - Sole-active-agent fallback with multiple namespace roots
  - Multi-sub-agent case where fallback should NOT apply
  - Verify that deduplication prevents log flooding

## What This Does NOT Change

- No changes to the LangGraph integration, event processing pipeline, or proto definitions
- The three existing strategies remain unchanged and retain priority
- Strategy 4 only activates when all three fail AND exactly one sub-agent is active
