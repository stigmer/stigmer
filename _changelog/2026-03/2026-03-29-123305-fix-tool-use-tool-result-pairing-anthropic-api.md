# Fix tool_use → tool_result Pairing for Anthropic API

**Date**: March 29, 2026

## Summary

Fixed an `anthropic.BadRequestError` caused by guardrail middleware injecting advisory messages between `AIMessage(tool_calls)` and their corresponding `ToolMessage` results. A new `_reorder_tool_result_pairing` function ensures the Anthropic API's strict `tool_use → tool_result` sequencing contract is never violated, regardless of how many middleware hooks inject messages into the conversation state.

## Problem Statement

After the periodic advisory budget middleware was deployed, sub-agents running long executions (30+ model rounds) began crashing with:

```
anthropic.BadRequestError: messages.88: `tool_use` ids were found without
`tool_result` blocks immediately after: toolu_019R6Yq6jdPYYJfRvx4zbVaJ.
Each `tool_use` block must have a corresponding `tool_result` block in
the next message.
```

### Pain Points

- **Execution-killing crash** — The error terminated the entire agent execution at model round 30, wasting all accumulated work ($0.44 in API costs for the failed run).
- **Previous fix was incomplete** — The earlier `_sanitize_non_leading_system_messages` correctly converted mid-conversation `SystemMessage` objects to `HumanMessage`, but did not account for the *positional* constraint: converted advisories could still land between an `AIMessage(tool_calls)` and its `ToolMessage` results.
- **Multiple middleware sources** — `ExecutionBudgetMiddleware`, `LoopDetectionMiddleware`, and `ContextSummarizationMiddleware` all inject `SystemMessage` objects via `aafter_model`, making the interleaving problem increasingly likely as agents run longer.

## Solution

Added a defensive message reordering pass that runs as the final step of `_sanitize_non_leading_system_messages`. After all `SystemMessage` → `HumanMessage` conversions are complete, `_reorder_tool_result_pairing` scans the message list and ensures every `AIMessage(tool_calls)` is immediately followed by its `ToolMessage`(s), moving any interleaved messages to after the tool results.

### Before (broken sequence)

```
AIMessage(tool_calls=[{id: X}])
HumanMessage("[System] budget advisory")   ← injected by middleware
ToolMessage(tool_call_id=X)
```

### After (fixed sequence)

```
AIMessage(tool_calls=[{id: X}])
ToolMessage(tool_call_id=X)
HumanMessage("[System] budget advisory")   ← safe position
```

## Implementation Details

### New function: `_reorder_tool_result_pairing`

Located in `graphton/core/models.py`, this function performs a single linear scan (O(n)) of the message list:

1. When it encounters an `AIMessage` with `tool_calls`, it enters a collection phase
2. `ToolMessage` objects are placed immediately after the `AIMessage`
3. Any non-`ToolMessage`, non-`AIMessage` messages (converted advisories) are deferred to a buffer
4. When the next `AIMessage` is reached or messages are exhausted, the deferred buffer is flushed
5. Messages not following an `AIMessage(tool_calls)` pass through unchanged

### Integration point

`_reorder_tool_result_pairing` is called as the last step of `_sanitize_non_leading_system_messages`, which itself is called from `_EagerToolStreamingChatAnthropic._get_request_payload`. This means the reordering happens at the last possible moment before `langchain_anthropic`'s `_format_messages` and `_merge_messages` process the messages for the API payload.

### Files Changed

- **`models.py`** — Added `_reorder_tool_result_pairing` function; integrated as the return value of `_sanitize_non_leading_system_messages`
- **`test_models.py`** — Updated 2 existing sanitization tests for new message ordering; added `TestReorderToolResultPairing` class with 9 test cases covering: empty list, no tool calls, normal sequence, single advisory, multiple advisories, multiple tool calls, multi-round conversations, non-tool-calling AI messages, and unconverted `SystemMessage` handling

## Benefits

- **Eliminates BadRequestError** — The `tool_use → tool_result` pairing is now structurally guaranteed regardless of middleware injection timing.
- **Zero semantic loss** — Advisory messages are preserved in the conversation (just repositioned), so the model still receives the budget/loop/cost guidance.
- **Future-proof** — Any new middleware that injects messages via `aafter_model` will be automatically handled by the reordering pass.
- **Minimal overhead** — Single linear scan, no allocations beyond the output list.

## Impact

- **Sub-agents** — Long-running sub-agents (30+ rounds) that trigger periodic budget advisories will no longer crash.
- **Main agent** — Main agents hitting 50+ rounds with advisory injection are similarly protected.
- **All Anthropic-backed agents** — The fix applies uniformly via the `_EagerToolStreamingChatAnthropic` model subclass.
- **Non-Anthropic providers** — Unaffected, as the sanitizer only runs in the Anthropic model's `_get_request_payload`.

## Related Work

- Previous changelog: `2026-03-29-114945-periodic-advisory-budget-middleware.md` — Introduced the periodic advisory mode and `_sanitize_non_leading_system_messages`, which this fix completes.

---

**Status**: ✅ Production Ready
**Timeline**: ~1.5 hours (root cause analysis, implementation, testing)
