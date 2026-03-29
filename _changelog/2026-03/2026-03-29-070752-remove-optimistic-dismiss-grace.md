# Remove 8-Second Optimistic Dismiss Grace from HITL Approval Flow

**Date**: March 29, 2026

## Summary

Removed the `DISMISS_GRACE_MS` (8-second) optimistic dismissal mechanism from the frontend HITL approval flow. With T01-T03 changes (atomic SubmitApproval, approval field preservation, DB-driven resume), the server now recomputes `pending_approvals` and publishes the updated execution to the stream directly from the `submitApproval` handler, making the client-side dismiss workaround unnecessary.

## Problem Statement

The frontend `useSessionConversation` hook maintained a `dismissTimestamps` map and an 8-second grace window to optimistically hide approval cards after submission. This mechanism existed because the pre-T01 `submitApproval` handler used a read-modify-write pattern where concurrent `update_status` calls could silently overwrite approval decisions, causing approved tool calls to reappear in `pending_approvals`.

### Pain Points

- The 8-second grace window was a workaround for a server-side race condition that T01 (atomic writes) and T02 (approval field preservation) already fixed
- The reconciliation `useEffect` added complexity to `useSessionConversation` — a behavior hook that platform builders consume directly
- The `dismissedApprovalIds` prop threaded through `useSessionConversation` -> `MessageThread` -> `buildThreadItems` was dead weight after the server-side fixes
- The mechanism could mask genuine approval failures by hiding the card for 8 seconds before revealing the problem

## Solution

Removed the entire dismiss mechanism and simplified `pendingApprovals` to read directly from the execution stream. The `submittingApprovalIds` set from `useSubmitApproval` already provides per-card loading state during the RPC round-trip.

## Implementation Details

**4 files changed, 6 insertions, 162 deletions.**

### `sdk/react/src/session/useSessionConversation.ts`

- Removed `DISMISS_GRACE_MS` constant, `dismissTimestamps` state, two `useEffect` hooks (reset on execution change + 8s reconciliation), `dismissedApprovalIds` useMemo, and the `setDismissTimestamps` call from `submitApproval`
- Simplified `pendingApprovals` to: `activeStreamExecution?.status?.pendingApprovals ?? []`
- Removed `dismissedApprovalIds` from `UseSessionConversationReturn` interface and return object

### `sdk/react/src/execution/MessageThread.tsx`

- Removed `dismissedApprovalIds` from `MessageThreadProps`, `buildThreadItems` signature, the approval filter loop, and the component destructuring

### `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`

- Removed `dismissedApprovalIds` prop from `MessageThread` usage

### `sdk/react/src/session/__tests__/useSessionConversation.test.tsx`

- Removed the "optimistic dismissal" test block, `addPendingApproval` helper, and unused `PendingApprovalSchema`/`ApprovalAction` imports

## Benefits

- Simpler `useSessionConversation` hook — fewer state variables, fewer effects, smaller public API surface
- Approval card visibility is now fully stream-driven (single source of truth) rather than split between stream state and local dismiss timestamps
- Platform builders using `useSessionConversation` get a cleaner return type without the confusing `dismissedApprovalIds` concept

## Impact

- **SDK public API**: `UseSessionConversationReturn.dismissedApprovalIds` removed; `MessageThreadProps.dismissedApprovalIds` (optional) removed
- **Platform builders**: Those passing `dismissedApprovalIds` to `MessageThread` (the documented pattern) will get a TypeScript error, but the prop was always optional and the removal is clean since both the producer and consumer are removed simultaneously
- **UX**: Approval card hiding is now instantaneous via the stream rather than optimistic with an 8-second fallback

## Related Work

- Part of the HITL Tool Call Separation project (`20260329.01.hitl-tool-call-separation`)
- Builds on T01 (atomic SubmitApproval), T02 (approval field preservation), and T03 (DB-driven resume)
- Complements T04 (phase gate relaxation) currently in progress

---

**Status**: Production Ready
