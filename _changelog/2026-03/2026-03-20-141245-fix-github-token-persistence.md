# Fix GitHub Token Persistence Across Page Refreshes

**Date**: March 20, 2026

## Summary

Fixed a race condition that prevented the GitHub OAuth token from being persisted to the personal environment, causing users to reconnect GitHub on every page refresh. The root cause was the callback page firing `handleCallback` before the org context loaded, which made `getOrCreate` throw. Added a defensive guard to `getOrCreate` to prevent duplicate environment creation.

## Problem Statement

After connecting GitHub via OAuth, the `GITHUB_TOKEN` never appeared in the personal environment. Users had to reconnect GitHub every time they refreshed the page — the token existed only in React state and was lost on unmount.

### Pain Points

- GitHub connection lost on every page refresh
- `GITHUB_TOKEN` absent from personal environment (visible in Settings)
- `GITHUB_TOKEN` absent from localStorage (removed during earlier cleanup)
- No error message surfaced to the user — the failure was silent

## Solution

The fix addresses two issues across three files:

1. **Race condition in the callback page** — The OAuth callback effect fired before `OrgProvider` finished loading, passing `null` as org to `useGitHubConnection`. The `getOrCreate` call threw because org was null, and the `attempted.current` ref prevented retries when org became available.

2. **Duplicate environment risk in `getOrCreate`** — When the environment list query was still in flight, `environmentRef.current` was null, causing `getOrCreate` to skip straight to `create()` and potentially create a duplicate personal environment.

## Implementation Details

### 1. Callback page (`client-apps/web`)

- Replaced `attempted` ref with `exchanged` state (`useState`) so the effect re-evaluates when `org` transitions from empty to available
- Added `!org` and `isLoading` guards — the effect only fires when org is available AND the personal environment reconciliation is complete
- Updated JSDoc to reflect the direct personal environment write strategy

### 2. `usePersonalEnvironment` (`@stigmer/react`)

- Added `isLoadingRef` to track the environment list loading state
- `getOrCreate` now throws a clear, actionable error if called while the list is still loading: "Wait for isLoading to become false before calling getOrCreate()"
- Updated JSDoc to document the preconditions

### 3. `useGitHubConnection` (`@stigmer/react`) — earlier in this session

- Removed localStorage from the token flow entirely (`STORAGE_KEY_TOKEN` deleted)
- `handleCallback` writes directly to the personal environment via `getOrCreate` / `addVariables`
- Server reconciliation on mount reveals the token from the personal environment
- `disconnect` removes from personal environment only

## Benefits

- GitHub connection persists across page refreshes
- Token stored encrypted server-side in the personal environment
- No localStorage involvement in the token flow
- Clear error messages when SDK hooks are called before they're ready
- Defensive guard prevents duplicate personal environments

## Impact

- **Direct users**: GitHub connection survives page refreshes and browser restarts
- **Platform builders**: `usePersonalEnvironment.getOrCreate` has an explicit, documented readiness contract — callers must wait for `isLoading` to become false
- **SDK quality**: Error messages state what happened, why, and what to do

## Related Work

- [GitHub Token Migration to Personal Environment](2026-03-19-190727-github-token-migration-to-personal-environment.md) — Original migration that moved from localStorage to personal environment
- [Personal Environment and Instance Orchestration Hooks](2026-03-19-180749-personal-env-instance-orchestration-hooks.md) — The `usePersonalEnvironment` hook this fix hardens
- [Agent Picker + Personal Environment Flow](../../_projects/2026-03/20260319.02.agent-picker-personal-env/tasks/T01_0_plan.md) — Phase 4 plan that specified the migration

---

**Status**: ✅ Production Ready
