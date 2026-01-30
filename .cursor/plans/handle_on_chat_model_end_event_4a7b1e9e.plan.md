---
name: Handle on_chat_model_end Event
overview: Implement the missing `on_chat_model_end` event handler in StatusBuilder to capture token counts and finalize AI messages - the highest-impact, lowest-risk item from Phase 1.
todos:
  - id: event-routing
    content: Add on_chat_model_end routing to process_event method
    status: completed
  - id: track-start-time
    content: Add message_start_times dict and record start time in stream handler
    status: completed
  - id: implement-handler
    content: Implement _handle_chat_model_end_event method with usage extraction
    status: completed
  - id: add-logging
    content: Add structured logging for token counts and duration
    status: completed
  - id: verify-integration
    content: Test with live agent execution and verify logs
    status: completed
isProject: false
---

# Phase 1.1: Handle on_chat_model_end Event

## Problem Statement

The `StatusBuilder` only handles 3 event types (`on_tool_start`, `on_tool_end`, `on_chat_model_stream`), missing the critical `on_chat_model_end` event. This causes:

1. **No token counts captured** - Usage metadata (prompt_tokens, completion_tokens) is only available in this event
2. **Messages never finalize** - AI messages keep appending content forever without a "done" signal
3. **No duration tracking** - Cannot measure how long AI generation took

## Why This Task First

- **Single file change** - Only [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) needs modification
- **Zero proto changes** - No stub regeneration required (proto fields come in Phase 2.1)
- **Immediate value** - Enables token tracking, prepares for UsageMetrics
- **Foundation** - Required before Phase 2.1 (proto fields) and Phase 2.4 (UsageMetrics)

## Implementation Details

### 1. Add Event Routing in `process_event`

```python
# Line 101-102 in status_builder.py - add new condition
elif event_type == "on_chat_model_stream":
    self._handle_chat_model_stream_event(event, namespace)
elif event_type == "on_chat_model_end":  # NEW
    self._handle_chat_model_end_event(event, namespace)
```

### 2. Implement the Handler Method

The handler needs to:

- Find the most recent AI message (the one being streamed)
- Extract token usage from LangChain's response metadata
- Track generation duration by comparing timestamps
- Log token counts for observability (until proto fields exist)

Key insight: LangChain's `on_chat_model_end` event contains usage metadata in `event["data"]["output"].usage_metadata` with:

- `input_tokens` (prompt tokens)
- `output_tokens` (completion tokens) 
- `total_tokens`

### 3. Track Message Start Time

To calculate `generation_duration_ms`, we need to track when message streaming started. Add a field to StatusBuilder:

```python
self._message_start_times: Dict[str, datetime] = {}  # message_id -> start_time
```

Update `_handle_chat_model_stream_event` to record start time when creating a new AI message.

## Files to Modify

| File | Changes |

|------|---------|

| [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) | Add `on_chat_model_end` handler, track message start times, log usage |

## Testing Strategy

1. **Manual verification**: Run an agent execution and check logs for token counts
2. **Unit test**: Add test case for `on_chat_model_end` event handling
3. **Integration**: Verify AI messages are properly finalized in status updates

## Future Integration Points

This implementation prepares for:

- **Phase 2.1**: Add `is_streaming`, `token_count` fields to AgentMessage proto
- **Phase 2.4**: Add UsageMetrics message for aggregated token tracking
- **Billing/Cost tracking**: Token counts enable cost calculation per execution

## Scope Boundaries

What this task does NOT include:

- Proto changes (Phase 2.1)
- UsageMetrics aggregation (Phase 2.4)
- Time-based streaming updates (Phase 1.2)
- Final status retry logic (Phase 1.3)