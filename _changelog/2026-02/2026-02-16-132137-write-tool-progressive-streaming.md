# Write Tool Progressive Streaming UX

**Date**: February 16, 2026

## Summary

Implemented progressive content streaming for the Write tool to display file content in real-time as it's being written. The TUI now shows a live typewriter effect with a gutter-bordered preview and cursor indicator, replacing the previous static spinner that provided no visual progress feedback. The streaming infrastructure was already fully built end-to-end; this change activates it by modifying the Write tool to emit progressive `tool_progress` events.

## Problem Statement

When agents write files, especially larger ones, the CLI TUI displayed only a static `📝 Write: file.md ⏳` indicator with no visual progress. For files that take time to write (larger content or slower sandbox connections), this created a "stuck" feeling where users couldn't tell if execution was progressing or frozen. The lack of feedback during write operations reduced confidence in the system's responsiveness.

### Pain Points

- **No visual progress**: Write operations showed a frozen spinner with no content preview
- **User confusion**: During multi-second writes, users couldn't distinguish between "working" and "stuck"
- **Wasted infrastructure**: The TUI's `renderStreamingTool()` and full `ToolStreamDeltaEvent` pipeline existed but were unused by Write
- **Inconsistent UX**: Execute tool had some streaming feedback, but Write (equally time-consuming) had none

## Solution

Modified the Write tool to emit file content progressively via multiple `tool_progress` events instead of a single preview event. The streaming uses adaptive line-based chunking to show content appearing gradually in the TUI, creating a natural typewriter effect that signals active progress to the user.

### Key Design Decisions

**Progressive Chunking Strategy**:
- Files < 15 lines: Single chunk (no artificial delay) — keeps trivial writes instant
- Files ≥ 15 lines: Adaptive chunking targeting ~20 update cycles regardless of file size
- Chunk size formula: `max(3, total_lines // 20)`
- Inter-chunk delay: 50ms (yields to event loop for status updates)
- Total streaming phase: ~1 second maximum (20 chunks × 50ms)

**Why These Numbers**:
- 15-line threshold: Balances "feels instant" vs "shows progress" — most single-function files stay fast
- ~20 chunks target: Provides smooth visual cadence without overwhelming the update scheduler
- 50ms delay: Aligns with StreamingUpdateScheduler's 500ms min interval (accumulates 10 chunks per gRPC update)
- 1 second max: Acceptable latency for visual feedback without feeling artificially slow

## Implementation Details

### Core Changes

**File**: `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py`

1. **Added streaming helper function** (`_stream_write_content()`):
   - Takes file content as input
   - Splits into lines, calculates adaptive chunk size
   - Emits `tool_progress` events progressively with `asyncio.sleep()` between chunks
   - First chunk emitted immediately; subsequent chunks prepend `\n` for clean concatenation

2. **Modified Write tool**:
   - Replaced single `dispatch_custom_event` with `await _stream_write_content(content)`
   - Streaming happens **before** `backend.write()` — shows "what will be written"
   - Actual write to sandbox occurs after all chunks are streamed

3. **Tuning constants** (module-level):
   ```python
   _WRITE_STREAMING_THRESHOLD = 15       # Lines below threshold: single chunk
   _WRITE_TARGET_CHUNKS = 20             # Target number of chunks for larger files
   _WRITE_CHUNK_DELAY_S = 0.05           # 50ms sleep between chunks
   ```

### Pipeline Flow

The full streaming pipeline (already built, now activated):

```
Write tool: _stream_write_content()
    ↓ emits tool_progress events
StatusBuilder._handle_tool_progress_event()
    ↓ appends chunks to tool_call.result, sets is_streaming=True
StreamingUpdateScheduler
    ↓ triggers gRPC updates every ~500ms
CLI: emitToolCallStateEvents()
    ↓ detects content change, emits ToolStreamDeltaEvent
TUI: renderStreamingTool()
    ↓ shows gutter-bordered preview with cursor ▍
```

### Lifecycle Example

For a 50-line file:
1. `on_tool_start` → TUI shows `📝 Write: file.md ⏳`
2. Chunks 1-20 emitted over ~1 second → `tool_call.result` accumulates, `is_streaming=True`
3. TUI receives `ToolStreamDeltaEvent` every ~500ms (via gRPC updates) → shows latest 8 lines with cursor `▍`
4. `backend.write()` completes → actual I/O to sandbox
5. `on_tool_end` → `tool_call.result` replaced with `"Successfully wrote 1234 characters..."`, `is_streaming=False`
6. TUI receives `ToolCompletedEvent` → replaces running block with expandable result

### Testing

**New test suite**: `TestStreamWriteContent` (9 tests)
- `test_small_file_emits_single_chunk` — verifies fast path
- `test_large_file_emits_multiple_chunks` — verifies chunking activates
- `test_chunks_concatenate_to_original_content` — lossless reconstruction
- `test_trailing_newline_preserved` — edge case handling
- `test_empty_content_emits_single_chunk` — edge case
- `test_async_sleep_called_between_chunks` — confirms yielding
- `test_no_sleep_for_small_files` — confirms no artificial delay for fast path
- `test_all_events_use_tool_progress_name` — event naming consistency
- `test_chunk_count_scales_with_target` — adaptive chunking validation

**Test results**: 64 tests passed (55 existing + 9 new), 2 pre-existing failures unrelated to this work.

## Benefits

### User Experience
- **Visual progress feedback**: Users see content appearing line-by-line, confirming the agent is actively working
- **Confidence during writes**: No more wondering if the execution is stuck — the streaming cursor signals liveness
- **Familiar pattern**: Matches the typewriter effect users see during AI message streaming

### Technical
- **Activates existing infrastructure**: The TUI's `renderStreamingTool()` and `ToolStreamDeltaEvent` handling were built but unused
- **Minimal latency cost**: ~1 second added for the streaming phase, which enhances UX rather than feeling slow
- **Adaptive performance**: Small files stay instant (< 15 lines), large files get smooth progress without overwhelming the system
- **No schema changes**: Uses existing `is_streaming` and `result` fields on `ToolCall` proto

### Developer Experience
- **Single-file change**: Core logic isolated in one new helper function
- **Comprehensive tests**: 9 new unit tests validate chunking, timing, and edge cases
- **Easy to tune**: Three module-level constants control threshold, chunk count, and delay

## Impact

### Who's Affected
- **CLI users**: Immediate UX improvement during agent executions that write files
- **Agent developers**: Better feedback when testing agents that generate code or documentation
- **Platform team**: Demonstrates that the streaming infrastructure is production-ready and extensible to other tools

### What Changed
- **User-visible**: Write operations now show progressive content preview in TUI
- **Internal**: Write tool emits multiple `tool_progress` events instead of one
- **No breaking changes**: API contracts unchanged; existing agents work without modification

### Metrics
- **File write operations**: +1 second max for streaming phase (50-line file ≈ 1 second, 500-line file ≈ 1 second)
- **Test coverage**: +9 tests for streaming helper function
- **Code complexity**: +60 lines (helper function + constants + documentation)

## Related Work

**Foundation Work** (already completed):
- `StatusBuilder._handle_tool_progress_event()` — accumulates streaming chunks
- `StreamingUpdateScheduler` — batches gRPC updates with adaptive timing
- `executiontui/renderStreamingTool()` — TUI rendering for streaming tools
- `run_stream_events.go: ToolStreamDeltaEvent` — CLI event handling

**Future Opportunities**:
- **Edit tool streaming**: Could show diff chunks progressively (smaller scope, less impactful)
- **Read tool preview**: Could stream file content as it's read (helpful for very large files)
- **Execute tool stdout**: Already has some streaming via `tool_progress`, could be enhanced

**Design Inspiration**:
- Cursor's own real-time code generation display
- Terminal output during long-running commands
- Chat UI token streaming patterns

## Technical Notes

### Why Streaming Before Write?
The streaming phase shows "what will be written" before the actual `backend.write()` call. This is honest and useful:
- Users see the content immediately to verify correctness
- The actual sandbox I/O happens after visual confirmation
- Aligns with approval flows (users can see what they're approving)

### Cleanup on Completion
`StatusBuilder._handle_tool_end_event()` cleanly replaces the accumulated streaming content with the tool's final return value (`"Successfully wrote N characters to 'path'"`) and sets `is_streaming=False`. No manual cleanup needed — the existing infrastructure handles the transition.

### Why Not Stream During Write?
Could we stream as bytes are written to the sandbox? Possibly, but:
- Adds complexity to backend abstraction layer
- Sandbox writes are typically fast (< 100ms for most files)
- The visual streaming phase provides better UX than waiting for I/O
- Current approach is non-invasive (no backend changes)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (investigation + implementation + testing)
**Files Changed**: 2 (1 source file, 1 test file)
**Lines Added**: ~80 (60 implementation + 20 tests)
