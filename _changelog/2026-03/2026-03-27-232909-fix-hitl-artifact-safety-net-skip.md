# Fix Artifact Safety Net Skipping for HITL-Gated Executions

**Date**: March 27, 2026

## Summary

Fixed a bug where files written by the agent during HITL-gated executions were silently lost from the Artifacts sidebar. The post-stream auto-publish safety net was incorrectly skipped when the execution phase was `WAITING_FOR_APPROVAL`, `PAUSED`, or `FAILED`, leaving no fallback if the inline publish failed.

## Problem Statement

When an agent wrote a file (e.g., `mcp-server-stigmer.yaml`) and a subsequent tool call required HITL approval, the written file never appeared in the execution artifacts sidebar.

### Pain Points

- The two-stage artifact publish pipeline (inline publish + post-stream safety net) had a gap: the safety net was gated behind a phase check that excluded `WAITING_FOR_APPROVAL`, `PAUSED`, and `FAILED`
- If the inline publish (Stage 1) failed silently — which is by design, as it swallows exceptions — Stage 2 was the only fallback, but it was skipped for these phases
- On resume after approval, LangGraph does not re-fire `on_tool_end` for previously completed tools, so the inline publish opportunity is permanently lost
- The inline publish error message ("safety net will retry") was misleading because the safety net did not retry for these phases

## Solution

Removed the phase-based exclusion from the auto-publish safety net in `process_post_stream()`. The safety net now runs unconditionally, which is safe because it already has built-in guards: it only operates on `TOOL_CALL_COMPLETED` tool calls and uses `already_published_paths` dedup to avoid redundant uploads.

## Implementation Details

### `post_stream.py` — Remove phase gate

Removed the `if current_phase not in (FAILED, PAUSED, WAITING_FOR_APPROVAL)` conditional that was wrapping the `auto_publish_fn()` call. The safety net now executes for every post-stream run.

### `execute_graphton.py` — Fix misleading error message

Updated the inline publish catch block from `"safety net will retry"` to `"post-stream safety net will attempt"` to accurately describe the fallback behavior.

## Benefits

- Files written during HITL-gated executions now reliably appear as downloadable artifacts
- Files written before an execution failure are preserved as artifacts
- Files written before a user-initiated pause are preserved as artifacts
- The error message in inline publish no longer makes false promises about retry behavior

## Impact

- **Agent Runner**: `post_stream.py` and `execute_graphton.py` in the Graphton execution pipeline
- **End Users**: Artifacts that were silently lost in HITL approval flows now appear in the execution sidebar
- **No behavioral change for happy path**: When inline publish succeeds, the safety net detects the already-published path and skips it via existing dedup logic

## Related Work

- Part of the broader HITL approval flow hardening effort (see `2026-03-26-201753-hitl-approval-flow-hardening.md`)
- Builds on the inline artifact publish infrastructure added for real-time artifact visibility

---

**Status**: ✅ Production Ready
