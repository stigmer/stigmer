# Tool Streaming Source Disambiguation

**Date**: March 30, 2026

## Summary

Added a `streaming_source` enum to `ToolCall` in the proto model so consumers can distinguish whether a tool is streaming LLM-generated input (typewriter effect) or tool-produced output (live shell). Removed redundant write-tool re-streaming, fixed a blank-flash UX bug during the input-to-execution transition, and updated the CLI to use the new data-driven field instead of client-side heuristics.

## Problem Statement

`ToolCall.is_streaming` was a single boolean set to `true` in two unrelated scenarios -- LLM argument generation (input phase) and tool output production (output phase). Consumers could not tell which phase was active from the data alone.

### Pain Points

- The CLI compensated with a local `streamIsPreApproval` flag -- client-side state invisible to other consumers (web frontend, API clients, future mobile app)
- `reconcile_early_tool_call` unconditionally cleared `result` to `""` on `on_tool_start`, causing a visible blank flash for auto-approved write tools
- `_stream_write_content` in `tool_wrappers.py` re-streamed the exact same content the user already saw during input streaming, purely to repopulate the cleared `result` field -- a workaround compensating for the clearing bug
- Any future consumer would need to reverse-engineer the same heuristics the CLI uses

## Solution

Introduced a `ToolCallStreamingSource` enum (`INPUT`, `OUTPUT`, `UNSPECIFIED`) at the proto level and threaded it through the Python backend and Go CLI, making the streaming phase explicit in the data model rather than inferred by consumers.

## Implementation Details

### Proto (`apis/ai/stigmer/agentic/agentexecution/v1/`)

- Added `ToolCallStreamingSource` enum to `enum.proto` with lifecycle documentation
- Added `streaming_source` field (tag 19) to `ToolCall` in `message.proto`
- Regenerated stubs in both `stigmer` and `stigmer-cloud` repos (Python, Go, Java, TypeScript, Dart)
- Non-breaking addition -- `is_streaming` retained for backward compat

### Python Backend (`backend/services/agent-runner/`)

- `create_early_tool_call`: sets `streaming_source = INPUT`
- `reconcile_early_tool_call`: sets `streaming_source = UNSPECIFIED`, preserves `result` when input buffer had content (fixes blank flash)
- `handle_tool_progress`: sets `streaming_source = OUTPUT`
- `handle_tool_end`: sets `streaming_source = UNSPECIFIED`

### Write Tool (`backend/libs/python/graphton/`)

- Removed `_stream_write_content` and its constants (`_WRITE_STREAMING_THRESHOLD`, `_WRITE_TARGET_CHUNKS`, `_WRITE_CHUNK_DELAY_S`)
- Write tool now just writes silently -- input streaming already delivered the content to the user

### CLI (`client-apps/cli/`)

- Added `StreamingSource` field to `toolrender.ToolCallInfo`
- `convertToolCall` maps proto `streaming_source` to the info struct
- Added `isInputStreaming()` helper that checks `StreamingSource == "input"`, falling back to `IsStreaming` for backward compat with older backends
- Event dispatch in `run_stream_inline.go` uses data-driven check instead of `IsStreaming` alone
- Added tests: `TestIsInputStreaming_DataDriven`, `TestHandleEvent_OutputStreamingDoesNotInitiatePreApproval`

## Benefits

- Streaming phase is explicit in the data model -- no consumer needs heuristics
- Eliminated the blank flash during auto-approved write tool transitions
- Removed ~80 lines of redundant re-streaming code (`_stream_write_content`)
- Web frontend, mobile app, and API clients can now distinguish streaming phases from proto data when building tool-level streaming UX
- Backward compatible -- old consumers that only check `is_streaming` continue to work

## Impact

- **Proto model**: All language stubs regenerated (Python, Go, Java, TypeScript, Dart)
- **Python agent-runner**: Streaming lifecycle events now carry phase information
- **CLI**: Data-driven rendering replaces client-side `streamIsPreApproval` inference
- **Web frontend**: No changes needed -- passive snapshot rendering continues to work; `streaming_source` available in TypeScript stubs for future UX
- **Java/Go backend services**: No changes needed -- these are pass-through for streaming fields

## Related Work

- Deferred: OpenAI tool argument streaming support (`chunk.tool_calls[].function.arguments` path in `handle_chat_model_stream`)
- Future: Web tool-level streaming UX (typing cursor for INPUT, terminal renderer for OUTPUT) can now use `streaming_source` from proto

---

**Status**: Production Ready
