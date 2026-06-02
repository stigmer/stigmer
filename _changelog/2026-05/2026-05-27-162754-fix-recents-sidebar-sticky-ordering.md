# Fix Recents Sidebar Sticky Ordering

**Date**: May 27, 2026

## Summary

Fixed the Recents sidebar so it sorts by last activity time instead of creation time. Previously, four sessions were permanently stuck at the top because the sidebar sorted by `specAudit.createdAt` (immutable) while labeling it as `updatedAt`. Sessions with new agent activity never moved up. The fix switches all sort paths — backend MongoDB queries, the unified ListRecentActivityHandler, and the frontend `useRecentActivity` hook — to use `statusAudit.updatedAt`, and ensures that timestamp is reliably bumped on every meaningful status change.

## Problem Statement

The Recents sidebar (left panel showing recent sessions and workflow executions) displayed entries in a fixed order that did not reflect actual user activity. Four specific entries always appeared at the top, and newly created agent executions appeared at the bottom — the opposite of expected "most recent first" behavior.

### Pain Points

- Sessions with recent agent activity (follow-up runs, memory persists) never moved up in the Recents list
- The sidebar sorted by `specAudit.createdAt`, a timestamp written once at creation and never updated
- Both the proto contract and the frontend `RecentActivityEntry.updatedAt` field implied last-activity semantics, but the implementation read creation time
- Several critical code paths (`WorkflowExecutionUpdateStatusHandler`, cancel/terminate handlers, `GenerateSessionSubjectActivityImpl`) never bumped `statusAudit.updatedAt`

## Solution

Three-layer fix: switch the sort field, ensure the field is reliably written, and backfill existing data.

1. **Sort field change**: All three backend list handlers (`SessionListHandler`, `WorkflowExecutionListHandler`, `ListRecentActivityHandler`) and the frontend `useRecentActivity` hook now sort by `statusAudit.updatedAt` instead of `specAudit.createdAt`
2. **Audit reliability**: Four handler code paths that previously skipped audit updates now bump `statusAudit.updatedAt` on every meaningful status change
3. **Data backfill**: A Mongock migration backfills `statusAudit.updatedAt` for existing documents using the most recent agent execution's `startedAt` (for sessions) or `completedAt` (for workflow executions)

## Implementation Details

### Backend (stigmer-cloud) — 8 files

**Sort field migration (3 handlers):**
- `SessionListHandler.java` — sort changed to `status.audit.statusAudit.updatedAt`
- `WorkflowExecutionListHandler.java` — same change
- `ListRecentActivityHandler.java` — all 4 query methods updated (org fast-path + FGA-filtered, sessions + executions), `extractCreatedAt` replaced with `extractUpdatedAt` that falls back to `specAudit.createdAt`, merge comparator now breaks sub-second ties via nanos

**Audit reliability (4 handlers):**
- `WorkflowExecutionUpdateStatusHandler` — bumps `statusAudit.updatedAt` on every runner status update (the hot path for task completions)
- `WorkflowExecutionCancelHandler` — bumps with event `"cancelled"` on graceful cancellation
- `WorkflowExecutionTerminateHandler` — bumps with event `"terminated"` on force-stop
- `GenerateSessionSubjectActivityImpl` — now bumps both `specAudit.updatedAt` and `statusAudit.updatedAt` when persisting auto-generated session subjects (was previously a raw `repo.save()` bypass)

**Migrations (2 new):**
- `U20260527b_RecentsUpdatedAtIndexes` — drops old `specAudit.createdAt` compound indexes, creates new ones on `statusAudit.updatedAt` for both collections
- `U20260527c_BackfillStatusAuditUpdatedAt` — backfills stale `statusAudit.updatedAt` from latest execution timestamps

### Frontend (stigmer) — 2 files

- `useRecentActivity.ts` — new `extractUpdatedAt()` function prefers `statusAudit.updatedAt`, falls back to `specAudit.createdAt` for documents that have never been independently updated
- `useRecentActivity.test.ts` — 6 unit tests verifying timestamp extraction priority, fallback behavior, and merge-sort ordering

## Benefits

- Recents sidebar now shows the most recently *active* entries first, matching user expectations
- New agent runs in existing sessions bubble the session to the top
- Workflow cancellation/termination immediately reflects in recents ordering
- Proto contract (`updated_at` = "last meaningfully updated") is now correctly honored by the implementation
- Backfill migration ensures existing data sorts correctly without waiting for new activity

## Impact

- **Users**: Recents sidebar ordering will immediately improve after deployment (backfill runs on startup)
- **Runner hot path**: One additional `$set` per status update for `statusAudit.updatedAt` — negligible overhead since it's part of the same document write
- **No proto changes**: The `RecentActivityEntry.updated_at` field name was correct all along; only the implementation was wrong

---

**Status**: ✅ Production Ready
