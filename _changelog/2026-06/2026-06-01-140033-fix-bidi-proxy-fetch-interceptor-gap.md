# Fix BiDi Proxy Fetch Interceptor Classification Gap

**Date**: June 1, 2026

## Summary

Fixed a classification gap between the fetch interceptor and HTTP/2 interceptor that caused persistent `REFUSED_STREAM` errors on Cursor SDK analytics calls (BootstrapStatsig, telemetry). The Cursor SDK sends some `/aiserver.v1.*` calls via `fetch` (HTTP/1.1), not via Connect RPC (HTTP/2). Neither interceptor handled these requests, leaving them without `x-stigmer-auth` when they reached the BiDi proxy. Also added the missing HTTP/2 interceptor token refresh path to prevent stale-token auth failures in long-lived desktop sessions.

## Problem Statement

After the prior BiDi proxy auth fix (commit `49affea42`, `1ade121e`), `REFUSED_STREAM` errors persisted for `/aiserver.v1.AnalyticsService/BootstrapStatsig` and similar analytics paths. The error showed `source=authorization`, meaning `x-stigmer-auth` was absent despite the HTTP/2 interceptor being configured to inject it.

### Pain Points

- `BootstrapStatsig` auth failures on every agent execution (non-fatal but noisy)
- Cursor SDK retry storm on stream-level auth failures
- HTTP/2 interceptor token goes stale during long desktop sessions (no refresh path)
- Integration tests could not reproduce the issue (wrong transport layer)

## Solution

### Root Cause

The Cursor SDK sends `/aiserver.v1.*` analytics calls via `fetch` (HTTP/1.1 with `Content-Type: application/json`), not via `connect-node` (HTTP/2). The evidence was in the error log: `"proto": "HTTP/1.1"`, `"Content-Type": ["application/json"]`.

The fetch interceptor classified all `/aiserver.v1.*` and `/agent.v1.*` paths as Connect RPC and exempted them from interception (assuming the HTTP/2 interceptor would handle them). The HTTP/2 interceptor only patches `http2.connect()` sessions and never sees `fetch`-based requests. Result: a classification gap where neither interceptor injected `x-stigmer-auth`.

### Why Integration Tests Did Not Catch This

1. Test auth config accepts all tokens when `STIGMER_JWT_SIGNING_KEY` is unset
2. No test exercises fetch-based SDK analytics calls through the BiDi proxy path
3. `BootstrapStatsig` is classified as a non-critical path (debug-level logging)

## Implementation Details

### Fetch interceptor refactor (fetch-interceptor.ts)

Split the single `isCursorRequest` function into two distinct concerns:

- **`needsUrlRewrite(url)`**: REST calls that need URL rewriting to `/v1/proxy/cursor/...` for CursorProxyController (existing behavior, unchanged)
- **`needsProxyAuthOnly(url)`**: Connect-RPC-like paths arriving via fetch that need `x-stigmer-auth` injection without URL rewriting (new behavior)

Added `injectProxyAuth(init, config)` which adds `x-stigmer-auth` alongside the existing `authorization` header (preserving the Cursor access token for upstream forwarding), matching the HTTP/2 interceptor's dual-header behavior.

Refactored `interceptedFetch` into two dedicated handlers:
- `fetchWithUrlRewrite()` — REST path (rewrite URL + replace auth)
- `fetchWithProxyAuth()` — BiDi path (inject `x-stigmer-auth`, preserve URL and authorization)

### HTTP/2 interceptor token refresh (http2-interceptor.ts)

Added `updateHttp2InterceptorToken(token)` export. The module-level config's `stigmerToken` was previously frozen at install time. Desktop sessions that refresh the Stigmer JWT (via IPC `updateToken`) now update both interceptors.

### Runner manager wiring (runner-manager.ts)

`updateToken()` now calls `updateHttp2InterceptorToken(token)` alongside the existing `updateInterceptorToken(token)` for the fetch interceptor.

### Tests

**New: `fetch-interceptor.test.ts`** (11 tests):
- Connect-RPC paths via fetch get `x-stigmer-auth` injected
- Original `authorization` header preserved
- URL not rewritten for Connect-RPC paths
- Execution context propagation
- REST URL rewriting still works
- Passthrough for non-proxy requests

**Extended: `http2-interceptor.test.ts`** (+3 tests):
- Token update reflected in subsequent requests
- New sessions use updated token
- No-op when interceptor not installed

## Benefits

- Eliminates `REFUSED_STREAM` errors on fetch-based SDK analytics calls
- Prevents HTTP/2 interceptor token staleness in long-lived desktop sessions
- 14 new unit tests specifically covering the gap that was missed
- Clear separation of concerns in the fetch interceptor (URL rewriting vs auth injection)

## Impact

- **Runner** (all deployment modes): fetch interceptor now handles Connect-RPC-via-fetch paths; HTTP/2 interceptor token stays in sync on refresh
- **BiDi proxy**: No changes needed — already handles `x-stigmer-auth` correctly
- **Production risk**: Low — adds auth headers that were always intended to be present; existing REST interception path unchanged

## Related Work

- Prior auth fix: `_changelog/2026-06/2026-06-01-132458-fix-bidi-proxy-auth-failure.md`
- Phase 2 BiDi proxy: `_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/`
- TLS proxy for desktop dev: commit `6cb7b4209`

---

**Status**: Production Ready (pending `make desktop-dev` manual verification)
**Timeline**: 1 session (~30 minutes investigation + implementation)
