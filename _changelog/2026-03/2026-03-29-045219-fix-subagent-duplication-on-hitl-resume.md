# Fix SubAgent Duplication on HITL Resume

**Date**: March 29, 2026

## Summary

Fixed duplicate `SubAgentExecution` entries created on every HITL resume cycle when a sub-agent's tools require approval. The root cause was that task tools lacked resume deduplication when `astream_events` did not replay the AI message's `tool_use` blocks. A new `prepare_task_tool_resume_queue()` method pre-populates the early tool call queue from persisted status, enabling the existing reconciliation machinery to correctly match resumed task tools with their original SubAgentExecution entries.

## Problem Statement

When a sub-agent's tools require HITL approval, the parent graph pauses via `InterruptProxyRunnable`. On resume (new Temporal activity invocation), LangGraph re-executes the parent's tool node, firing `on_tool_start` for each `task` tool with new `run_id`s. Because the AI message node completed in a prior checkpoint and is not re-executed, `_create_early_tool_call` is never called, leaving `_early_tool_call_queue` empty.

This caused the task handler in `_handle_tool_start_event` to fall through to creating a new `ToolCall` with `id=run_id` (UUID format), which didn't match the original Anthropic `toolu_*` ID stored on the `SubAgentExecution`. Consequently, `_handle_sub_agent_start` created duplicate entries on every resume cycle.

### Pain Points

- Sub-agent sections doubled/tripled in the UI after each approval cycle (e.g., 3 originals became 8 after 2 resume cycles)
- Duplicate `SubAgentExecution` entries with UUID-format IDs (`019d37da-...`) alongside the original `toolu_*` IDs
- Parent AI message accumulated redundant `ToolCall` entries for the same logical task tool invocation
- Production evidence: execution `aex_01kmvxgw2k3f3t85jcs57wsree` showed 8 SubAgentExecutions (3 originals + 5 duplicates)

## Solution

Added `StatusBuilder.prepare_task_tool_resume_queue()` — a method that scans persisted messages for `task` tool calls with matching `SubAgentExecution` entries and pre-populates `_early_tool_call_queue`. This simulates what `_create_early_tool_call` would have done if the AI message had been re-streamed, using the existing reconciliation machinery rather than adding a new dedup path.

## Implementation Details

### Root Cause Flow

1. Parent graph pauses via `InterruptProxyRunnable` for sub-agent HITL
2. New Temporal activity invocation creates `StatusBuilder` from DB-persisted status
3. `ResumeReconciler` runs, but `_early_tool_call_queue` remains empty (no AI replay)
4. `astream_events` with `Command(resume=decisions)` fires `on_tool_start` for task tools
5. `_reconcile_early_tool_call` returns `None` (empty queue)
6. Task handler creates new `ToolCall` with `id=run_id` (UUID)
7. `_handle_sub_agent_start` receives UUID, doesn't match `toolu_*` on existing `SubAgentExecution`
8. Duplicate `SubAgentExecution` created

### The Fix

`prepare_task_tool_resume_queue()` is called after `reconcile_orphans_against_checkpoint()` and before the stream starts. It:

1. Collects all `SubAgentExecution.id` values into a set
2. Iterates persisted AI messages for `task` tool calls
3. For each task tool call whose `tc.id` exists in the SubAgentExecution set, appends `(tc.id, None)` to `_early_tool_call_queue`
4. `sa_id=None` because task tools are called from the main-agent context (no parent sub-agent)

When `on_tool_start` fires, `_reconcile_early_tool_call` now finds the queued entry, sets `_run_id_aliases[new_run_id] = toolu_*`, and returns the original `ToolCall`. The task handler passes `toolu_*` to `_handle_sub_agent_start`, which matches the existing `SubAgentExecution` and reactivates it instead of creating a duplicate.

### Safety Properties

- **Idempotent with AI replay**: If `astream_events` also replays the AI message on some resume paths, `_create_early_tool_call`'s existing dedup re-queues the same entry. `_reconcile_early_tool_call` pops the first match; any leftover entry is harmless.
- **Skips unmatched tasks**: Task tool calls without a corresponding `SubAgentExecution` are not queued — they may represent genuinely new tasks.
- **FIFO ordering preserved**: Task tool calls in persisted messages appear in the same order as LangGraph's checkpoint tool calls, maintaining correct FIFO matching.

## Files Changed

- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`
  - Added `prepare_task_tool_resume_queue()` method after `populate_fingerprints_from_existing_tool_calls()`
  - Scans persisted messages, matches task TCs against SubAgentExecutions, populates `_early_tool_call_queue`

- `backend/services/agent-runner/worker/activities/execute_graphton.py`
  - Added call to `status_builder.prepare_task_tool_resume_queue()` in resume initialization (Step 7.8)
  - Placed after `reconcile_orphans_against_checkpoint()`, before the streaming phase

- `backend/services/agent-runner/tests/test_hitl_contracts.py`
  - Added 4 new tests to `TestTaskToolResumeReconciliation`:
    - `test_prepare_task_tool_resume_queue_populates_queue`
    - `test_task_on_tool_start_without_ai_replay_reactivates_subagent`
    - `test_prepare_skips_task_tools_without_subagent`
    - `test_prepare_is_idempotent_with_ai_replay`

## Benefits

- **No more duplicate sub-agents**: Each resume cycle reactivates existing SubAgentExecutions instead of creating new ones
- **Minimal blast radius**: Two production files modified, leveraging existing reconciliation machinery
- **No changes to graph compilation or interrupt proxying**: The fix is scoped entirely to StatusBuilder's event tracking
- **Full backward compatibility**: Fresh (non-resume) executions are unaffected — the queue is only populated on resume paths

## Impact

- **Agent Runner**: All HITL agent executions with sub-agents now correctly deduplicate on resume
- **StatusBuilder**: `_early_tool_call_queue` is properly initialized for both AI-replay and no-replay resume scenarios
- **Frontend**: Sub-agent sections no longer duplicate after approval cycles
- **Test suite**: All 1363 tests pass (72 HITL contract tests including 4 new)

## Related Work

- `2026-03-29-095041-fix-interrupt-proxy-callback-context.md` — prior fix that restored sub-agent event visibility; this fix addresses the remaining duplication issue on resume

---

**Status**: ✅ Production Ready
**Timeline**: Single session
