# Fix Recents Sidebar: New Execution Not Appearing at Top

**Date**: May 27, 2026

## Summary

Fixed a bug where newly started workflow executions appeared below older running executions in the Recents sidebar. The root cause was that `statusAudit.updatedAt` (the recents sort field) was bumped on every runner progress heartbeat (~22+ RPCs per execution), causing actively-running executions to perpetually sort above freshly created ones. The fix makes the audit bump selective (phase transitions only) and adds frontend optimistic prepend for instant feedback.

## Problem Statement

When a user starts a new workflow execution, it should immediately appear at the top of the Recents sidebar. Instead, it appeared at position 7-8 in the list, below executions that started hours earlier but were still running.

### Pain Points

- Most recently started workflow execution appeared below much older entries
- The user's mental model ("I just started this, it should be at the top") was violated
- Long-running executions with periodic agent progress polls (every ~15s) dominated the sort order
- The bug persisted even after the prior fix that migrated to the unified `listRecentActivity` RPC

## Solution

Two-layer fix across both repositories:

1. **Backend (stigmer-cloud)**: Make `statusAudit.updatedAt` bump conditional — only on execution phase transitions (PENDING→RUNNING→COMPLETED/FAILED), not on every task-progress heartbeat from the runner
2. **Frontend (stigmer)**: Add optimistic prepend to `useRecentActivity` hook so newly navigated-to executions appear at position 0 instantly, before the refetch round-trip completes

## Implementation Details

### Backend — Selective Audit Bump (stigmer-cloud, 2 files)

**`WorkflowExecutionUpdateStatusHandler.java`**: Changed the unconditional audit bump to fire only when `requestStatus.getPhase()` is non-UNSPECIFIED AND differs from the existing phase:

```java
boolean isPhaseTransition = requestStatus.getPhase()
        != ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED
        && requestStatus.getPhase() != existing.getStatus().getPhase();

if (isPhaseTransition) {
    var updatedStatusAudit = existingAudit.getStatusAudit().toBuilder()
            .setUpdatedAt(CurrentProtobufTimestampGetter.get())
            .setEvent("updated")
            .build();
    statusBuilder.setAudit(existingAudit.toBuilder()
            .setStatusAudit(updatedStatusAudit)
            .build());
}
```

**`WorkflowExecutionUpdateStatusHandlerTest.java`**: Added 5 new tests verifying the selective bump logic — phase transitions bump, task-only updates don't, UNSPECIFIED phase doesn't, same-phase resends don't.

### Frontend — Optimistic Prepend (stigmer, 5 files)

**`sdk/react/src/activity/useRecentActivity.ts`**: Added `prependOptimistic(entry)` method to the hook return. Manages optimistic entries in local state, merges them above server data, and clears automatically when the next refetch includes the entry's ID.

**`client-apps/web/src/domain/_shared/layout/Sidebar.tsx`** and **`client-apps/desktop/src/shell/Sidebar.tsx`**: Wires `prependOptimistic` when navigating to a new execution not already in the entries list, using a ref to avoid dependency-cycle re-renders.

**`sdk/react/src/activity/index.ts`**: Exported the new `OptimisticEntryInput` type.

### Integration Test (stigmer, 2 files)

**`test/integration/workflow_recents_order_test.go`**: Regression test that starts a blocking workflow (Execution A, receives task updates), then starts a fast workflow (Execution B), and asserts B appears before A in `listRecentActivity`.

**`test/integration/harness/clients.go`**: Added `ActivityQuery` client to the test harness `Clients` struct.

### Unit Test (stigmer, 1 file)

**`sdk/react/src/activity/__tests__/useRecentActivity-optimistic.test.tsx`**: 4 tests for the optimistic prepend behavior — basic prepend, ordering above server entries, deduplication on refetch, and idempotency on duplicate calls.

## Benefits

- Recents sidebar correctly shows newest execution at position 0 immediately after creation
- Long-running executions no longer dominate the sort order through background heartbeats
- No regression on the original "missing audit" bug — `CreateOperationSetAuditStepV2` still initializes audit at creation time
- OSS parity: cloud behavior now matches OSS (which never bumped on every update)
- Instant feedback via optimistic prepend even before the server refetch completes

## Impact

- **Users**: New executions immediately appear at the top of Recents sidebar
- **Running executions**: Still sort high when they complete (phase transition bumps them), but no longer continuously leapfrog new entries while running
- **Platform builders**: `useRecentActivity` hook gains `prependOptimistic` API for custom sidebar integrations
- **Desktop app**: Automatically benefits from the shared hook migration (DD-016 parity)

## Related Work

- Prior fix: `2026-05-27-185259-recents-sidebar-unified-rpc-migration.md` — migrated to unified `listRecentActivity` RPC
- Prior fix: `2026-05-27-162754-fix-recents-sidebar-sticky-ordering.md` — switched sort field to `statusAudit.updatedAt`
- Prior optimization: `2026-05-27-153159-recents-sidebar-latency-optimization.md` — created the unified RPC handler

---

**Status**: ✅ Production Ready
