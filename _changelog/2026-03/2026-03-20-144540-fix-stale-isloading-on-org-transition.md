# Fix Stale isLoading State on Org Transition

**Date**: March 20, 2026

## Summary

Fixed a React state timing bug where `useEnvironmentList` and `useGitHubConnection` reported `isLoading: false` with stale empty data during the render where `org` changed, causing premature `getOrCreate` calls, duplicate personal environments, and silent GitHub token persistence failures.

## Problem Statement

When `org` transitioned from `null` (OrgProvider loading) to a valid slug, `useEnvironmentList` set `isLoading(true)` inside a `useEffect`. React defers effect state updates to the next render, so in the current render every downstream consumer saw the stale `isLoading: false` from the previous null-org render.

### Pain Points

- `usePersonalEnvironment` saw `isLoading: false` with `environment: null` and concluded "no personal environment exists" — triggering premature `getOrCreate` calls that created duplicate environments
- `useGitHubConnection`'s reconciliation effect ran immediately with an empty environment, marking `isLoading: false` before the list query finished
- The callback page fired `handleCallback` before the personal environment was ready, causing `getOrCreate` to either throw (with the isLoading guard) or create a duplicate environment (without it)
- The GitHub token was silently lost — users had to reconnect on every page refresh

## Solution

Applied React's "adjust state during render" pattern to synchronously reset loading state when `org` changes. This ensures all downstream hooks see `isLoading: true` in the same render cycle — not deferred to the next render.

## Implementation Details

### `useEnvironmentList` (`@stigmer/react`)

- Changed initial state from `useState(false)` to `useState(!!org)` so the hook starts in the correct loading state
- Added synchronous org-change detection using `prevOrg` state: when `org` changes, immediately sets `isLoading`, clears stale `environments`, `totalCount`, and `error`
- Removed the duplicated `setIsLoading(true)` and null-org cleanup from the fetch effect — the synchronous block handles it

### `useGitHubConnection` (`@stigmer/react`)

- Replaced the `useEffect`-based org-sync (`setIsLoading(!org ? false : true)`) with the same synchronous `prevOrg` pattern
- Moved `reconciled.current = false` into the synchronous block (was previously in a separate `useEffect`)
- Removed both the org-sync effect and the org-change effect — one synchronous block handles both concerns

## Benefits

- `isLoading` is correct in the same render cycle where `org` changes — no one-render-late stale state
- Prevents premature `getOrCreate` calls that created duplicate personal environments
- Prevents premature `handleCallback` execution on the OAuth callback page
- The GitHub token persists across page refreshes
- The fix is at the foundational layer (`useEnvironmentList`), so every hook that depends on it — `usePersonalEnvironment`, `useGitHubConnection`, and any future hooks — benefits automatically

## Impact

- **All environment-dependent hooks**: Any hook or component that uses `useEnvironmentList` now gets correct loading state on org transitions
- **GitHub OAuth flow**: Token persistence works reliably on first connect
- **Settings page**: No more duplicate personal environments created by the bootstrap logic
- **Platform builders**: The `isLoading` contract of `useEnvironmentList` is now consistent — it never falsely reports "not loading" while a fetch is needed

## Related Work

- [Fix GitHub Token Persistence](2026-03-20-141245-fix-github-token-persistence.md) — The earlier fix that addressed callback page guards and getOrCreate guards; this fix addresses the root cause those guards were compensating for
- [Personal Environment and Instance Orchestration Hooks](2026-03-19-180749-personal-env-instance-orchestration-hooks.md) — The `usePersonalEnvironment` hook that depends on `useEnvironmentList`

---

**Status**: ✅ Production Ready
