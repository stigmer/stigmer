# React SDK: Remove Approval Polling and Staleness Workarounds

**Date**: March 27, 2026

## Summary

Removed three obsolete workaround mechanisms from `useSessionConversation` in `@stigmer/react`: the `ApprovalLifecycleState` filter (proto type deleted), exponential-backoff approval polling, and timer-based staleness recovery. With server-computed `pending_approvals` (T05), the stream snapshot is now the single source of truth — no client-side compensation needed.

## Problem Statement

The `useSessionConversation` hook contained three layers of workaround code to compensate for unreliable `pending_approvals` data:

### Pain Points

- **Dead import**: `ApprovalLifecycleState` was deleted from the proto in T02 but still imported in the React SDK — a latent compile-breaking issue
- **Exponential-backoff polling**: When `phase == WAITING_FOR_APPROVAL` but `pending_approvals` was empty, the hook polled with exponential backoff (3s, 6s, 12s... up to 30s, max 8 attempts) to compensate for the race between phase and approval data
- **Timer-based staleness recovery**: After a user submitted an approval, dismissed cards would reappear after 15s if the execution stayed in `WAITING_FOR_APPROVAL` — compensating for potentially failed Temporal signals
- **Complex dismissed state**: `Map<string, number>` tracking toolCallId-to-timestamp, a `useRef` for interval access, and a `useMemo` derivation for the public `ReadonlySet<string>` — all needed to support timestamp-based staleness checks

## Solution

With server-computed `pending_approvals` (recomputed atomically on every `UpdateStatus` write), the stream snapshot that sets `phase = WAITING_FOR_APPROVAL` already includes the correct `pending_approvals` array. All three workaround mechanisms are now unnecessary.

## Implementation Details

### Removed from `useSessionConversation.ts`

- `ApprovalLifecycleState` import and `ACTIONABLE_LIFECYCLE_STATES` filter set
- 5 constants: `APPROVAL_POLL_INITIAL_MS`, `APPROVAL_POLL_MAX_MS`, `APPROVAL_POLL_MAX_ATTEMPTS`, `STALE_DISMISSAL_MS`, `STALE_CHECK_INTERVAL_MS`
- Polling `useEffect` (~50 lines): exponential backoff scheduler with `setTimeout`, `approvalPollRef`, `pollAttemptRef`, `approvalLoadFailed` state
- Staleness `useEffect` (~27 lines): `setInterval`-based scanner comparing `Date.now()` against `dismissedAtMap` timestamps
- `useRef` removed from React imports (no longer needed)
- `approvalLoadFailed` removed from return value (was never declared in `UseSessionConversationReturn` — fixed type drift)

### Simplified

- Dismissed state: `Map<string, number>` + `useRef` + `useMemo` replaced with `useState<ReadonlySet<string>>`
- `pendingApprovals` filter: removed `ACTIONABLE_LIFECYCLE_STATES.has(a.lifecycleState)` check — server only emits actionable entries
- `submitApproval` callback: `Map.set(id, Date.now())` simplified to `Set.add(id)`

### Test changes

- Deleted `describe("approval poll backoff")` (5 tests, ~180 lines)
- Deleted 3 staleness-specific tests from `describe("staleness detection")`
- Restructured 2 surviving tests under `describe("optimistic dismissal")`
- Cleaned up `afterEach` import (no longer used)

## Benefits

- **111 fewer lines** in source (530 vs 641)
- **273 fewer lines** in tests (386 vs 659)
- **Zero timers** running during approval flow — no `setTimeout` or `setInterval` in the hook
- **Simpler mental model**: pending approvals come from the stream, dismissed IDs are a local set, no timing-dependent behavior
- **No public API changes**: `UseSessionConversationReturn` interface unchanged — zero breaking changes for platform builders

## Impact

- **Platform builders**: No action required. All exported types, hooks, and components unchanged.
- **Console**: No action required. `SessionPage.tsx` wiring to `conv.submitApproval`, `conv.dismissedApprovalIds`, etc. works identically.
- **Edge case**: If a Temporal signal fails after approval submission, the card stays hidden until the user navigates away and back (dismissed IDs are transient React state). Previously it would reappear after 15s. This trade-off was explicitly accepted — revisit if signal failures surface in production.

## Related Work

- T02: Proto cleanup removed `ApprovalLifecycleState` enum
- T05: Server-side computed `pending_approvals` made polling unnecessary
- Part of the HITL approval flow simplification project (T01-T07)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes implementation
