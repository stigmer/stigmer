# Fix Cursor SDK Proxy Routing via CURSOR_API_BASE_URL

**Date**: May 24, 2026

## Summary

Fixed a critical authentication failure in the desktop embedded runner's Cursor SDK integration. The proxy routing mechanism (added May 23) used a `globalThis.fetch` interceptor, but the Cursor SDK uses `@connectrpc/connect-node` which bypasses fetch entirely. Replaced with the SDK's native `CURSOR_API_BASE_URL` env var mechanism, dynamically derived from the Stigmer backend endpoint.

## Problem Statement

Workflow executions via the desktop app connected to a cloud-edition Stigmer server were failing immediately with `AuthenticationError: unauthenticated` from the Cursor SDK. The model registry fetch was also returning 401.

### Pain Points

- Desktop embedded runner could not execute any Cursor-harness agent executions
- The proxy routing (fetch interceptor) was architecturally incompatible with the SDK's transport layer
- Model pricing registry used a different env var (`STIGMER_AUTH_TOKEN`) than what the desktop runner provides (`STIGMER_TOKEN`)
- The issue was invisible during development because CLI daemon tests pass `CURSOR_API_KEY` directly

## Solution

Three targeted fixes that address the root cause without changing the proxy architecture:

1. Set `CURSOR_API_BASE_URL` env var at runner startup (from the proxy endpoint) so the SDK natively routes Connect RPC traffic through the Stigmer proxy
2. Pass the stigmer token as the API key in proxy mode (the proxy validates it and injects the real Cursor key)
3. Align the model pricing data token lookup to read `STIGMER_TOKEN`

## Implementation Details

### 1. Runner startup (`main.ts`)

Set `CURSOR_API_BASE_URL` and `CURSOR_BACKEND_URL` before any `@cursor/sdk` import. The SDK reads these as module-level constants, so they must be in `process.env` before activity code is imported:

```typescript
const bootConfig = loadConfig();
if (bootConfig.proxyEndpoint) {
  const proxyBase = bootConfig.proxyEndpoint.replace(/\/+$/, "");
  process.env.CURSOR_API_BASE_URL = `${proxyBase}/v1/proxy/cursor/api2.cursor.sh`;
  process.env.CURSOR_BACKEND_URL = `${proxyBase}/v1/proxy/cursor/api2.cursor.sh`;
}
```

Only activates in proxy/cloud mode — OSS/direct mode leaves the SDK defaults untouched.

### 2. Dynamic API key selection (`index.ts`)

In proxy mode, use the stigmer token (which the proxy validates). In direct mode, use the user's own Cursor API key:

```typescript
const effectiveApiKey = config.proxyEndpoint
  ? (config.stigmerTokenRef?.current ?? config.stigmerToken ?? config.cursorApiKey)
  : config.cursorApiKey;
```

### 3. Model registry token (`model-pricing-data.ts`)

```typescript
function getAuthToken(): string | undefined {
  return process.env.STIGMER_TOKEN ?? process.env.STIGMER_AUTH_TOKEN;
}
```

### Test infrastructure

Added three targeted smoke tests proving:
- Cursor SDK auth works with a valid API key (full round-trip)
- `globalThis.fetch` interceptor is never called by the SDK (proving it was broken)
- `CURSOR_API_BASE_URL` env var successfully redirects SDK traffic

## Benefits

- Desktop app can now execute Cursor-harness workflows against cloud-edition servers
- Model pricing registry fetches succeed (correct token used)
- No breaking changes for OSS/direct mode users
- Fetch interceptor kept as safety net for any fetch-based REST calls

## Impact

- **Desktop app**: Unblocks all Cursor-harness agent executions in cloud mode
- **OSS users**: No change — direct `CURSOR_API_KEY` flow unchanged
- **Cloud sandboxes**: No change — already had working token flow via different path

## Related Work

- `c8b033e4d` (May 23): Original proxy routing via fetch interceptor
- `cbe551d2f` (May 22): Auth token flow fix for desktop runner
- Slug validation issue (non-fatal, separate fix needed for session update)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (diagnosis + targeted fix + smoke tests)
