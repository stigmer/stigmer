# Fix StatusBuilder Turn-Boundary and Usage Tracking for Thinking-Only Turns

**Date**: March 21, 2026

## Summary

Fixed two bugs in the `StatusBuilder` where thinking-only LLM turns (extended thinking + `tool_use` blocks with no text output) lost usage metrics and incorrectly merged tool calls across consecutive turns. These bugs caused "$0.00 / 0 tokens" to display for thinking-only turns and could produce incorrect tool call grouping in the message thread.

## Problem Statement

When Anthropic models with extended thinking produce a response that contains only thinking blocks and `tool_use` blocks (no text content), the `StatusBuilder` failed in two ways:

### Pain Points

- **Usage metrics silently lost**: `_handle_chat_model_end_event` could not find the empty parent AI message because it was neither registered in `_llm_run_id_to_message` nor marked as `is_streaming=True`. The method logged a warning and returned without recording token counts, generation duration, or cost data.
- **Tool calls piled up on stale parent**: `_last_ai_message` was never invalidated between LLM turns. When consecutive thinking-only turns occurred, all their thinking ToolCalls and early tool calls were appended to the same parent AI message from the first turn, producing incorrect grouping in the frontend thread.

## Solution

Introduced LLM turn-boundary detection and empty-parent registration to ensure correct message grouping and usage tracking regardless of whether the LLM produces text content.

## Implementation Details

### New state: `_last_llm_run_id`

A per-namespace dict that tracks the most recent LLM `run_id`. When the `run_id` changes in `_handle_chat_model_stream_event`, `_last_ai_message` is cleared so the new turn creates a fresh parent AI message.

### Empty parent registration in `_llm_run_id_to_message`

`_ensure_parent_ai_message` now accepts an optional `llm_run_id` parameter. When called from the LLM stream path (`_start_thinking_stream`, `_create_early_tool_call`), the empty parent is registered so `_handle_chat_model_end_event` can find it and record usage. Tool-execution callers (`_handle_tool_start_event`) omit the parameter to avoid polluting the map with tool run-ids.

### Text streaming guard

When the text streaming fast path finds a registered AI message that is an empty parent (no content, has tool calls), it removes the registration and falls through to create a new text AI message. This preserves the correct chronological ordering in the frontend: thinking tool group first, then text response.

### Files changed

- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`: Turn-boundary detection, `_ensure_parent_ai_message` registration, text streaming guard
- `backend/services/agent-runner/tests/test_status_builder.py`: 5 new tests in `TestTurnBoundaryAndUsageTracking`

## Benefits

- **Accurate cost reporting**: Thinking-only turns now correctly record token counts, generation duration, and cost — no more "$0.00 / 0 tokens" for turns that consumed significant compute.
- **Correct message grouping**: Consecutive thinking-only turns produce separate parent AI messages, so the frontend thread displays tool calls under their correct turn.
- **Zero regression risk**: All 279 existing tests pass unchanged. The fix only activates when `run_id` is present in events; the legacy no-`run_id` path is unaffected.

## Impact

- **Agent Runner**: `StatusBuilder` in `execute_graphton.py` — all agent executions using Anthropic extended thinking benefit immediately.
- **Web Console / CLI**: Execution cost display and tool call grouping render correctly for thinking-heavy agent turns.
- **Usage Tracking**: Execution-level cost aggregation is now accurate for multi-turn conversations with thinking-only turns.

## Related Work

- Native Thinking Translation (synthetic think ToolCall creation) — the existing mechanism that converts extended thinking blocks into `think` ToolCalls.
- Early Tool Call Creation — the mechanism that creates ToolCalls from `tool_use` stream blocks before `on_tool_start` fires.

---

**Status**: Production Ready
