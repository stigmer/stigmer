---
name: Write Tool Streaming UX
overview: Add progressive content streaming to the Write tool so users see a live typewriter effect in the TUI during file writes, instead of a frozen spinner. The streaming infrastructure already exists end-to-end; only the Write tool's event emission needs to change.
todos:
  - id: implement-chunked-streaming
    content: Modify the write tool in tool_wrappers.py to emit progressive tool_progress events in chunks with async sleep between them, replacing the single-preview approach
    status: completed
  - id: manual-test
    content: Run an agent execution that triggers a Write on a non-trivial file and verify the streaming effect in the TUI
    status: completed
isProject: false
---

# Write Tool Progressive Streaming

## Problem

When the Write tool executes, the TUI shows a static `📝 Write: file.md ⏳` indicator with no visual progress. The tool emits exactly one `tool_progress` event (a 10-line preview), then blocks on `backend.write()`. For larger files or slower sandbox connections, this creates a "stuck" feeling where the user cannot tell if execution is progressing.

## Key Finding: The Streaming Pipeline Already Exists

The entire streaming infrastructure is **already built and wired up**. It just isn't being used by the Write tool:

```
tool_progress event -> StatusBuilder._handle_tool_progress_event()
    -> appends chunk to tool_call.result, sets is_streaming=True
    -> StreamingUpdateScheduler triggers gRPC update (~500ms intervals)
    -> CLI emitToolCallStateEvents() detects content change
    -> emits ToolStreamDeltaEvent
    -> TUI renderStreamingTool() shows live gutter-bordered preview with cursor ▍
```

The TUI already has `renderStreamingTool()` in `[render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)` (lines 112-140) that renders beautiful gutter-bordered streaming output:

```
📝 Write: agent-drafter/SKILL.md ⏳
     │ # Agent Drafter
     │ Guide for creating valid Stigmer Agent YAML files...▍
```

The event handling in `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)` (lines 85-89) already handles `ToolStreamDeltaEvent` by updating the running tool block in-place. The bridge in `[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` (lines 276-285) already detects streaming content changes on running tools.

## What Changes

**Single file**: `[backend/libs/python/graphton/src/graphton/core/tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py)` -- the `write` tool function (lines 902-942).

### Current Implementation (lines 919-934)

```python
# Emits ONE event, then blocks on write
preview_lines = content.split("\n")[:10]
preview = "\n".join(preview_lines)
if len(content.split("\n")) > 10:
    preview += f"\n... ({len(content)} chars total)"
dispatch_custom_event("tool_progress", {"chunk": preview})
backend.write(path, content)
```

### New Implementation

Replace the single preview + synchronous write with progressive chunked streaming:

1. Split content into lines
2. Group lines into chunks (adaptive chunk size targeting ~20 update cycles)
3. Emit each chunk as a `tool_progress` event with a short `await asyncio.sleep()` between chunks
4. After all chunks are emitted, perform the actual `backend.write(path, content)`

Design parameters:

- **Small file guard**: Files with fewer than ~15 lines emit all content as a single chunk (no artificial delay -- they complete instantly)
- **Chunk sizing**: `chunk_size = max(3, total_lines // 20)` -- targets ~20 streaming updates regardless of file size
- **Inter-chunk delay**: `0.05s` (50ms) per chunk -- total streaming phase takes ~1 second for any file size
- **Total added latency**: ~1 second max for the streaming phase, which is acceptable and creates a natural visual cadence

### Lifecycle

1. `on_tool_start` fires -- TUI shows `📝 Write: file.md ⏳`
2. Progressive `tool_progress` events fire -- chunks accumulate in `tool_call.result`, `is_streaming=True`
3. TUI receives `ToolStreamDeltaEvent` every ~500ms -- shows latest lines with cursor ▍
4. `backend.write()` completes
5. `on_tool_end` fires -- `tool_call.result` is replaced with final return value, `is_streaming=False`
6. TUI receives `ToolCompletedEvent` -- replaces running block with expandable result block

## What Does NOT Change

- **TUI code (Go)**: Already fully supports tool streaming via `ToolStreamDeltaEvent` and `renderStreamingTool()`
- **StatusBuilder (Python)**: Already handles `tool_progress` event accumulation correctly
- **gRPC protos**: No schema changes; `is_streaming` and `result` fields already exist on `ToolCall`
- **StreamingUpdateScheduler**: Already optimized (500ms min interval, 5s keepalive)
- **toolrender package**: Already has Write tool display configuration

## Considerations

- The streaming shows content **before** the actual write to the sandbox. This is an honest representation: "here's what will be written." The actual I/O happens after all content is displayed.
- The `_handle_tool_end_event` in StatusBuilder (line 497) cleanly replaces the accumulated streaming content with the tool's final return value (`"Successfully wrote N characters to 'path'"`) and sets `is_streaming=False`. No cleanup needed.
- The Edit tool also lacks streaming feedback but is a separate concern (smaller diffs, faster operations). Could be a follow-up.

## Testing

- Test with small files (< 15 lines) to verify single-chunk behavior (no artificial delay)
- Test with medium files (~50-100 lines) to verify visible streaming effect
- Test with large files (500+ lines) to verify adaptive chunking keeps total delay reasonable
- Verify the TUI shows the streaming cursor ▍ during the write phase
- Verify the final expandable block shows the correct completion message after write completes

