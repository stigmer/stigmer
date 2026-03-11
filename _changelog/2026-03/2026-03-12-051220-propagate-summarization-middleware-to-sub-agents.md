# Propagate Summarization Middleware to Sub-Agents

**Date**: March 12, 2026

## Summary

Fixed a critical bug where sub-agents ran without context summarization middleware, causing `AnthropicContextOverflowError` when sub-agent conversations exceeded the model's 200K token limit (observed at 249K tokens). The fix propagates `ContextSummarizationMiddleware` from the parent agent into each sub-agent during compilation in `create_deep_agent()`.

## Problem Statement

Agent execution `aex-01kkfkahey3rsp756cefqsvdnv` failed with:

```
prompt is too long: 249324 tokens > 200000 maximum
```

Despite having a production-ready context summarization architecture (built in project `20260131.01`), the summarization middleware was only injected into the **parent** agent. Sub-agents were compiled with empty middleware lists, leaving them completely unprotected from context window overflow.

### Pain Points

- Sub-agents could accumulate unbounded context, crashing with `AnthropicContextOverflowError`
- All 4 sub-agents in the execution were marked `SUB_AGENT_FAILED`, causing the entire execution to fail
- The status log showed `summarizations=0` despite the parent having summarization configured
- The existing summarization architecture covered the parent agent but had a gap in sub-agent propagation

## Solution

Inject `ContextSummarizationMiddleware` into each sub-agent's middleware list inside `create_deep_agent()` — the same function that already handles parent agent middleware injection. This required changes only in `agent.py`, with no modifications to the sub-agent transformer, interrupt proxy, or execution wiring.

Each sub-agent gets its own middleware instance (fresh mutable state) with `callback=None` since sub-agent summarization events don't need to be reported through the parent's StatusBuilder.

## Implementation Details

### HITL Path (checkpointer + approval_checker present)

In the sub-agent compilation loop, after building `sa_middleware` from the subagent dict, a fresh `ContextSummarizationMiddleware` is created and inserted at position 0 before passing to `compile_subagent_with_proxy()`:

```python
if summarization_config is not None and summarization_config.enabled:
    sa_middleware.insert(0, ContextSummarizationMiddleware(
        config=summarization_config,
        callback=None,
    ))
```

### Non-HITL Path (no checkpointer or no approval_checker)

Subagent dicts are shallow-copied (to avoid mutating originals) and augmented with a `middleware` key containing the summarization middleware before passing to deepagents.

### Test Coverage

Added 8 unit tests in `TestSubAgentSummarizationPropagation`:
- HITL path: middleware injected, distinct instances per sub-agent, pre-compiled skipped, disabled config skipped
- Non-HITL path: middleware injected via dict, originals not mutated, pre-compiled skipped, disabled config skipped

## Benefits

- Sub-agents now have the same context window protection as the parent agent
- Trigger at 180K tokens, target 160K tokens (for Claude models with 200K context)
- Prevents `AnthropicContextOverflowError` in long-running sub-agent conversations
- Each sub-agent manages its own summarization independently

## Impact

- **Agent Executions**: Sub-agents with large tool call histories will now summarize instead of crashing
- **Reliability**: Eliminates a class of execution failures caused by unbounded sub-agent context growth
- **Files Changed**: `agent.py` (+41 lines), `test_summarization_middleware.py` (+339 lines)
- **Files Unchanged**: `subagent_transformer.py`, `interrupt_proxy.py`, `execute_graphton.py`, `summarization_middleware.py`, `summarization_config.py`

## Related Work

- Project `20260131.01.context-summarization-architecture` — the original summarization architecture that this fix completes
- `2026-03-11-171855-fix-sub-agent-approval-deadlock.md` — prior sub-agent interrupt proxy work

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
