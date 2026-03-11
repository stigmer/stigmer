# Fix Sub-Agent Approval Race: "has no pending approvals"

**Date**: March 11, 2026

## Summary

Fixed a race condition where submitting an approval for a sub-agent tool call failed with `FailedPrecondition: execution has no pending approvals`. The root cause was that the Python status_builder set `phase=WAITING_FOR_APPROVAL` during streaming but deferred populating the proto's `pending_approvals` field until after the stream ended — creating a window where progressive gRPC updates persisted an inconsistent state to the DB.

## Problem Statement

When a sub-agent's tool required approval (e.g., `Execute(find ...)` during an infrastructure scan), the CLI detected the waiting state and prompted the user. After the user approved, the CLI submitted the approval to the server, which loaded the execution from the DB and validated it. The server found `phase=WAITING_FOR_APPROVAL` (correct) but `pending_approvals` was empty — failing validation with "has no pending approvals". All 3 retry attempts failed.

### Pain Points

- Sub-agent tool approvals were completely broken — user could not approve and had to re-attach
- The error persisted across retries because the race window was longer than the retry backoff
- The CLI's defense-in-depth path (designed for re-attach scenarios) was also triggering during initial streaming, exacerbating the timing issue

## Solution

Populate `current_status.pending_approvals` immediately when `_populate_pending_approval` is called (during streaming), instead of deferring to the post-stream interrupt capture. The `interrupt_id` field is left empty at this stage — the post-stream interrupt capture replaces the early entries with enriched versions that include LangGraph-assigned interrupt IDs.

## Implementation Details

### `_populate_pending_approval` (production path)

Now creates a `PendingApproval` proto with all available fields (`tool_call_id`, `tool_name`, `message`, `args_preview`, `from_sub_agent`, `sub_agent_name`) and appends it to `current_status.pending_approvals`. For sub-agent tools, also calls `sync_sub_agent_pending_approvals()` for dual-surface display. Sets `force_next_update = True` to ensure the next progressive gRPC push includes the approval.

The `tool_call_id` is resolved through `_run_id_aliases` to handle the reconciliation path (where `ToolCall.id` is a temp_id, not the LangGraph run_id).

### `_remove_from_pending` (cleanup path)

Now also removes individual entries from `current_status.pending_approvals` during per-tool processing — previously only removed from the internal list and sub-agent pending_approvals. This keeps the proto state consistent for batch approval scenarios.

### `set_tool_waiting_approval` (public API, used by tests)

Fixed the already-created-but-unused `PendingApproval` (was `_pending = PendingApproval(...)  # noqa: F841`) to actually append to `current_status.pending_approvals`, sync sub-agent approvals, and force update.

### Post-stream interrupt capture (unchanged)

The existing code in `execute_graphton.py` clears and replaces `pending_approvals` with enriched versions (`del [:]` + `.extend(...)`), which correctly upgrades the preliminary entries with `interrupt_id` values needed for LangGraph resume.

## Benefits

- Sub-agent tool approvals work reliably — no more "has no pending approvals" errors
- Progressive gRPC updates include both `phase=WAITING` and non-empty `pending_approvals` atomically
- The CLI's primary approval path (checking `pending_approvals`) now fires correctly during streaming
- The defense-in-depth path is no longer triggered unnecessarily (since `pending_approvals` is non-empty)
- Batch approval state stays consistent during individual tool processing

## Impact

- **CLI users**: Can now approve sub-agent tools without encountering the race condition
- **Reliability**: Eliminates a non-transient failure that persisted across retries
- **Correctness**: Proto state (`phase` + `pending_approvals`) is now consistent at every progressive update

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display`
- Changelog: `2026-03-11-035511-fix-sub-agent-subject-shows-full-prompt`
- Changelog: `2026-03-10-043512-sub-agent-subject-simplification-and-approval-dual-surfacing`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
