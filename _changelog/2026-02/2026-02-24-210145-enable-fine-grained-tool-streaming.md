# Enable Anthropic Fine-Grained Tool Streaming

**Date**: February 24, 2026

## Summary

Enabled Anthropic's fine-grained tool streaming to eliminate 15–30 second buffering of tool argument tokens during agent execution. Tool content (file bodies, edits) now streams to the CLI in real-time, matching the behavior of thinking tokens. Also hardened the event loop with forced gRPC updates and error isolation for early tool call and input streaming events.

## Problem Statement

When the agent called tools with large arguments (e.g. writing a 100-line file), the CLI displayed the tool name immediately but then showed no progress for ~30 seconds. All content then appeared in a ~2 second burst right before the tool executed.

### Pain Points

- Users stared at a static "Write: file.py" indicator for 30 seconds with no feedback
- Content appeared all at once, defeating the purpose of streaming
- The investigation initially appeared to be a LangGraph or LangChain buffering issue, requiring an 8-layer pipeline trace to rule out

## Solution

The root cause was identified via Deep Research as **Anthropic API server-side behavior**: by default, Anthropic buffers and JSON-validates tool arguments before streaming them. Anthropic's documented fix is `eager_input_streaming: true` on tool definitions, which disables this buffering.

Since `langchain-anthropic` 1.3.3 does not expose this flag through `bind_tools()` or `_ANTHROPIC_EXTRA_FIELDS`, we created a thin `ChatAnthropic` subclass that injects the flag at the API payload level.

## Implementation Details

### Eager Tool Streaming (`graphton/core/models.py`)

`_EagerToolStreamingChatAnthropic` overrides `_get_request_payload()` to add `eager_input_streaming: true` to every user-defined tool in the API request. The subclass is used in `parse_model_string()` for all Anthropic models. It is designed to be removed once `langchain-anthropic` adds native support.

### Forced gRPC Updates (`execute_graphton.py`, `status_builder.py`)

Added a `force_next_update` flag on `StatusBuilder` that bypasses the streaming scheduler's time/burst thresholds when a new ToolCall is created (early tool call or thinking stream). This ensures the CLI sees tool names and streaming content immediately instead of waiting up to 500ms–30s for the next scheduled update.

### Error Isolation (`status_builder.py`)

Wrapped early tool call creation and input delta accumulation in try/except blocks with structured logging, preventing a single malformed streaming event from crashing the entire activity stream.

## Benefits

- Tool argument content streams in real-time (~3s initial latency vs ~30s)
- Thinking-like progressive rendering for write/edit tool content
- The CLI shows file content as it is generated, not all at once
- No regressions: all 12 model tests pass, 501/514 total graphton tests pass (13 failures pre-existing)

## Impact

- **End users**: Dramatically improved UX during file creation and editing operations
- **Agent runner**: Reduced perceived latency by ~90% for tool argument delivery
- **Maintainability**: Subclass is self-documenting with removal instructions when upstream catches up

## Related Work

- `2026-02-24-150647-stream-tool-input-during-argument-generation.md` — infrastructure this builds on (early tool calls, input delta accumulation, CLI ToolStreamDeltaEvent)
- `2026-02-24-043603-fix-streaming-ux-and-protobuf-copy-semantics.md` — protobuf copy fix that enabled correct streaming
- `_investigations/2026-02-24-langgraph-input-json-delta-buffering.md` — original investigation
- `_investigations/20260224.194924.research.langgraph-input-json-delta-buffering/` — Deep Research that identified the Anthropic API root cause

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (investigation + Deep Research + implementation)
