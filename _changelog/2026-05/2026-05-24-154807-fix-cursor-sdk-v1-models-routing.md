# Fix Cursor SDK `/v1/models` Route Not Found in Proxy Mode

**Date**: May 24, 2026

## Summary

Fixed a routing error where the Cursor SDK's model validation call (`GET /v1/models`) was sent to the Connect RPC host (`api2.cursor.sh`) instead of the REST API host (`api.cursor.com`). The Connect RPC server doesn't serve REST endpoints, causing `Route GET:/v1/models not found` and blocking all workflow executions via the desktop app in cloud mode.

## Problem Statement

After the earlier proxy routing fix (commit `297575cb1`) that replaced the broken `globalThis.fetch` interceptor with `CURSOR_API_BASE_URL` / `CURSOR_BACKEND_URL` env vars, workflow executions via the desktop app started failing with:

```
ExecuteCursor failed: [c] [unknown] Route GET:/v1/models not found
```

### Pain Points

- Every `Agent.create({ model })` call failed in proxy mode — no workflow could execute
- The error was confusing: it appeared to be a missing route, but the proxy controller handles `/v1/models` fine
- Intermittent success masked the issue: previously-cached model lists or runners started before the fix worked fine

## Solution

Set `CURSOR_BACKEND_URL` to the correct Cursor REST API host (`api.cursor.com`) instead of the Connect RPC host (`api2.cursor.sh`).

The Cursor SDK internally uses two separate base URLs:
- `CURSOR_API_BASE_URL` → `api2.cursor.sh` (Connect RPC for agent send/receive)
- `CURSOR_BACKEND_URL` → `api.cursor.com` (REST API for `CloudApiClient`: model listing, agent CRUD, `/v1/me`)

The previous fix set both to `api2.cursor.sh`, but only `CURSOR_API_BASE_URL` should point there.

## Implementation Details

### 1. Runner startup (`main.ts`)

Changed `CURSOR_BACKEND_URL` to route through the `api.cursor.com` proxy path:

```typescript
process.env.CURSOR_API_BASE_URL = `${proxyBase}/v1/proxy/cursor/api2.cursor.sh`;
process.env.CURSOR_BACKEND_URL = `${proxyBase}/v1/proxy/cursor/api.cursor.com`;
```

No proxy-side changes needed — `api.cursor.com` is already in `CursorProxyController`'s `ALLOWED_UPSTREAM_HOSTS`, and `/v1/models` is already in `METADATA_UPSTREAM_PATHS` for scope bypass.

### 2. Updated routing test

Updated `cursor-baseurl-routing.test.ts` to use separate ports for each env var (19998 for Connect RPC, 19999 for REST API), verifying the SDK respects each independently.

## Benefits

- Desktop app can execute Cursor-harness workflows in cloud mode again
- Model validation correctly routes to the REST API host
- No changes needed on the proxy server side

## Impact

- **Desktop app**: Unblocks all Cursor-harness agent executions in cloud/proxy mode
- **OSS users**: No change — direct `CURSOR_API_KEY` flow leaves both env vars unset (SDK defaults work)

## Related Work

- [Fix Cursor SDK Proxy Routing via CURSOR_API_BASE_URL](2026-05-24-153338-fix-cursor-sdk-proxy-routing.md) — the earlier fix that introduced this regression
- `CursorProxyController.java` — server-side proxy (no changes needed)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (root cause analysis from SDK source + targeted fix)
