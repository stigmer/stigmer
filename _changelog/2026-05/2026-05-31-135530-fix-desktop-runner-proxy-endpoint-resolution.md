# Fix Desktop Runner Proxy Endpoint Resolution

**Date**: May 31, 2026

## Summary

Fixed a critical issue where the desktop app's embedded runner would start in "direct mode" (requiring a `CURSOR_API_KEY`) instead of proxy mode. The proxy endpoint is now derived synchronously from `VITE_STIGMER_API_URL` and gated on auth token presence, eliminating the dependency on an async `getServerInfo()` call that could fail silently.

## Problem Statement

The embedded runner started without `STIGMER_PROXY_ENDPOINT`, entering "direct mode" which requires a `CURSOR_API_KEY` that the desktop app intentionally never provides. This caused workflow executions to fail with:

```
ExecuteCursor failed: [Error] No Cursor API credential available. Mode=direct (CURSOR_API_KEY), proxyEndpoint=unset, hasStigmerToken=true, hasTokenRef=true
```

### Pain Points

- Workflow executions (e.g., daily cohort analysis) failed silently in the desktop app
- The error diagnostic showed `proxyEndpoint=unset` despite the stigmer token being available
- The `getServerInfo()` error handler silently swallowed failures, making the root cause invisible

## Solution

Replaced the async, failure-prone proxy endpoint resolution with a synchronous derivation:

- **Before**: `proxyEndpoint` was passed down from `App.tsx` after an async `getServerInfo()` gRPC call resolved the deployment mode to "cloud". If this call failed or raced with runner startup, the runner entered direct mode permanently.
- **After**: `getRunnerConfig()` derives `proxyEndpoint` internally from `VITE_STIGMER_API_URL` (which always has a URL scheme), gated solely on auth token presence. No async dependency, no race condition.

## Implementation Details

### Core Fix: `useEmbeddedRunner.ts`

- Removed the `proxyEndpoint` parameter from `getRunnerConfig()`
- Added `normalizeToUrl()` helper for defense-in-depth URL scheme enforcement
- Proxy endpoint resolution chain: `VITE_STIGMER_API_URL` → `localStorage("stigmer.apiUrl")` → `normalizeToUrl(stigmerEndpoint)`
- Gate: `stigmerToken` present = proxy mode; absent = no proxy (runner won't start anyway due to lazy startup)

### Cleanup: Removed prop threading

- Removed `UseEmbeddedRunnerOptions` interface and `proxyEndpointRef` from the hook
- Removed `proxyEndpoint` from `EmbeddedRunnerProviderProps`
- Removed `runnerProxyEndpoint` derivation from `App.tsx`

### Observability: `useServerDeploymentMode`

- Added `console.warn` when `getServerInfo()` fails (previously silently swallowed)
- The call still exists for UI feature gating (`DeploymentModeContext`) but no longer gates runner configuration

### Critical URL Scheme Detail

The proxy endpoint must include a scheme (`http://` or `https://`) because the runner's fetch interceptor uses it raw for URL construction. `VITE_STIGMER_SIDECAR_ENDPOINT` (`localhost:9090`, no scheme) would break the interceptor; `VITE_STIGMER_API_URL` (`http://localhost:9090`, with scheme) is the correct source.

## Benefits

- Eliminates the silent failure mode that caused workflow executions to fail
- Removes a race condition between async server-info resolution and runner startup
- Simplifies the component tree (4 fewer prop-threading touch points)
- Adds visibility into `getServerInfo()` failures for future debugging

## Impact

- **Desktop app**: Runner now reliably enters proxy mode on every startup
- **Workflow executions**: All Cursor-based agent executions work correctly
- **Developer experience**: `getServerInfo()` failures are now visible in dev console

## Related Work

- Runner proxy architecture: `backend/services/runner/src/activities/execute-cursor/fetch-interceptor.ts`
- Java Cursor proxy: `CursorProxyController.java` in stigmer-cloud

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
