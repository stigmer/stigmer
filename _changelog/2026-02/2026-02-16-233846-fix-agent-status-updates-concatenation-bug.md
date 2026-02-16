# Fix Agent Status Updates Concatenation Bug

**Date**: February 16, 2026

## Summary

Fixed a critical bug where all AI agent status updates during execution were concatenated into a single MESSAGE_AI instead of appearing as separate messages per LLM turn. This bug obscured the agent's real-time thinking process and made execution logs difficult to follow. The fix involved adding a single boolean check (`message.is_streaming`) to the StatusBuilder's message search logic.

## Problem Statement

During agent execution, LLMs generate multiple "turns" of output interspersed with tool calls. Users expect to see these as interleaved messages: AI message → Tool calls → AI message → Tool calls, etc. Instead, all AI text was concatenating into the very first MESSAGE_AI entry, creating an incomprehensible wall of text without context about when each thought occurred relative to tool executions.

### Pain Points

- **User confusion**: CLI output showed one massive AI message followed by all tool calls, making it impossible to understand the agent's reasoning flow
- **Lost context**: Without message boundaries between turns, users couldn't see which status updates corresponded to which tool calls
- **Debugging difficulty**: Execution logs in the database showed the same issue, making post-mortem analysis extremely difficult
- **Broken metrics**: Per-message `token_count` and `generation_duration_ms` fields were overwritten by later turns instead of tracking each turn separately

## Solution

The root cause was in `status_builder.py` line 610, where the code searched backward for **any** MESSAGE_AI to append streaming tokens to. It didn't check if that message was already finalized (`is_streaming=False`), so subsequent LLM turns found the first AI message and kept appending to it forever.

The fix adds `and message.is_streaming` to two search predicates:
1. `_handle_chat_model_stream_event()` - ensures new turns create new messages
2. `_handle_chat_model_end_event()` - ensures finalization targets the current turn (robustness)

## Implementation Details

### Files Changed

**`backend/services/agent-runner/worker/activities/graphton/status_builder.py`**

#### Change 1 (Primary Fix) - Line 610
```python
# Before (Bug)
for idx in range(len(messages_list) - 1, -1, -1):
    message = messages_list[idx]
    if message.type == MessageType.MESSAGE_AI:
        ai_message = message
        break

# After (Fixed)
for idx in range(len(messages_list) - 1, -1, -1):
    message = messages_list[idx]
    if message.type == MessageType.MESSAGE_AI and message.is_streaming:
        ai_message = message
        break
```

#### Change 2 (Robustness) - Line 669
```python
# Before
for idx in range(len(messages_list) - 1, -1, -1):
    message = messages_list[idx]
    if message.type == MessageType.MESSAGE_AI:
        ai_message_index = idx
        break

# After (Robust)
for idx in range(len(messages_list) - 1, -1, -1):
    message = messages_list[idx]
    if message.type == MessageType.MESSAGE_AI and message.is_streaming:
        ai_message_index = idx
        break
```

### Why This Works

The `is_streaming` field acts as a lifecycle flag:
- **During streaming**: `is_streaming=True` allows token accumulation via `content += token`
- **After finalization**: `on_chat_model_end` sets `is_streaming=False`, preventing further appends
- **Next turn**: The search fails to find a streaming message, triggers new message creation

No other code changes were required because the downstream pipeline (CLI rendering, gRPC status updates, proto definitions) already supported multiple AI messages -- they just never received the correct data due to this bug.

## Benefits

### Immediate User Experience Improvements
- **Clear execution flow**: Users now see distinct AI messages interleaved with tool results, making the agent's decision process transparent
- **Real-time context**: Each status update appears at the correct point in the execution timeline
- **Better debugging**: Execution logs show when the agent was "thinking" versus executing tools

### Data Quality Improvements
- **Accurate per-message metrics**: Each turn's `token_count` and `generation_duration_ms` are now preserved instead of being overwritten
- **Proper conversation history**: The messages list forms a true conversation thread matching LangGraph's internal state

### Testing Results
- **30/30 streaming tests pass**: All tests for chat model streaming, message fields, and sub-agent routing pass cleanly
- **173/179 total tests pass**: The 6 failures are pre-existing approval policy test issues unrelated to this change
- **Zero regressions**: No existing functionality was broken

## Impact

### Users Affected
- **All agent execution users**: Anyone running agents via CLI or monitoring executions will see improved output
- **Platform developers**: Easier to debug agent behavior and understand execution traces
- **Future AI features**: Foundation for features that depend on accurate turn-by-turn conversation history

### System Components
- **Agent Runner (Python)**: StatusBuilder message handling logic modified
- **CLI (Go)**: No changes required; already supported multiple AI messages
- **Proto APIs**: No changes required; schema already supported this pattern
- **Database/Storage**: Execution records will now contain proper message sequences

### Backwards Compatibility
- **Fully compatible**: Old executions (with concatenated messages) remain readable
- **New executions**: Immediately benefit from correct message separation
- **No migration needed**: This is a fix in the live processing logic, not stored data format

## Related Work

This fix revealed that the platform's design was already correct -- the CLI streaming renderer, proto message definitions, and gRPC update pipeline all anticipated multiple interleaved AI messages. They were simply starved of correct data by this bug in the StatusBuilder.

The fix validates the architectural decision to use `is_streaming` as a lifecycle state flag for progressive message building. This pattern can be applied to other streaming content types (tool results, sub-agent messages) as the platform evolves.

---

**Status**: ✅ Production Ready  
**Test Coverage**: 30 directly related tests passing, 173 total passing  
**Risk Level**: Very Low (single boolean addition, no new code paths)
