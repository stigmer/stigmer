# HITL Frontend Approval Resilience

**Date**: March 27, 2026

## Summary

Hardened the HITL approval flow in the React SDK's `useSessionConversation` hook with two complementary resilience mechanisms: exponential backoff polling when the server fails to deliver approval data, and staleness detection that reappears optimistically dismissed approval cards when the downstream Temporal signal fails. Both changes are internal to the hook — zero breaking changes for platform builders.

## Problem Statement

Two failure modes left users stuck during HITL approval with no way to recover:

### Pain Points

- **Single-shot poll dead end**: When the execution entered `WAITING_FOR_APPROVAL` but the stream failed to deliver `pendingApprovals`, a single `refetch()` fired at 3 seconds. If that refetch also returned empty, the `useEffect` deps didn't change and the poll never fired again. The user saw "Waiting for approval" with no cards and no action to take.
- **Optimistic dismissal masks signal failures**: When `submitApproval` succeeded, the approval card was immediately hidden via `dismissedApprovalIds`. If the Temporal signal failed downstream, the execution stayed stuck in `WAITING_FOR_APPROVAL` with all cards hidden. The user had no way to retry.

## Solution

Two independent mechanisms, each handling a distinct failure mode with clean separation:

**Task 3 — Exponential Backoff Polling**: Replaced the single-shot `setTimeout(3s)` with a self-scheduling timeout chain (3s → 6s → 12s → 24s → 30s cap). Changed the trigger condition from filtered `pendingApprovals.length` to raw `activeStreamExecution?.status?.pendingApprovals?.length`, so polling only fires when the server genuinely hasn't delivered data — not when the user has dismissed all cards.

**Task 4 — Staleness Detection**: Changed the internal `dismissedApprovalIds` state from `Set<string>` to `Map<string, number>` (toolCallId → timestamp). A `setInterval(5s)` checks for entries older than 15 seconds while the phase is still `WAITING_FOR_APPROVAL`. Stale entries are removed, the approval card reappears, and `refetch()` is triggered to get the latest server state. The public API type (`ReadonlySet<string>`) is unchanged — derived via `useMemo` from the Map's keys.

## Implementation Details

### Separation of Failure Modes

The two mechanisms deliberately don't overlap:
- Poll checks **raw** (unfiltered) approvals from the stream snapshot. If raw count > 0, polling doesn't fire — even if all cards are dismissed.
- Staleness detection checks **dismissed entries** by timestamp. It only runs when the Map is non-empty and phase is `WAITING_FOR_APPROVAL`.

This separation avoids wasteful network requests (polling when the server already delivered data) and keeps each mechanism's purpose traceable.

### Key Technical Decisions

- **Self-scheduling setTimeout over setInterval**: Backoff requires increasing delays; `setInterval` fires at a fixed rate and would need clearing and recreation.
- **useRef for latest-map sync**: The staleness `setInterval` callback uses `dismissedAtMapRef.current` (synced on every render) to avoid stale closures.
- **Strict greater-than threshold**: `now - ts > 15000` (not `>=`). First stale detection occurs at the 20s interval tick, not 15s.
- **No new public API fields**: Consumers can derive "loading approval details" from `activePhase === WAITING_FOR_APPROVAL && pendingApprovals.length === 0`.

### Constants Added

```typescript
const APPROVAL_POLL_INITIAL_MS = 3_000;
const APPROVAL_POLL_MAX_MS = 30_000;
const STALE_DISMISSAL_MS = 15_000;
const STALE_CHECK_INTERVAL_MS = 5_000;
```

### Test Coverage

10 new tests added (20 total, up from 10):

**Polling (5 tests)**: Backoff schedule verification, stops when data arrives, stops on phase change, doesn't fire when raw approvals exist but are dismissed, cleanup on unmount.

**Staleness (5 tests)**: Card reappears after threshold, no staleness check outside `WAITING_FOR_APPROVAL`, refetch triggered on staleness, `dismissedApprovalIds` remains `ReadonlySet<string>`, reset on new execution.

All 95 SDK React tests pass across 7 test files.

## Benefits

- **Users never get stuck**: Both dead-end scenarios now have automatic recovery paths.
- **Zero breaking changes**: Public API type, shape, and behavior for the happy path are identical. Platform builders don't need to update any code.
- **Minimal network overhead**: Exponential backoff caps at 30s; staleness checks run at 5s intervals only when needed.
- **Clean separation**: Each mechanism handles exactly one failure mode, making the system predictable and debuggable.

## Impact

- **Direct users**: HITL approval flow is resilient to stream delivery failures and Temporal signal failures. Approval cards either poll into existence or reappear after 15 seconds.
- **Platform builders**: No changes needed. The `useSessionConversation` hook, `MessageThread`, and `ApprovalCard` all work identically.
- **Maintainers**: Clear separation of concerns between polling (missing data) and staleness (failed signal) makes each mechanism independently testable and tuneable.

## Related Work

- [HITL Approval Flow Hardening](2026-03-26-201753-hitl-approval-flow-hardening.md) — project overview
- [Enforce Approval Lifecycle State Manager](2026-03-26-211525-enforce-approval-lifecycle-state-manager.md) — Task 1
- [Fix Sub-Agent Fingerprint Map Population](2026-03-27-085001-fix-sub-agent-fingerprint-map-population.md) — Task 2
- [Remove Dead _remove_from_pending](2026-03-27-091231-remove-dead-remove-from-pending-and-add-batch-resume-abort-message.md) — Task 5

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
