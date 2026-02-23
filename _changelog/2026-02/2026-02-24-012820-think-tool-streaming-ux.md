# Think Tool Streaming UX — Live Native Thinking in CLI

**Date**: February 24, 2026

## Summary

Enabled live streaming of native thinking content in the CLI and added dedicated UX rendering for the think tool. When Anthropic models use extended thinking, the CLI now displays thinking content in real-time with a live streaming effect (last 8 lines with a cursor), then collapses to an expandable block on completion. Previously, thinking content was only visible after the model finished thinking.

## Problem Statement

The StatusBuilder buffered all native thinking blocks and created a single COMPLETED ToolCall at flush time. The CLI only ever saw the finished result — there was no live display of thinking content as the LLM generated it.

### Pain Points

- Native thinking could run for 5-15 seconds with no visible CLI feedback
- The think tool had no dedicated rendering — it fell back to the generic `🔧 think` display
- The genuine streaming opportunity (thinking tokens arrive incrementally via `on_chat_model_stream`) was completely lost by the buffer-and-flush approach

## Solution

Two changes working together:

1. **CLI rendering**: Added a dedicated `toolDisplayMap` entry for the think tool (`💭 Thinking`) with content sourced from `args.thought`, gutter-style preview, and expandable behavior
2. **StatusBuilder streaming**: Changed the thinking detection to immediately create a RUNNING ToolCall with `is_streaming=True` on the first thinking block, update `result` on each subsequent block, and transition to COMPLETED on flush

## Implementation Details

### StatusBuilder Changes (`status_builder.py`)

- Added `_thinking_tool_call_ids: dict[str, str]` tracking dict mapping namespace to streaming ToolCall ID
- New `_start_thinking_stream()`: Creates a RUNNING ToolCall with `is_streaming=True`, `result` = initial thinking text, appended to the correct tool_calls list (main or sub-agent)
- New `_update_thinking_stream()`: Finds existing ToolCall by ID, replaces `result` with full accumulated buffer
- Modified thinking detection in `_handle_chat_model_stream_event`: First block creates via `_start_thinking_stream`, subsequent blocks update via `_update_thinking_stream`
- Modified `_flush_thinking_buffer`: Transitions existing streaming ToolCall in-place (RUNNING → COMPLETED, `result` → "ok", `args.thought` → full text, `is_streaming` → false). Defensive fallback creates a new ToolCall if no streaming ToolCall exists.

### CLI Changes (`render.go`, `render_test.go`)

- Added `"think"` to `toolDisplayMap`: `icon: "💭"`, `label: "Thinking"`, `preview: previewFileContent`, `contentSource: contentSourceInput`, `contentArgField: "thought"`
- 9 comprehensive tests covering icon, label, thought preview, content source, expanded view, running/completed badges, and displayable content checks

### Content Flow During Streaming vs After Completion

During streaming, content flows via `tc.Result` (rendered by `renderStreamingTool` — last 8 lines with `▍` cursor). After completion, content lives in `args.thought` (rendered by `resolveDisplayContent` with `contentSourceInput`). The transition is natural because `ToolCompletedEvent` rebuilds the block from scratch.

### No CLI Pipeline Changes Required

The existing CLI streaming pipeline handles think tool streaming without modification:
1. `emitToolCallStateEvents` detects `tc.IsStreaming && tc.Result != prevResults` → emits `ToolStreamDeltaEvent`
2. `renderStreamingTool` shows the last 8 lines with a `▍` cursor
3. `ToolCompletedEvent` handler creates a collapsed expandable block

## Benefits

- **Live feedback**: Users see thinking content updating in real-time during extended thinking (10-30 incremental updates over 5-15 seconds)
- **Dedicated UX**: Think tool has its own icon (`💭`) and label ("Thinking") instead of falling back to generic tool rendering
- **Expandable history**: After completion, the full thought is preserved in a collapsed, expandable block
- **Zero CLI pipeline changes**: Reuses the same streaming infrastructure as Write tool

## Impact

- **Users**: Significantly improved CLI experience when using models with native extended thinking (Claude Sonnet 4.6, Opus 4.5, Sonnet 4.5, Opus 4)
- **Platform**: The streaming approach produces visible updates via the existing `StreamingUpdateScheduler` (~500ms intervals), consistent with other streaming tools
- **Tests**: 182 agent-runner tests pass (4 new + 4 updated), 9 CLI toolrender tests pass, graphton unaffected

## Related Work

- [Think Tool — Structured Agent Reasoning](2026-02-24-001302-think-tool-structured-agent-reasoning.md) — Phase 2: explicit think tool definition
- [Enable Native Extended Thinking](2026-02-24-005527-enable-native-extended-thinking.md) — Phase 2: synthetic think tool translation in StatusBuilder

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3 of agent-thinking-flow project (20260223.01)
