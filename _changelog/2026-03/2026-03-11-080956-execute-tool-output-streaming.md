# Execute Tool Live Output Streaming

**Date**: March 11, 2026

## Summary

Enabled live output streaming for shell/execute tool calls so users see command output as it arrives, rather than waiting for the entire command to complete. The CLI and StatusBuilder infrastructure were already fully wired — the only missing piece was the backend execution layer, which used blocking `subprocess.run()`. This change adds async streaming subprocess execution and connects it through the existing `tool_progress` event pipeline.

## Problem Statement

After approving an execute/shell tool call, the CLI showed the command being run but no output until the process terminated. For long-running commands (builds, installs, test suites), this created a poor user experience — a silent gap between approval and completion with no indication of progress.

### Pain Points

- Users had no visibility into command execution after approval
- Long-running commands appeared to hang with no feedback
- Write tools already had live streaming (via `_stream_write_content`), creating an inconsistent experience
- The CLI infrastructure for post-approval streaming was fully built but never received data from execute tools

## Solution

Added an async `execute_streaming()` method to `FilesystemBackend` that uses `asyncio.create_subprocess_shell()` with piped stdout/stderr, reads both streams concurrently, and invokes a caller-provided callback for each line of output. The execute tool wrapper dispatches these chunks as `tool_progress` events, which flow through the existing pipeline: StatusBuilder appends to `tool_call.result` with `is_streaming=True`, the gRPC scheduler pushes updates, and the CLI's `renderToolStreamDelta` displays them live.

## Implementation Details

### FilesystemBackend (`filesystem.py`)

- New `async execute_streaming(command, timeout, on_chunk)` method
- Uses `asyncio.create_subprocess_shell()` with `stdout=PIPE, stderr=PIPE`
- Concurrent stdout/stderr reading via `asyncio.gather` with per-stream reader tasks
- `on_chunk` callback invoked for each line as it arrives — backend stays LangGraph-agnostic
- Proper timeout handling: `asyncio.wait_for` wraps the gather, `process.kill()` on expiry, returns exit code 124
- Graceful fallback to sync `execute()` via `asyncio.to_thread` if subprocess creation fails
- Extracted shared `_build_execute_env()` helper, eliminating env setup duplication between sync and async paths
- Returns the same `ExecutionResult` contract (separated stdout/stderr) so downstream formatting is unchanged

### Tool Wrapper (`tool_wrappers.py`)

- `_create_execute_tool()` detects streaming capability via `callable(getattr(backend, 'execute_streaming', None))`
- When available: `await backend.execute_streaming(command, timeout, on_chunk=lambda chunk: dispatch_custom_event("tool_progress", {"chunk": chunk}))`
- When not available (e.g., Daytona backend): falls back to sync `backend.execute()` — output appears all-at-once on completion, same as before
- The command prompt `$ {command}\n` is always emitted first as a `tool_progress` event regardless of path

### StatusBuilder (`status_builder.py`)

- `_handle_tool_progress_event` now sets `force_next_update = True` on the first streaming chunk (when `is_streaming` transitions from `False` to `True`)
- Gives immediate user feedback after approval without waiting for the ~500ms scheduler interval
- Subsequent chunks rely on the normal scheduler cadence — avoids flooding the gRPC stream

### CLI (`run_stream_inline.go`)

- Updated stale comment referencing "Phase 3.4 enables streaming" — this work is that phase
- No functional changes needed — the CLI's post-approval streaming pipeline (`initPostApprovalStreaming`, `renderToolStreamDelta`, `completeStreamingTool`, `trackToolCallStates`) handles everything automatically

## Benefits

- **Immediate feedback**: Users see command output as it arrives, line by line
- **Consistent UX**: Execute tools now stream like write tools — no more silent gaps
- **Zero CLI changes**: The existing streaming infrastructure "just works" once the backend emits chunks
- **Backward compatible**: Sync `execute()` is untouched; backends without streaming support fall back gracefully
- **Clean separation**: Backend yields output lines; tool wrapper decides what to do with them (LangGraph-agnostic design)

## Impact

- **Users**: Shell/execute tool output is now visible in real-time during execution
- **Daytona backend**: Unaffected — continues with sync execution (streaming deferred to separate investigation of Daytona SDK capabilities)
- **Other tools**: No changes — read/edit/grep/glob/delete complete instantly and don't benefit from streaming

## Tests

- 9 new tests for `FilesystemBackend.execute_streaming()`: stdout/stderr capture, on_chunk callback delivery, timeout/kill behavior, cache invalidation, env var passthrough
- 4 new tests for the tool wrapper: streaming-when-available, sync fallback, chunk dispatch verification, failure handling
- 2 new tests for StatusBuilder: first-chunk `force_next_update` behavior, subsequent-chunk no-force behavior
- All 135 existing filesystem backend tests pass
- All 257 existing status builder tests pass

## Related Work

- Builds on the post-approval streaming CLI infrastructure from the sub-agent execution streamline project
- Leverages the `tool_progress` event mechanism originally built for write tool content streaming
- Daytona SDK streaming support is deferred as a follow-up investigation

---

**Status**: ✅ Production Ready
**Files Changed**: 7 (4 source, 3 test)
