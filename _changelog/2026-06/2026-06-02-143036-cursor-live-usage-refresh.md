# Live Authoritative Usage Refresh in Session Inspector

**Date**: June 2, 2026

## Summary

`useSessionUsage` now refreshes the session usage report while an execution is in flight, so the authoritative, proxy-metered cost climbs live during a run and replaces the runner's "Estimated" figure promptly at completion. Previously the report was fetched once and cached, so the settled cost only appeared after re-opening the session — most visibly for Cursor sessions, where the proxy now writes a billing record per turn.

## Problem Statement

The Usage tab fetched `getSessionUsageReport` exactly once on mount (cached across remounts via `FetchCacheProvider`) and never refetched. The hook preferred the authoritative billing report whenever it had any usage.

### Pain Points

- **Cost only updated "after the agent finished."** For a session that already had prior billing records (the common multi-turn case), the cached report was shown but never refreshed, so an in-progress run's cost did not climb and the final total only appeared after a full remount.
- **The authoritative total never replaced the estimate on completion** without re-opening the session, even once proxy billing records existed.

## Solution

Drive the existing `useFetch` polling/refetch capability from execution liveness: poll while any execution is non-terminal, and do one final refetch when the last execution settles. Pair this with the stigmer-cloud change that writes one authoritative billing record per turn, so polling surfaces a continuously-updating settled total from a single source (no mixing of estimate and authoritative figures).

## Implementation Details

`sdk/react/src/session/useSessionUsage.ts`:

- Derive `hasActiveExecution` from `executions` via the shared `isTerminalPhase` helper.
- Pass `refetchInterval: 2500ms` to `useFetch` while an execution is active; disable it otherwise.
- Stabilize the fetch function with `useCallback` so the poll timer is not torn down and recreated on every streaming re-render (which would prevent it from ever firing).
- On the active → terminal transition, fire a single `refetch()` so the final turn's authoritative record is captured promptly rather than waiting for a remount.
- Precedence is unchanged: the authoritative report wins once any record exists; the runner's display-only streaming estimate remains the fallback only before the first record lands.

Tests (`__tests__/useSessionUsage.test.ts`): estimate → authoritative precedence, polling while running, and stop-polling-after-one-final-refetch on settle.

## Benefits

- Settled cost is visible and current **during** a run, not just after it ends.
- The "Estimated" badge gives way to the authoritative total within one poll interval of the first billing record, with no manual refresh.
- Polling automatically stops once nothing is running, bounding request volume.

## Impact

- **Session Inspector → Usage tab** (web, desktop, Ink — all consumers of `useSessionUsage`/`UsageWidget`): live authoritative cost during runs.
- No proto, RPC, or backend changes in this repo; the runner remains display-only.

## Related Work

- stigmer-cloud `_changelog/2026-06/2026-06-02-143036-cursor-per-turn-proxy-billing.md` — the per-turn proxy billing that makes the authoritative total update continuously during a run

---

**Status**: ✅ Production Ready
**Timeline**: Single session
