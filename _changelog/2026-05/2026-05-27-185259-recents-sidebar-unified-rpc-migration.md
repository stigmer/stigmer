# Recents Sidebar: Unified RPC Migration and Audit Hardening

**Date**: May 27, 2026

## Summary

Migrated the Recents sidebar from a fragile two-RPC client-side merge pattern to the unified `listRecentActivity` RPC, and hardened the backend audit timestamp bumping to be unconditional. This fixes a sorting bug where newly created workflow executions appeared at the wrong position in the sidebar, and eliminates a class of latency and correctness issues caused by the split-fetch architecture.

## Problem Statement

The workflow execution "daily-notification-plan 2026-05-27 12:44:36" (the most recent execution) appeared at position 11 in the Recents sidebar, below entries from 11:18, 10:29, 09:35, and earlier. The sort order was fundamentally broken despite recent changes to switch the sort field from `specAudit.createdAt` to `statusAudit.updatedAt`.

### Pain Points

- Most recently started workflow execution appeared below much older entries
- Agent sessions triggered by workflows were also misplaced
- The sidebar made two parallel gRPC calls (sessions + workflow executions), each independently sorted and paginated, then did a client-side merge — a pattern that cannot produce a correct global sort when individual sources are paginated
- Backend handlers conditionally bumped `statusAudit.updatedAt` only when the audit structure existed, silently skipping the bump for documents where audit was missing

## Solution

Three-layer fix across both repositories:

1. **Backend audit hardening** — Make `statusAudit.updatedAt` bump unconditional in all status-mutating handlers
2. **Frontend unified RPC migration** — Replace the two-call client-side merge with the server-side `listRecentActivity` RPC
3. **Safety backfill migration** — Catch any documents with missing `statusAudit.updatedAt`

## Implementation Details

### Backend (stigmer-cloud) — 6 files

**Unconditional audit bump (4 handlers):**
- `WorkflowExecutionUpdateStatusHandler.java` — removed `if (statusBuilder.hasAudit())` guard; `getAudit()` returns default instance when absent, bootstrapping audit on legacy documents
- `WorkflowExecutionCancelHandler.java` — same fix
- `WorkflowExecutionTerminateHandler.java` — same fix
- `GenerateSessionSubjectActivityImpl.java` — same fix for session subject generation (bumps both `specAudit` and `statusAudit`)

**Stale documentation fix:**
- `WorkflowExecutionListHandler.java` — fixed Javadoc comment that still said "sorts by creation time descending"

**Safety backfill migration:**
- `U20260527d_SafetyBackfillStatusAuditUpdatedAt.java` — scans all session and workflow_execution documents where `statusAudit.updatedAt` is missing/empty and sets it from `specAudit.createdAt` as a baseline

### Frontend (stigmer) — 6 files

**SDK client for unified RPC:**
- `sdk/typescript/src/activity.ts` (new) — `ActivityClient` wrapping `listRecentActivity` RPC via Connect
- `sdk/typescript/src/stigmer.ts` — wired `activity` client on the `Stigmer` class
- `sdk/typescript/src/index.ts` — exported `ActivityClient` and related types

**Hook migration:**
- `sdk/react/src/activity/useRecentActivity.ts` — replaced `useSessionList()` + `useWorkflowExecutionList()` client-side merge with single `stigmer.activity.listRecentActivity()` call. Server handles merge-sort, fallback, and pagination
- `sdk/react/src/activity/types.ts` — fixed stale documentation (was `specAudit.createdAt`, now documents `statusAudit.updatedAt` with fallback)
- `sdk/react/src/activity/__tests__/useRecentActivity.test.ts` — rewritten for unified RPC: tests proto entry normalization, fallback subjects, missing timestamps, and time-bucket grouping (8 tests, all passing)

## Benefits

- Recents sidebar ordering is correct: most recently active entries always appear first
- Single RPC call instead of two parallel calls — reduces latency and eliminates the cross-collection pagination inconsistency
- No more silent audit skip — every status update, cancel, terminate, and subject generation unconditionally bumps `statusAudit.updatedAt`
- Safety backfill catches any edge-case documents created through code paths that bypassed audit initialization
- Both web and desktop sidebars benefit automatically (shared hook in `@stigmer/react`)

## Impact

- **Users**: Recents sidebar will show correct ordering immediately after deployment
- **Platform builders**: `useRecentActivity` hook consumers get faster, server-sorted results with no API change
- **Backend**: One fewer conditional branch per status update; negligible overhead from the unconditional audit bump
- **Desktop app**: Automatically benefits from the shared hook migration (DD-016 parity)

## Related Work

- Prior fix: `2026-05-27-162754-fix-recents-sidebar-sticky-ordering.md` — switched sort field from `specAudit.createdAt` to `statusAudit.updatedAt`
- Prior optimization: `2026-05-27-153159-recents-sidebar-latency-optimization.md` — created the unified `listRecentActivity` RPC and handler (flagged frontend migration as follow-up)

---

**Status**: ✅ Production Ready
