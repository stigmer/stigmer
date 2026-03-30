# T02 Execution: Research — LangGraph v2 tool_call_id Availability

**Started**: 2026-03-30
**Status**: COMPLETE
**Type**: Research (test-driven verification)

## Research Question

Does LangGraph v2 `astream_events` expose `tool_call_id` on `on_tool_start` / `on_tool_end` events, and is `ToolCallIdCapture` still necessary?

## Tested Against

- `langgraph==1.0.8`
- `langchain-core==1.2.12`
- `langchain-anthropic` (installed in graphton venv)
- Python 3.13.3

## Test File

`backend/libs/python/graphton/tests/core/test_tool_call_id_on_events.py`

12 tests across 6 test classes:

| Class | Tests | API Key? | Result |
|-------|-------|----------|--------|
| TestToolCallIdOnV2StreamEvents | 3 | No | PASS |
| TestToolCallIdOnCallbackApi | 2 | No | PASS |
| TestCallbackFiresBeforeStreamEvent | 1 | No | PASS |
| TestToolCallIdWithMultipleToolCalls | 2 | No | PASS |
| TestToolCallIdOnResumeAfterInterrupt | 2 | No | PASS |
| TestToolCallIdWithRealLLM | 2 | Yes (Anthropic) | PASS |

## Findings

### Finding 1: v2 events do NOT carry tool_call_id

Confirmed. `on_tool_start` and `on_tool_end` v2 events do not expose `tool_call_id` at the event-envelope level (not in top-level keys, `data`, or `metadata`).

The only place tool_call_id appears near v2 events is `data.output` on `on_tool_end` — which is a `ToolMessage` object that inherently carries `tool_call_id`. But that's the tool's output object, not an event-envelope field.

### Finding 2: Callback API delivers tool_call_id

Confirmed. `BaseCallbackHandler.on_tool_start` receives `tool_call_id` as a keyword argument, and it matches the `id` from the AIMessage's `tool_calls[]`.

### Finding 3: Callbacks fire before v2 events

Confirmed. Sync callbacks fire before the corresponding v2 event is yielded from the `astream_events` async generator. This ordering is critical — it ensures `ToolCallIdCapture` has the `run_id -> tool_call_id` mapping populated before `StatusBuilder` processes the v2 event.

### Finding 4: Multiple tool calls get correct IDs

Confirmed. When an AIMessage contains N tool_calls, each callback invocation receives the correct `tool_call_id` for its respective tool call. All IDs are correctly correlated.

### Finding 5: Resume preserves tool_call_id in callbacks

Confirmed. After `interrupt()` + `Command(resume=...)`, the callback on the resumed tool invocation still delivers the original `tool_call_id`.

### Finding 6: Real Anthropic model confirms behavior

Confirmed with `claude-sonnet-4-20250514`. Real model-generated `toolu_...` IDs flow correctly through the callback API. v2 events from real model invocations still lack `tool_call_id` at the envelope level.

## Conclusion

**ToolCallIdCapture is still necessary.** LangGraph v2 `astream_events` does not expose `tool_call_id` on tool events. The callback API is the only reliable source of this mapping.

The current architecture — sync `BaseCallbackHandler` capturing `run_id -> tool_call_id` before v2 events are yielded — is correct and validated by empirical tests.

## Implications for T03

The HITL bidirectional fallback elimination (T03) can proceed with confidence:

- The **primary identity path** (ToolCallIdCapture callback -> resolve) works correctly
- The **alias mechanism** (register_alias for resume-path run_id changes) is correctly designed
- The bidirectional fallback in HITL matching is compensating complexity — not a necessary safety net for a broken identity mechanism
