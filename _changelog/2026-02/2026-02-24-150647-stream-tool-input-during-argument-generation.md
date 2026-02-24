# Stream Tool Input Content During Argument Generation

**Date**: February 24, 2026

## Summary

Added live streaming of tool input content (e.g., file content for write tools) during the LLM's argument generation phase. Previously the CLI showed a static tool header for 10-20 seconds while the model generated arguments; now it progressively renders the content token-by-token, following the same proven pattern as native thinking streaming.

## Problem Statement

After enabling early tool call creation (which replaced the misleading "Thinking..." indicator with the tool name), a gap remained: the tool header appeared immediately but the content area stayed empty for 10-20 seconds while the LLM generated large tool arguments (e.g., file content for write tools). The user could see *what* tool was being invoked but not *what content* was being generated.

### Pain Points

- **Blind waiting**: Users stared at a static `Write: file.py ⏳` header for 10-20 seconds with no feedback on what content was being generated
- **Wasted reading time**: The full file content only appeared at the approval prompt, forcing users to read it all at once instead of progressively
- **Inconsistent experience**: Thinking content streamed live but tool input content did not, despite being the same class of problem (long-running LLM generation)

## Solution

Extend the existing streaming infrastructure to handle `input_json_delta` blocks from the Anthropic API. The approach follows the exact same pattern as thinking streaming: accumulate content in a buffer, extract displayable text, pipe it into `tool_call.result`, and let the existing gRPC/CLI pipeline render it progressively.

## Implementation Details

### 1. Partial JSON Content Extraction (Module-Level Helpers)

Two pure functions handle the core extraction problem:

- **`_find_json_string_value_start(partial_json, field_name)`**: Locates the opening quote of a JSON string value for a given field name, robust against whitespace variations (`"key":"val"` and `"key" : "val"` both work).

- **`_json_unescape_partial(s)`**: Unescapes a partial JSON string value (`\n` → newline, `\"` → quote, `\uXXXX` → unicode character). Silently drops trailing incomplete escape sequences at fragment boundaries to avoid garbled output.

### 2. Tool Content Field Mapping

`_TOOL_CONTENT_FIELDS` maps tool names to the arg field(s) containing bulk displayable content:

- Write tools (`write`, `create_file`, etc.) → `["contents", "content", "file_content"]`
- Edit tools → `["new_text", "new_string", "replacement", "content"]`
- Think tool → `["thought"]`

Tools not in this mapping (e.g., `read_file`, `glob`) don't stream input because their args are small and generate in under a second.

### 3. StatusBuilder Accumulation Pipeline

- **`_tool_input_active_tc`**: Maps namespace key → temp_id of the early ToolCall currently receiving deltas
- **`_tool_input_buffers`**: Maps temp_id → accumulated partial JSON string
- **`_accumulate_tool_input()`**: Appends each `input_json_delta` fragment, extracts displayable content via `_extract_content_from_partial_json()`, and writes it to `tool_call.result`
- **`_flush_tool_input_buffer()`**: Cleans up state when the early ToolCall is reconciled

### 4. Reconciliation Update

`_reconcile_early_tool_call` now clears `tool_call.result = ""` and flushes the input buffer before populating the authoritative `args` from `on_tool_start`. This ensures a clean transition from streaming input to the final approval view.

### 5. CLI Streaming Robustness Fix

Fixed a timing-dependent issue in the TUI's `ToolStreamDeltaEvent` handler: when a tool block was initially created as "expandable" (because it already had content when first seen), the `displayContent()` method would return the static `preview` field, ignoring the `content` field that streaming updates wrote to. The fix forces `expandable = false` during active streaming so content updates are always visible, regardless of the block's initial state. The block reverts to expandable when the tool reaches a terminal state via `updateToolBadge`.

## Benefits

- **Progressive content visibility**: Users can read file content as it's generated, giving 10-20 seconds of reading time before the approval prompt appears
- **Zero new infrastructure**: No proto changes, no new event types, no gRPC API changes — reuses the existing streaming pipeline end-to-end
- **Consistent UX pattern**: Tool input streaming and thinking streaming now follow the identical `result`-based pipeline, reducing cognitive complexity for maintainers
- **Robust streaming display**: The `expandable = false` fix eliminates a timing-dependent rendering issue that also affected thinking streaming

## Impact

- **StatusBuilder** (`backend/services/agent-runner/worker/activities/graphton/status_builder.py`): +187 lines — content extraction helpers, accumulation pipeline, reconciliation cleanup
- **CLI TUI** (`client-apps/cli/pkg/executiontui/handle_events.go`): +6 lines — streaming robustness fix
- **Tests** (`backend/services/agent-runner/tests/test_status_builder.py`): +186 lines — 17 new tests (7 integration, 10 unit)

## Related Work

- [Fix Streaming UX and Protobuf Copy Semantics](2026-02-24-043603-fix-streaming-ux-and-protobuf-copy-semantics.md) — introduced early tool call creation and thinking streaming that this feature extends
- [Think Tool Streaming UX](2026-02-24-012820-think-tool-streaming-ux.md) — the thinking streaming pattern this implementation follows

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (planning, implementation, testing)
