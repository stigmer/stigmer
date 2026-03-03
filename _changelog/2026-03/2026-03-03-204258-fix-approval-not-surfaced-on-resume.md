# Fix: Approval Prompt Not Surfaced on Session Resume

**Date**: March 3, 2026

## Summary

Added defense-in-depth approval detection to the CLI stream path so that
approval prompts reliably appear when a user re-attaches to a session with
a `WAITING_FOR_APPROVAL` execution. The fix scans tool call statuses as a
fallback when the backend's initial snapshot omits `pending_approvals` due
to MongoDB write-ordering or replication lag.

## Problem Statement

When a user detaches from an execution that is waiting for approval and
then re-attaches via `stigmer run ses-XXX`, the approval prompt may not
appear. The user sees the execution is paused (header shows
`waiting_for_approval`, tool blocks show the pause badge) but has no way
to respond.

### Pain Points

- Users get stuck on resume with no interactive approval prompt
- The only workaround is to cancel and re-run the agent
- Sub-agent approvals are particularly affected since they are nested
  deeper in the execution state

### Root Cause

The live stream path (`streamToEvents`) relies exclusively on the
`pending_approvals` field from the backend's execution proto. When the
user re-attaches, the backend's `Subscribe` handler reads from MongoDB to
build the initial snapshot. Due to write-ordering between Redis (where the
approval event is published) and MongoDB (where the execution state is
persisted), `pending_approvals` may be empty in that initial snapshot. The
Redis stream uses the `>` offset, so previously published messages are not
re-delivered.

## Solution

Defense-in-depth approval detection on the stream path: when
`pending_approvals` is empty but the execution phase is
`WAITING_FOR_APPROVAL`, fall back to scanning tool call statuses (both
top-level and sub-agent) for `TOOL_CALL_WAITING_APPROVAL`. For each
unprompted tool call found, construct a synthetic `PendingApproval` and
route it through the existing `emitAndWaitApproval` path.

## Implementation Details

### New types and functions (`run_stream_approval.go`)

- `unpromptedApproval` struct: pairs a `ToolCall` with sub-agent
  provenance (`fromSubAgent` flag and `subAgentName`)
- `findAllUnpromptedApprovals()`: scans both top-level `ToolCalls` and
  `SubAgentExecution.ToolCalls` for unprompted `WAITING_APPROVAL` entries.
  Returns all matches (not just the first), with sub-agent context for
  accurate TUI rendering

### Stream path integration (`run_stream_events.go`)

Added Step 3b after the existing Step 3 in `streamToEvents`:
- Guarded by: `pending_approvals` is empty AND phase is
  `WAITING_FOR_APPROVAL`
- Constructs synthetic `PendingApproval` via existing
  `buildPendingApprovalFromToolCall`, enriched with `FromSubAgent` and
  `SubAgentName` from the tool call's sub-agent provenance
- Includes diagnostic debug logging for observability

### Architecture decision

The fix targets the stream path, not the snapshot path. The snapshot path
(`snapshotToEvents`) only processes terminal executions and has no gRPC
plumbing for interactive approval submission — emitting
`ApprovalNeededEvent` there would leave the user's response undelivered.

### Tests (`run_stream_events_test.go`)

6 new unit tests:
- `TestFindAllUnpromptedApprovals_TopLevel`
- `TestFindAllUnpromptedApprovals_SubAgent`
- `TestFindAllUnpromptedApprovals_AlreadyPrompted`
- `TestFindAllUnpromptedApprovals_Mixed`
- `TestFindAllUnpromptedApprovals_EmptyToolCallID_Skipped`
- `TestBuildPendingApprovalFromToolCall_SubAgentEnrichment`

## Benefits

- Approval prompts reliably appear on session resume regardless of
  backend snapshot timing
- Sub-agent approvals are correctly attributed in the TUI approval block
- Zero changes to the TUI layer — the existing `ApprovalNeededEvent`
  handling works unchanged
- Defense-in-depth: does not replace the primary `pending_approvals`
  path; only activates when that path is empty

## Impact

- **Users**: No more stuck approvals on resume. The approval prompt
  appears within the first stream update, typically under 1 second.
- **Maintainers**: The fallback path is clearly documented with debug
  logging. The `findAllUnpromptedApprovals` function is reusable for
  future approval-related features (e.g., tiered approval policies).
- **Backend team**: Tracked as out-of-scope follow-up: ensure
  `pending_approvals` is populated in the initial Subscribe snapshot
  from MongoDB.

## Related Work

- [2026-03-01-211555-fix-sub-agent-approval-not-shown-in-cli.md](2026-03-01-211555-fix-sub-agent-approval-not-shown-in-cli.md) —
  The original fix that made sub-agent approvals work in the TUI
- Issue: `_cursor/issues/tui-resume-flow-approval-not-surfaced.md`
- Project: `_projects/2026-03/20260303.02.cli-tui-ux-hardening/`
  (Phase 1.1)

---

**Status**: ✅ Production Ready (pending manual verification)
**Timeline**: 1 session
