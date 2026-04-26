# Fix Default Agent Staleness After Desktop Idle

**Date**: April 26, 2026

## Summary

Fixed the "No default agent available" error that appeared in the desktop app after returning from idle. The `useDefaultAgent` hook had no resilience against stale state, failed re-fetches, or visibility changes — a single transient failure left the agent permanently `null` with no recovery path. Additionally, every auth token refresh unnecessarily recreated the `Stigmer` client, amplifying the failure window.

## Problem Statement

When a user left the Stigmer desktop app idle for some time (e.g., macOS sleep, switching apps) and returned, the session launcher displayed:

> "No default agent available. Select an agent to start a session."

This blocked session creation entirely until the user reloaded the app.

### Pain Points

- The `useDefaultAgent` hook fetched once on mount with zero retry logic — a single transient network failure after wake left the cached agent as `null` permanently.
- No `visibilitychange` listener existed — returning from idle never triggered a refetch.
- In the desktop app's `PkceAuthProvider`, the `getAccessToken` callback recreated a new closure on every token refresh (because it depended on `[tokens]`). This cascaded through `useMemo` to recreate the `Stigmer` client, which triggered `useDefaultAgent`'s effect to re-run — right when the network was least reliable (immediately after wake).
- The error message ("No default agent available") was misleading when the actual problem was a transient fetch failure, not a missing agent configuration.

## Solution

Four targeted changes that add resilience without introducing new dependencies or changing the SDK's API surface:

1. **Visibility-aware refetch** in `useDefaultAgent` with a 30-second stale window.
2. **Retry on transient failure** (1 retry, 1-second delay) in `useDefaultAgent`.
3. **Stable `getAccessToken` reference** in the desktop `PkceAuthProvider` using a ref.
4. **Context-aware error messages** in `useNewSessionFlow` that distinguish loading, fetch failure, and genuine misconfiguration.

## Implementation Details

### Visibility-Aware Refetch (`useDefaultAgent`)

Added a `visibilitychange` listener that triggers `refetch()` when the document becomes visible, gated by a `lastFetchedAt` ref. The refetch only fires if the cached result is older than 30 seconds, preventing redundant fetches during quick window switches.

```typescript
useEffect(() => {
  if (typeof document === "undefined") return;
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastFetchedAt.current >= STALE_THRESHOLD_MS) {
      refetch();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}, [refetch]);
```

### Retry with Cancellation Awareness

A `fetchWithRetry` helper wraps the `getDefault` RPC with 1 retry and a 1-second delay. It checks the effect's `cancelled` flag between attempts, ensuring stale retries from unmounted components are dropped cleanly.

### Stable Token Accessor (Desktop Auth)

Changed `getAccessToken` in `PkceAuthProvider` from a `useCallback` depending on `[tokens]` to a stable callback (`[]` dependency) that reads from a `tokensRef`. This breaks the cascade:

```
token refresh → new getAccessToken → new Stigmer client → useDefaultAgent re-runs
```

Now token refreshes update the ref silently; the `Stigmer` client and all downstream hooks remain stable.

### Improved Error Messages

`useNewSessionFlow.submit` now destructures `isLoading` and `error` from `useDefaultAgent` and surfaces targeted messages:

- Loading in progress: "Loading default agent. Please try again in a moment."
- Fetch failure: "Failed to load default agent. Please try again."
- Genuine misconfiguration: "No default agent available. Select an agent to start a session." (unchanged)

## Benefits

- **Self-healing after idle**: The app automatically recovers when the user returns — no manual reload needed.
- **Reduced unnecessary re-renders**: Stabilizing `getAccessToken` prevents the entire `StigmerProvider` subtree from re-rendering on every token refresh.
- **Actionable error messages**: Users now see messages that tell them what to do (wait, retry) rather than a confusing "no default agent" message that implies misconfiguration.
- **Zero new dependencies**: All changes use standard React primitives (`useRef`, `useEffect`, `addEventListener`).

## Impact

- **Desktop app users** (Tauri): Primary beneficiaries — the idle/wake cycle is most common on desktop.
- **Web app users** (Next.js): Also benefit from the `useDefaultAgent` resilience, though the web's TanStack Query defaults already provide some `refetchOnWindowFocus` coverage for other queries.
- **SDK consumers**: The `UseDefaultAgentReturn` interface is unchanged — no breaking changes.

## Files Changed

| File | Change |
|------|--------|
| `sdk/react/src/agent/useDefaultAgent.ts` | Visibility-aware refetch, retry logic, `lastFetchedAt` tracking |
| `sdk/react/src/session/useNewSessionFlow.ts` | Context-aware error messages using `isLoading`/`error` from `useDefaultAgent` |
| `client-apps/desktop/src/auth/AuthProvider.tsx` | Stable `getAccessToken` and `logout` via `tokensRef` |
| `sdk/react/src/agent/__tests__/useDefaultAgent.test.tsx` | 8 new tests covering retry, visibility refetch, stale window, and recovery |

## Testing

8 unit tests added covering:
- Basic mount fetch and null-org skip
- Retry on transient failure (success after retry, error after exhausted retries)
- Visibility-aware refetch after stale threshold
- No refetch within stale window
- No refetch on hidden event
- Manual refetch recovery after failure

All 122 tests across the `@stigmer/react` SDK pass.

---

**Status**: ✅ Production Ready
