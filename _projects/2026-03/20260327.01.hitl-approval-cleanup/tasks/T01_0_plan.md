# Task T01: Research — tool_call_id Availability at Interrupt Time

**Created**: 2026-03-27
**Status**: COMPLETE
**Depends on**: Nothing (first task)
**Blocks**: T04 (Add tool_call_id to interrupt payload)
**Execution log**: T01_2_execution.md

## Objective

Verify that `tool_call_id` (the ID the LLM assigns to a tool call, e.g., `call_abc123`) is accessible inside `_check_and_handle_approval` in `graphton/core/tool_wrappers.py` at the moment the LangGraph interrupt is raised.

This is the prerequisite for the entire architecture simplification. If we can include `tool_call_id` in the interrupt value, the fuzzy matching chain (run_id aliases, fingerprints, name fallback) is eliminated entirely.

## Context

Currently, the interrupt payload looks like:

```python
approval_request = {
    "tool_name": tool_name,
    "tool_args": tool_args,
    "message": requirement.message,
    "mcp_server": effective_server,
    "source": requirement.source,
    "from_sub_agent": from_sub_agent,
    "sub_agent_name": sub_agent_name if from_sub_agent else "",
    "run_id": run_id,
}
response = interrupt(approval_request)
```

`tool_call_id` is NOT in this payload. The `run_id` comes from `config.get("run_id", "")` which is LangGraph's internal run ID — not the tool_call_id from `AIMessage.tool_calls[].id`.

## Investigation Steps

1. **Trace the tool invocation path in LangGraph**
   - How does LangGraph's tool node invoke tool functions?
   - What is in the `RunnableConfig` at tool execution time?
   - Is `tool_call_id` available in `config["metadata"]`, `config["configurable"]`, or another location?

2. **Check LangChain/LangGraph source**
   - `langchain_core.tools.BaseTool.__call__` — what config does it receive?
   - `langgraph.prebuilt.tool_node` — how does it map AIMessage tool_calls to tool invocations?
   - Does the ToolNode pass `tool_call_id` through to the tool function?

3. **Check the Graphton tool wrapper chain**
   - `tool_wrappers.py`: `create_approval_aware_tool_wrapper` — what args/config does the wrapped function receive?
   - `_check_and_handle_approval` — what's available in scope at the point of `interrupt()` call?
   - Is `tool_call_id` already being extracted somewhere in the wrapper chain but not passed to the approval handler?

4. **Check the status_builder run_id alias mechanism**
   - `status_builder.py`: `_run_id_aliases` maps `run_id → tool_call_id`
   - This mapping is built from streaming events — is the same `run_id` available in the tool config?
   - If `run_id` reliably maps to `tool_call_id`, and `run_id` is already in the interrupt payload, can we use this mapping at resume time?

5. **Determine the solution**
   - **Option A**: `tool_call_id` is directly available in config → just read it and add to interrupt payload
   - **Option B**: `tool_call_id` is not available, but we can thread it through Graphton's tool wrapper → modify the wrapper to extract it from the AIMessage and pass it down
   - **Option C**: Use the `run_id` already in the interrupt payload, and at resume time use the `_run_id_aliases` mapping from the previous invocation's status builder → but this data is lost between invocations, so this is NOT viable
   - **Option D**: Store a `run_id → tool_call_id` mapping in the LangGraph graph state → available at resume via checkpoint

## Files to Investigate

- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — where `interrupt()` is called
- `backend/libs/python/graphton/src/graphton/core/interrupt_proxy.py` — sub-agent interrupt forwarding
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` — `_run_id_aliases` mechanism
- LangChain source: `langchain_core/tools/base.py`
- LangGraph source: `langgraph/prebuilt/tool_node.py`

## Success Criteria

- Clear answer: "tool_call_id is available at [location] via [mechanism]"
- OR: "tool_call_id requires threading via [specific change] in [specific file]"
- Documented approach ready for implementation in T04

## Deliverable

A brief write-up (in this task's execution log T01_2_execution.md) documenting:
1. Where tool_call_id is available (or how to make it available)
2. The exact code change needed in `_check_and_handle_approval`
3. Whether sub-agent interrupt proxying needs changes

---

## All Project Tasks (Overview)

This is Task 1 of 7. The full task sequence:

| Task | Title | Depends on |
|------|-------|------------|
| **T01** | **Research: tool_call_id availability at interrupt time** | — |
| T02 | Proto changes (remove tool_calls, simplify PendingApproval) | — |
| T03 | Python: single writer to messages, simplify HITL | T01, T02 |
| T04 | Add tool_call_id to interrupt payload | T01 |
| T05 | Java/Go: compute pending_approvals on write, simplify SubmitApproval | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | T05 |
| T07 | Tests: rewrite for new architecture | T03, T04, T05 |

## Review Process

Please review this task plan and provide feedback. Once approved, I'll begin the investigation.
