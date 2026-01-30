---
name: Phase 2.1 AgentMessage Fields
overview: Add `is_streaming`, `token_count`, and `generation_duration_ms` fields to the AgentMessage proto, then update the StatusBuilder to populate these fields using the existing tracking infrastructure from Phase 1.1.
todos:
  - id: proto-fields
    content: Add is_streaming, token_count, generation_duration_ms fields to AgentMessage proto
    status: completed
  - id: statusbuilder-streaming
    content: Set is_streaming=true when creating AI message in _handle_chat_model_stream_event
    status: completed
  - id: statusbuilder-finalize
    content: Populate token_count, generation_duration_ms, set is_streaming=false in _handle_chat_model_end_event
    status: completed
  - id: tests
    content: Add 5 unit tests verifying new field population
    status: completed
  - id: build-verify
    content: Regenerate protos and run test suite
    status: completed
isProject: false
---

# Phase 2.1: Streaming State Fields for AgentMessage

## Scope

Add three new fields to `AgentMessage` proto and wire them through the StatusBuilder, converting logged-only metrics into persisted data.

---

## Current State

**Proto** ([api.proto](apis/ai/stigmer/agentic/agentexecution/v1/api.proto) lines 138-153):

```protobuf
message AgentMessage {
  MessageType type = 1;
  string content = 2;
  string timestamp = 3;
  repeated ToolCall tool_calls = 4;
  google.protobuf.Struct metadata = 5;
}
```

**StatusBuilder** already tracks (from Phase 1.1):

- `_message_start_times: Dict[int, datetime]` - start time per message index
- `_total_prompt_tokens`, `_total_completion_tokens` - cumulative counters
- Duration calculated in `_handle_chat_model_end_event` but only logged

---

## Changes

### 1. Proto: Add Three Fields to AgentMessage

File: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`

```protobuf
message AgentMessage {
  MessageType type = 1;
  string content = 2;
  string timestamp = 3;
  repeated ToolCall tool_calls = 4;
  google.protobuf.Struct metadata = 5;
  
  // NEW: Streaming state fields (Phase 2.1)
  
  // True while the AI is generating this message, false when complete.
  // Allows UI to show typing indicator vs final content.
  bool is_streaming = 6;
  
  // Total tokens used to generate this message (prompt + completion).
  // Zero until message generation completes.
  int32 token_count = 7;
  
  // Time in milliseconds from first token to completion.
  // Zero until message generation completes.
  int32 generation_duration_ms = 8;
}
```

**Design decisions:**

- Use `int32` (not `int64`) - token counts and durations fit in 32 bits
- Use `0` as unset value (proto3 default) - no `optional` needed
- Fields are AI message specific but placed on AgentMessage for simplicity
- Clear documentation for when each field is meaningful

### 2. StatusBuilder: Populate Fields During Streaming

File: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Change A: Set `is_streaming = true` when AI message created** (in `_handle_chat_model_stream_event`)

```python
ai_message = AgentMessage(
    type=MessageType.MESSAGE_AI,
    content=token,
    timestamp=now.isoformat(),
    is_streaming=True,  # NEW: Message is being generated
)
```

**Change B: Finalize fields in `_handle_chat_model_end_event`**

After calculating duration and extracting token counts:

```python
# Get the AI message to finalize
ai_message = self.current_status.messages[ai_message_index]

# Mark streaming complete
ai_message.is_streaming = False

# Set token count (this message's tokens, not cumulative)
ai_message.token_count = prompt_tokens + completion_tokens

# Set generation duration
if generation_duration_ms is not None:
    ai_message.generation_duration_ms = generation_duration_ms
```

### 3. Tests: Verify Field Population

File: `backend/services/agent-runner/tests/test_status_builder.py`

Add tests to the `TestChatModelEndEvent` class:

**Test A: `test_sets_is_streaming_true_on_new_message`**

- Process a stream event
- Assert `messages[0].is_streaming == True`

**Test B: `test_sets_is_streaming_false_on_end`**

- Process stream event, then end event
- Assert `messages[0].is_streaming == False`

**Test C: `test_sets_token_count_on_end`**

- Process stream event, then end event with usage metadata
- Assert `messages[0].token_count == 150` (100 prompt + 50 completion)

**Test D: `test_sets_generation_duration_ms_on_end`**

- Mock time or use known delta
- Assert `messages[0].generation_duration_ms > 0`

**Test E: `test_token_count_zero_when_no_usage_metadata`**

- Process end event without usage metadata
- Assert `messages[0].token_count == 0`

---

## File Changes Summary

| File | Change Type | Lines Affected |

|------|-------------|----------------|

| `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` | Add fields | ~10 lines |

| `backend/services/agent-runner/worker/activities/graphton/status_builder.py` | Populate fields | ~15 lines |

| `backend/services/agent-runner/tests/test_status_builder.py` | Add tests | ~80 lines |

---

## Build and Verify

After changes:

1. Regenerate Python protobuf stubs: `make generate-protos` or bazel build
2. Run StatusBuilder tests: `pytest backend/services/agent-runner/tests/test_status_builder.py -v`
3. Verify no regressions in existing tests

---

## Out of Scope (Future Tasks)

- Regenerating Go/Java/TypeScript stubs (separate task)
- UsageMetrics message (Phase 2.4)
- Per-message model name tracking
- Sub-agent token aggregation