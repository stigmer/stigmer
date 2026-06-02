# Fix Cursor SDK Proxy Routing: Separate Connect RPC from REST/Fetch Paths

**Date**: May 24, 2026

## Summary

Fixed two proxy routing failures in the Cursor SDK integration: `Route GET:/v1/models not found` and `API key exchange failed with status 403`. The root cause was setting `CURSOR_BACKEND_URL` to a single host, but the SDK uses this env var for two components that need different upstream hosts. The fix removes `CURSOR_BACKEND_URL` entirely and relies on the existing fetch interceptor to route REST calls while preserving the correct upstream host.

## Problem Statement

After the earlier proxy routing fix (commit `297575cb1`) that set `CURSOR_API_BASE_URL` and `CURSOR_BACKEND_URL`, workflow executions failed with:

1. `Route GET:/v1/models not found` — when `CURSOR_BACKEND_URL` pointed to `api2.cursor.sh`
2. `API key exchange failed with status 403` — when `CURSOR_BACKEND_URL` pointed to `api.cursor.com`

### Pain Points

- Setting `CURSOR_BACKEND_URL` to either host broke the other component
- The SDK uses this single env var for two components with different host requirements
- The auth exchange failure manifested as an unhandled rejection during agent execution

## Root Cause

The Cursor SDK reads `CURSOR_BACKEND_URL` in two places with **different defaults**:

```javascript
// CloudApiClient (REST: /v1/models, agent CRUD)
this.baseUrl = process.env.CURSOR_BACKEND_URL ?? "https://api.cursor.com"

// Token exchange (/auth/exchange_user_api_key)
new B(apiKey, process.env.CURSOR_BACKEND_URL ?? "https://api2.cursor.sh", exchangeFn)
```

When unset, each uses its correct host. Setting it to any value forces both to the same host, breaking one or the other.

Crucially, both components use `globalThis.fetch` (not Connect RPC), so they are already handled by the fetch interceptor.

## Solution

Only set `CURSOR_API_BASE_URL` (for Connect RPC, which bypasses fetch). Leave `CURSOR_BACKEND_URL` **unset** so each SDK component uses its default host, and the fetch interceptor routes them through the proxy:

```typescript
if (bootConfig.proxyEndpoint) {
  const proxyBase = bootConfig.proxyEndpoint.replace(/\/+$/, "");
  process.env.CURSOR_API_BASE_URL = `${proxyBase}/v1/proxy/cursor/api2.cursor.sh`;
  // CURSOR_BACKEND_URL intentionally left unset
}
```

### How it works

The fetch interceptor (`fetch-interceptor.ts`) already intercepts all `fetch()` calls to Cursor domains and rewrites them through the proxy while preserving the original hostname:

| SDK Component | Default Host | Fetch Interceptor Rewrites To |
|---|---|---|
| CloudApiClient (`/v1/models`) | `api.cursor.com` | `{proxy}/v1/proxy/cursor/api.cursor.com/v1/models` |
| Token exchange (`/auth/exchange`) | `api2.cursor.sh` | `{proxy}/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key` |
| Connect RPC (agent send) | `CURSOR_API_BASE_URL` | Direct to proxy (doesn't use fetch) |

## Benefits

- Both REST and auth exchange route to their correct upstream hosts
- Connect RPC continues routing via `CURSOR_API_BASE_URL`
- No proxy-side changes needed
- OSS/direct mode unaffected (env vars remain unset)

## Impact

- **Desktop app**: Unblocks all Cursor-harness agent executions in cloud/proxy mode
- **OSS users**: No change — direct `CURSOR_API_KEY` flow unchanged

## Related Work

- [Fix Cursor SDK Proxy Routing via CURSOR_API_BASE_URL](2026-05-24-153338-fix-cursor-sdk-proxy-routing.md) — earlier fix that introduced this regression
- `CursorProxyController.java` — server-side proxy (no changes needed)
- `fetch-interceptor.ts` — the fetch interceptor that handles REST/fetch routing

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (iterative root cause analysis from SDK source)
