# Runner List Auto-Refresh: Conditional Polling and Event-Driven Refetch

**Date**: April 27, 2026

## Summary

Added automatic status refresh to the runner list so phase transitions (Pending -> Ready) appear in real-time without manual navigation. The solution adds a `refetchInterval` option to the SDK's internal `useFetch` hook, exposes it through `useRunnerList`, and wires conditional polling into both the `RunnerListPanel` styled component and the desktop `RunnersPage`. The desktop app additionally gains event-driven refetch via the `runner:started` Tauri event, replacing fragile `setTimeout` hacks.

## Problem Statement

After starting a runner, the Runners page did not reflect status transitions. The runner would register with the backend and move from Pending to Ready, but the UI showed stale data until the user navigated away and back. The desktop app attempted to work around this with one-shot `setTimeout(refetchServer, 3000)` calls, but these were insufficient — the runner could still be in PENDING state when that single refetch fired.

### Pain Points

- Runner appears stuck in "Pending" even after it's ready
- User must navigate away and return to see updated status
- `setTimeout` hacks are fragile and don't cover the full transition window
- Web console had no refresh mechanism at all after launching a runner

## Solution

Three-layer approach following the SDK's headless-first architecture (DD-003):

1. **Data hook mechanism** — `useRunnerList` gains a `refetchInterval` option that platform builders control
2. **Phase utility** — `isTransitionalPhase()` gives consumers a clean predicate for polling conditions
3. **Styled component auto-polling** — `RunnerListPanel` polls at 5s while PENDING runners exist, stops when all settle
4. **Desktop event-driven refetch** — `runner:started` and `runner:stopped` Tauri events trigger immediate refetch

## Implementation Details

### `useFetch` — interval polling infrastructure

Added `UseFetchOptions` with a `refetchInterval` field to the internal `useFetch` hook. When set to a positive number, a `setInterval` calls `refetch()` on each tick. An `isFetchingRef` guard prevents request piling on slow connections — interval ticks are skipped while a fetch is already in flight. The interval cleans up on unmount, when `refetchInterval` changes to `false`, or when `fetchFn` is `null`.

### `useRunnerList` — passthrough option

The `UseRunnerListOptions` interface gains `refetchInterval` and passes it through to `useFetch`. The data hook remains headless — no automatic polling decisions. Platform builders who use the hook directly control their own polling policy.

### `isTransitionalPhase` — phase classification

New utility in `phase.ts` that returns `true` for `PENDING` only. This is distinct from `isActivePhase` (READY | BUSY) — PENDING is the only phase where status is expected to change soon without user action. Exported from both the runner barrel and the top-level `@stigmer/react` barrel.

### `RunnerListPanel` — smart auto-polling

A `useEffect` tracks whether any runner has a transitional phase and drives a `hasTransitional` state variable. The hook receives `refetchInterval: hasTransitional ? 5000 : false`. On the first render there are no runners (no polling). After the initial fetch, if PENDING runners exist, polling starts. When all runners reach a stable phase, polling stops automatically.

### Desktop `RunnersPage` — event-driven + polling

Three changes:
- Added `onRunnerStarted` listener that calls `refetchServer()` immediately on process spawn
- Made `onRunnerStopped` also call `refetchServer()` immediately (not just on error)
- Added the same `hasTransitional` conditional polling pattern
- Removed all three `setTimeout(refetchServer, ...)` hacks from `handleStart`, `handleStop`, and the `onRunnerStopped` handler

## Files Changed

### SDK (`@stigmer/react`)
- `sdk/react/src/internal/useFetch.ts` — `UseFetchOptions`, `refetchInterval` support, `isFetchingRef` guard
- `sdk/react/src/runner/useRunnerList.ts` — `refetchInterval` option passthrough
- `sdk/react/src/runner/phase.ts` — `isTransitionalPhase()` utility
- `sdk/react/src/runner/RunnerListPanel.tsx` — conditional auto-polling via `hasTransitional` state
- `sdk/react/src/runner/index.ts` — barrel export for `isTransitionalPhase`
- `sdk/react/src/index.ts` — top-level barrel export

### Desktop App
- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — event-driven refetch, conditional polling, `setTimeout` removal

### Tests (new)
- `sdk/react/src/internal/__tests__/useFetch.test.ts` — interval fires, in-flight guard, unmount cleanup, disabled states
- `sdk/react/src/runner/__tests__/useRunnerList.test.tsx` — `refetchInterval` passthrough
- `sdk/react/src/runner/__tests__/phase.test.ts` — `isTransitionalPhase` for all phases, disjointness with `isActivePhase`

## Benefits

- Runner status transitions are visible immediately without manual navigation
- Desktop app gets sub-second feedback via Tauri events, plus polling as a safety net
- Web console benefits automatically through `RunnerListPanel` auto-polling
- Platform builders get a clean `refetchInterval` API for custom polling strategies
- `isTransitionalPhase` utility prevents hardcoded phase comparisons across the codebase
- Polling is resource-efficient: only active while PENDING runners exist, skips ticks during in-flight requests

## Impact

- **Desktop users**: Runner status updates appear within seconds of starting a runner
- **Web console users**: Same benefit via `RunnerListPanel` auto-polling
- **Platform builders**: New `refetchInterval` option on `useRunnerList` and `isTransitionalPhase` utility
- **Codebase**: Removed technical debt (`setTimeout` hacks) in favor of a reusable infrastructure pattern

## Related Work

- Follow-up from [Desktop Runner Start: Full Investigation and Fix](2026-04-27-142508-desktop-runner-start-full-fix.md)
- Builds on the `useFetch` SWR hook from [Shared useFetch Hook Skeleton Flash Fix](2026-04-27-114504-shared-usefetch-hook-skeleton-flash-fix.md)

---

**Status**: ✅ Production Ready
