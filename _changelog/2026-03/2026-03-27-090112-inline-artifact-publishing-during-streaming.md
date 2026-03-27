# Inline Artifact Publishing During Streaming

**Date**: March 27, 2026

## Summary

Execution artifacts now appear in the UI immediately after each write/edit tool call completes, rather than only after the entire execution finishes. This is achieved by fire-and-forget background uploads triggered from the streaming event loop, with the existing post-stream auto-publish retained as a deduplicating safety net.

## Problem Statement

Artifacts (files created or modified by the agent) were only published to the UI after the entire LangGraph stream completed. For long-running executions with multiple file writes, users had no visibility into generated content until the agent finished — sometimes minutes after the first file was written.

### Pain Points

- Users could not see or download artifacts until execution completed
- No incremental feedback on file-producing work (skill creation, code generation)
- The infrastructure for live delivery already existed (progressive gRPC updates every 500ms–5s, server-streaming subscription) but artifacts weren't included in those updates

## Solution

Move artifact publishing from a post-stream-only operation to an inline streaming operation. When a write/edit tool completes:

1. **StreamExecutor** detects the `on_tool_end` event for file-modifying tools
2. Extracts the file path from the tracked tool call
3. Fires a background `asyncio.create_task` that reads the file from the sandbox, uploads it to R2, and registers it on the status proto
4. The next progressive gRPC `update_status` cycle carries the artifact to the UI

The sandbox is the source of truth — file bytes are always read from the sandbox, not from tool call content. This makes the architecture format-agnostic (text, binary, images, any future file type).

## Implementation Details

### `status_builder.py` — Live artifact sync with dedup

- `add_artifact()` now immediately upserts into `current_status.artifacts` (deduplicating by `sandbox_path`) and sets `force_next_update = True`
- `finalize_context_info()` reconciles without duplicating already-synced artifacts

### `streaming.py` — Inline publish trigger

- New `on_file_written` async callback parameter on `StreamExecutor`
- `_maybe_trigger_inline_publish()` detects `on_tool_end` for write/write_file/edit/edit_file tools and fires a background task
- `pending_publish_tasks` property exposes in-flight tasks for post-stream draining

### `execute_graphton.py` — Callback wiring

- `_publish_file_inline` closure captures sandbox, storage, status_builder in scope
- Normalizes path, calls `publish_artifact`, registers artifact — never raises (fire-and-forget safety)
- Passes `pending_publish_tasks` to `process_post_stream`

### `attachments.py` — Safety net dedup

- `auto_publish_written_files` accepts `already_published_paths` parameter
- Skips paths already published inline, avoiding redundant uploads

### `post_stream.py` — Task draining

- Awaits in-flight inline publish tasks (10s timeout) before running the safety net
- Always runs safety net with dedup to catch any missed files

### Test fix (pre-existing)

- Fixed incorrect mock patch target in `test_auto_publish.py`: `worker.activities.execute_graphton.publish_artifact` → `worker.activities.graphton.attachments.publish_artifact` (tests were already broken on main)

## Benefits

- **Immediate artifact visibility**: Users see files as they're created, not after execution ends
- **Zero UI/SDK changes required**: `useExecutionArtifacts` and the `subscribe` stream already support this — artifacts just weren't included in progressive updates before
- **Zero proto changes**: `ExecutionArtifact` and `AgentExecutionStatus.artifacts` already had the right structure
- **Future-proof for binary content**: Sandbox-based upload works for any file type (text, images, archives)
- **No streaming latency impact**: Fire-and-forget background tasks don't block the event loop

## Impact

- **5 production files** modified (~120 lines of production code)
- **1 new test file** created (12 tests for StatusBuilder and StreamExecutor inline behavior)
- **4 new tests** added to existing test file (dedup behavior)
- **15 pre-existing test patches fixed** (corrected mock target)
- **36 total tests** passing

---

**Status**: ✅ Production Ready
