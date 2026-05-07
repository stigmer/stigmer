# React SDK: Cross-Mount FetchCache for Flicker-Free Session Navigation

**Date**: May 3, 2026

## Summary

Added a lightweight `FetchCache` layer to `@stigmer/react` that gives `useFetch` memory across component remounts. Previously visited sessions now render instantly from cache instead of flashing a skeleton, while fresh data refetches in the background. Zero new dependencies, 31 new tests, no public API changes to existing hooks.

## Problem Statement

When users navigate between sessions in the Stigmer Console, `AppShell` renders `<SessionPageInner key={activeSessionId} />`. The `key` prop forces a full React remount — the correct pattern for resetting stream controllers, approval state, and pending execution IDs. However, `useFetch` stored data exclusively in component-local `useState`, so every remount started from `null` / `[]` and showed a loading skeleton until the network round-trip completed.

### Pain Points

- Every session switch showed a full-page skeleton, even for sessions visited seconds ago
- The flash was ~200-500ms on typical connections — noticeable and jarring
- External SDK consumers embedding `@stigmer/react` faced the same problem with no workaround
- The original T08 plan proposed TanStack Query in the Console, but data fetching is deeply composed inside SDK hooks (`useSessionPageFlow → useSessionConversation → useSession → useFetch`), making Console-level replacement impractical without duplicating or restructuring the SDK's composition chain

## Solution

Built a `FetchCache` — a simple keyed in-memory cache — inside the SDK that `useFetch` reads from on mount and writes to on fetch success. A `FetchCacheProvider` component sits above remount boundaries so cached data survives when child components unmount and remount.

This is intentionally *not* a query library. It omits deduplication, automatic background refetch, retry, devtools, and suspense integration — all of which `useFetch` already handles or doesn't need. It is strictly a cross-mount data survival layer.

## Implementation Details

### FetchCache class (`sdk/react/src/internal/fetch-cache.ts`)

- `Map<string, { data: unknown; timestamp: number }>` with configurable TTL (default 5 min) and max entries (default 100)
- LRU eviction via Map insertion order: `delete` → `set` moves a key to the tail; iterator yields oldest first
- `get/set/has/invalidate/invalidatePrefix/prefetch/clear` API
- `prefetch(key, fetchFn)` enables fire-and-forget cache warming (e.g., sidebar hover — deferred to polish task)

### FetchCacheProvider (`sdk/react/src/internal/FetchCacheProvider.tsx`)

- React context holding `FetchCache | null` (null = no provider, graceful degradation)
- Cache instance created once via `useRef` and stable for the provider's lifetime
- Exported from `@stigmer/react` barrel so external consumers can mount it

### useFetch integration (`sdk/react/src/internal/useFetch.ts`)

- New optional `cacheKey` in `UseFetchOptions`
- `useState` initializer reads cache on mount → if hit, `hasDataRef = true`, `isLoading = false`
- Effect body reads cache on dep change → serves cached data immediately for identity switches without remount
- Fetch success writes `cache.set(cacheKey, result)`
- `fetchFn === null` path unchanged — resets to `initialData`, does not read cache
- No-provider case: `useFetchCache()` returns null, all cache paths are skipped, behavior unchanged

### Hook cache keys

- `useSession(id)` → `cacheKey: session:${id}`
- `useSessionExecutions(sessionId)` → `cacheKey: session-executions:${sessionId}`
- Scoped to these two hooks for T08; other hooks can add keys incrementally

### Console wiring (`client-apps/web/src/domain/_shared/layout/AppShell.tsx`)

- `<FetchCacheProvider>` wraps the authenticated shell layout
- Sits above `<SessionPageInner key={activeSessionId} />` → cache survives session switches
- Cleared on logout (AuthGuard unmounts tree) and org switch (OrgGate remounts children)

## Benefits

- **Previously visited sessions render instantly** — no skeleton, cached data served synchronously on mount
- **Background refetch for freshness** — `isRefetching = true` while fresh data loads, stale data visible
- **First-visit behavior unchanged** — cache miss → skeleton → data loads normally
- **Zero new dependencies** — no TanStack Query, no SWR added to the SDK
- **All 27+ `useFetch` consumers can opt in** — just add a `cacheKey` to any hook
- **External SDK consumers benefit** — wrap with `<FetchCacheProvider>` and get the same fix
- **Clean upgrade path** — `cacheKey` convention maps directly to TanStack Query keys if ever needed

## Impact

- **SDK** (`@stigmer/react`): New `FetchCacheProvider` export, internal `FetchCache` class, `useFetch` enhanced with optional cache
- **Console** (`client-apps/web`): One import + one provider wrapper in `AppShell`
- **Test suite**: 395/395 pass (31 new tests), typecheck clean, lint clean
- **Bundle size**: ~120 lines of new production code (cache class + provider + useFetch diff)

## Related Work

- T02-T07 (Sessions 1-6): Streaming render pipeline — structural sharing, memoization, stream controller, Streamdown
- T08 completes the data-flow story: T02-T07 fixed the streaming path, T08 fixes the navigation path
- T09 (Composer Isolation), T10 (Auto-Scroll), T11 (Virtualization) are next

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~1 hour)
