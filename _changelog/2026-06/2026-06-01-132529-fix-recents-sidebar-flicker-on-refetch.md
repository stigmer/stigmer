# Fix Recents Sidebar Flickering on Refetch

**Date**: June 1, 2026

## Summary

Fixed a regression where the recents sidebar flickered skeleton loaders on every data refresh. The root cause was an overly aggressive data-reset path in `useFetch` (introduced May 30 in `f24ba1c93`) that cleared data on *every* effect invocation — including imperative `refetch()` calls — instead of only on identity dependency changes. The fix restores the stale-while-revalidate contract, adds cross-mount caching to `useRecentActivity`, and memoizes sidebar entry components for rendering efficiency.

## Problem Statement

The recents sidebar (showing recent sessions and workflow executions) began flickering two days ago. Every navigation between sessions, plus two staggered 8s/18s timer-based refetches, caused the full entry list to be replaced by skeleton loaders for the duration of the API call, then replaced back with data.

### Pain Points

- Sidebar flickers skeletons on every session/execution navigation
- Two additional flickers at 8s and 18s after each navigation (LLM subject generation timers)
- Optimistic prepend entries invisible during refetch because skeleton wins the conditional branch
- Contradicts the `useFetch` hook's documented stale-while-revalidate semantics

## Solution

Three-layer fix targeting the data flow from `useFetch` through `useRecentActivity` to the sidebar rendering:

1. **Root cause fix in `useFetch`**: Track previous identity deps in a ref and only reset data when identity deps change — not when `fetchKey` changes from `refetch()`
2. **Cross-mount caching for `useRecentActivity`**: Add `cacheKey` per DD-014 for flicker-free sidebar remounts
3. **Memoized entry components**: Wrap `ActivityEntry` in `React.memo` per DD-010 so unchanged entries don't re-render when new items arrive

## Implementation Details

### `useFetch` identity-change detection

Added `prevIdentityDepsRef` that stores the previous user-provided dependency values. On each effect run, the hook performs a shallow comparison (`Object.is` per element) between current and previous deps. The data-reset path from `f24ba1c93` now only fires when identity deps actually changed — preserving the fix for the premature worker shutdown bug while restoring stale-while-revalidate for refetches.

### `useRecentActivity` cache key

Added `cacheKey: \`recent-activity:${org}\`` to the `useFetch` call. When the sidebar remounts (e.g., returning from settings), cached data renders instantly without a loading skeleton. The org slug in the key ensures org-switching resets correctly.

### Memoized `ActivityEntry`

Wrapped `ActivityEntry` in `React.memo` in both web (`Sidebar.tsx`) and desktop (`Sidebar.tsx`). When a new item arrives at the top of the list, unchanged entries below no longer re-render — they stay visually stable.

### Tests

Added 5 new test cases to `useFetch-identity-reset.test.ts`:
- `refetch()` preserves stale data (no cacheKey)
- Multiple consecutive refetches keep `isLoading` false
- Refetch followed by identity dep change correctly resets
- Slow refetch preserves stale data throughout
- Polling via `refetchInterval` never flashes skeleton

All 6 existing identity-reset tests continue to pass unchanged.

## Benefits

- Zero skeleton flicker during sidebar refetches — stale data stays visible while fresh data loads in background
- Instant sidebar rendering on remount via FetchCache
- Reduced re-renders: only new/changed entries update, not the entire list
- Preserved identity-reset safety: switching between executions or orgs still correctly clears stale data

## Impact

- **Users**: Sidebar recents list stays stable during navigation and background refreshes. New items appear silently without visual disturbance.
- **SDK consumers**: `useFetch` now correctly honors its stale-while-revalidate contract for all consumers, not just those with `cacheKey`.
- **DD-016 parity**: Both web and desktop sidebars receive identical treatment.

## Files Changed

| File | Change |
|------|--------|
| `sdk/react/src/internal/useFetch.ts` | Identity-change detection via `prevIdentityDepsRef` |
| `sdk/react/src/activity/useRecentActivity.ts` | Added `cacheKey` for cross-mount persistence |
| `client-apps/web/src/domain/_shared/layout/Sidebar.tsx` | `ActivityEntry` wrapped in `React.memo` |
| `client-apps/desktop/src/shell/Sidebar.tsx` | Extracted and memoized `ActivityEntry` component |
| `sdk/react/src/internal/__tests__/useFetch-identity-reset.test.ts` | 5 new refetch-preserves-data tests |

## Related Work

- `f24ba1c93` — The commit that introduced the regression (premature worker shutdown fix)
- DD-009 — Streaming data architecture (stale-while-revalidate pipeline)
- DD-010 — Reference stability is architectural
- DD-014 — FetchCache for cross-mount persistence
- DD-016 — Client app parity

---

**Status**: Production Ready
