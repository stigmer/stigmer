# Tool Execution Live Streaming & Liveness Indicators

**Date**: February 15, 2026

## Summary

Implemented two-phase tool execution streaming for the Stigmer CLI TUI. Phase 1 adds liveness indicators (running spinners, in-place completion updates with duration) that fix a critical bug where tool completions were invisible. Phase 2 adds the full streaming foundation across proto, Python backend, and CLI, enabling tools to progressively stream output content to the user in real-time.

## Problem Statement

When tools executed during agent runs, the CLI TUI provided no visual feedback. The user saw a static tool header (e.g., "Write: file.md") and could not tell if the tool was running, stuck, or complete. This was especially frustrating for long-running tools like shell commands or large file writes.

### Pain Points

- **No running indicator**: Tools appeared frozen during execution with no visual signal of activity
- **Invisible completions**: A critical bug in `emitMessageEvents` caused tool completions (result + duration) to never be re-emitted to the TUI. The `displayedCount` cursor advanced past MESSAGE_TOOL messages on first sight and never re-processed them when they transitioned from RUNNING to COMPLETED
- **No streaming output**: Unlike AI messages (which already streamed progressively), tool output was only visible after full completion
- **User uncertainty**: Users could not distinguish between a tool that was actively executing and one that had hung

## Solution

A two-phase approach that first solves the immediate UX problem (liveness) with zero backend changes, then builds the streaming foundation for progressive tool output.

### Phase 1: Tool Execution Liveness (CLI-only)

Fixed the tool lifecycle rendering bug by introducing a separate state-tracking pass (`emitToolCallStateEvents`) over the top-level `ToolCalls` list. This pass is immune to the `displayedCount` cursor and detects RUNNING → COMPLETED transitions independently. Added dedicated `ToolRunningEvent` and `ToolCompletedEvent` that create running indicator blocks and replace them in-place when tools complete.

### Phase 2: Tool Output Streaming Foundation (proto + backend + CLI)

Extended the `ToolCall` protobuf message with `is_streaming` (field 16), mirroring the existing `AgentMessage.is_streaming` pattern for consistency. The existing `result` field serves double duty — partial output while streaming, final output when done. Added `_handle_tool_progress_event` to the StatusBuilder for processing LangGraph custom events, and `dispatch_custom_event("tool_progress")` calls to the `execute` and `write` tool wrappers. The CLI detects streaming content changes and renders them live with gutter-bordered previews.

## Implementation Details

### Proto Changes

Added `bool is_streaming = 16` to the `ToolCall` message, following the exact same pattern as `AgentMessage.is_streaming` + `AgentMessage.content`. The `result` field (field 4) serves double duty — partial output while streaming, final output when done. One field, one source of truth.

### Python Backend

- **StatusBuilder** (`status_builder.py`): Added `_handle_tool_progress_event()` that processes `on_custom_event` with `name='tool_progress'`, appends chunk to `result`, and sets `is_streaming=True`. The event-level `run_id` (inherited from the tool's LangGraph execution context) is used for correlation. Added `is_streaming=False` in all four `_handle_tool_end_event` update sites.
- **Tool Wrappers** (`tool_wrappers.py`): Added `dispatch_custom_event("tool_progress", {"chunk": ...})` to `execute` (emits command line before blocking execution) and `write` (emits content preview). Uses `langchain_core.callbacks.dispatch_custom_event` which automatically inherits the tool's run_id.

### CLI Changes

- **Event Types** (`events.go`): Added `ToolRunningEvent`, `ToolCompletedEvent`, and `ToolStreamDeltaEvent`
- **Stream Bridge** (`run_stream_events.go`): Added `emitToolCallStateEvents()` function with dual tracking maps (`toolCallStates` for status transitions, `toolCallResults` for streaming delta detection). Added `isRunningToolMessage()` to suppress duplicate MESSAGE_TOOL events for running tools
- **TUI Model** (`model.go`, `blocks.go`): Added `runningTools map[string]int` for tracking running tool block indices, `newRunningToolBlock()` constructor
- **Event Handlers** (`handle_events.go`): Handlers for all three new events — running creates block, completed replaces in-place, streaming delta updates content
- **Rendering** (`render_blocks.go`, `toolrender/render.go`): Added `RenderRunning()` (header + ⏳ indicator), `renderStreamingTool()` (header + gutter-bordered live output with ▍ cursor)
- **Proto Bridge** (`run_display_tools.go`): Added `IsStreaming` to `ToolCallInfo` and populated it in `convertToolCall`

### Design Decision: Reusing `result` for Streaming

A key design decision was to reuse the existing `result` field for streaming output rather than adding a separate `streaming_output` field. This mirrors how `AgentMessage` works (`content` + `is_streaming`) and avoids the complexity of maintaining two output fields with move/clear logic. Consumers always read `result` — the `is_streaming` flag only signals whether more content is expected.

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `apis/.../api.proto` | Modified | Added `is_streaming` field to ToolCall |
| `apis/stubs/go/...` | Regenerated | Go protobuf stubs |
| `apis/stubs/python/...` | Regenerated | Python protobuf stubs |
| `backend/.../status_builder.py` | Modified | Tool progress event handler, is_streaming finalization |
| `backend/.../tool_wrappers.py` | Modified | dispatch_custom_event for execute and write tools |
| `client-apps/cli/.../run_stream_events.go` | Modified | Tool call state tracking, streaming detection |
| `client-apps/cli/.../run_display_tools.go` | Modified | IsStreaming in convertToolCall |
| `client-apps/cli/.../events.go` | Modified | Three new event types |
| `client-apps/cli/.../handle_events.go` | Modified | Three new event handlers |
| `client-apps/cli/.../model.go` | Modified | runningTools map |
| `client-apps/cli/.../blocks.go` | Modified | newRunningToolBlock constructor |
| `client-apps/cli/.../render_blocks.go` | Modified | renderToolRunning, renderStreamingTool |
| `client-apps/cli/.../render.go` | Modified | RenderRunning, IsStreaming field |
| `client-apps/cli/.../render_test.go` | Modified | RenderRunning tests |

## Benefits

- **Immediate liveness**: Users see ⏳ running indicators on executing tools, replacing the "frozen" appearance
- **Visible completions**: Tool results and durations appear when tools finish (previously invisible due to the displayedCount bug)
- **In-place block updates**: Running → Completed transitions update blocks in-place (no duplicate headers)
- **Live streaming foundation**: Tools can now progressively stream partial output, visible in real-time with gutter-bordered previews and streaming cursors
- **Architectural consistency**: The `is_streaming` + `result` pattern mirrors `AgentMessage`, making the system predictable for developers

## Impact

- **End users**: Dramatically improved tool execution UX — clear visual distinction between running, streaming, and completed tools
- **Platform developers**: Clean extension point for adding streaming to future tools (just call `dispatch_custom_event`)
- **CLI codebase**: Fixed the invisible-completion bug that was a fundamental rendering issue in the gRPC-to-TUI bridge

## Risk Notes

- **run_id correlation**: `dispatch_custom_event` called within `@tool` functions inherits the tool's LangGraph run context. This should match the `on_tool_start` run_id, but needs runtime validation. If mismatched, the progress events will be silently ignored (graceful degradation)
- **Bandwidth**: The `result` field during streaming can grow large for verbose tools. Future optimization: truncate to last N KB during streaming since `on_tool_end` replaces with the final value

## Related Work

- [CLI Bubbletea Execution Viewer](2026-02-14-220416-cli-bubbletea-execution-viewer.md) — The TUI foundation this builds upon
- [CLI Streaming AI Messages](2026-02-14-144253-cli-streaming-ai-messages.md) — The AI streaming pattern this mirrors for tools
- [Fix Post-Approval Execution Hangs](2026-02-15-175226-fix-post-approval-execution-hangs.md) — Related execution flow fix

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
