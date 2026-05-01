# Cursor Runner Process Resilience and Proxy Observability

**Date**: May 1, 2026

## Summary

Fixed a crash-on-transient-error bug in the cursor-runner where an unhandled promise rejection from the Cursor SDK's background API key exchange killed the entire Temporal worker process. Added structured proxy request logging and fixed the CursorProxyController's response header policy for gRPC-Connect protocol compatibility.

## Problem Statement

When a Cursor Harness session executed on a runner, the cursor-runner process could crash from a single transient upstream error. The Cursor SDK performs background token refresh operations (at `api2.cursor.sh/auth/exchange_user_api_key`) that can fail due to momentary network blips. These background rejections were not caught by the activity's try-catch block because they originate from internal SDK promises outside the async execution context.

### Pain Points

- A single transient Cursor API hiccup crashes the entire Temporal worker, killing all queued activities on that runner
- Sessions get stuck at "Running" forever because the Temporal activity never returns (neither success nor failure)
- The fetch interceptor was silent on errors — no logging of which proxy requests failed, making diagnosis require reading minified SDK stack traces
- The CursorProxyController stripped all `x-*` response headers (copied from LlmProxyController), silently breaking gRPC-Connect protocol headers like `X-Cursor-Stream-Retention-Seconds` that the SDK depends on for stream resumption

## Solution

Three targeted changes across the cursor-runner (TypeScript) and CursorProxyController (Java):

1. **Process-level error handlers** — `unhandledRejection` and `uncaughtException` handlers that log aggressively but keep the process alive, letting Temporal's own retry policies handle activity failures
2. **Fetch interceptor observability** — Structured logging on every proxied Cursor request that fails (HTTP method, original Cursor path, response status or network error)
3. **Selective response header forwarding** — Replace blanket `x-*` stripping with targeted infrastructure header blocking (`x-envoy-*`, `x-cloud-trace-*`, `x-goog-*`), allowing Cursor SDK protocol headers through

## Implementation Details

### cursor-runner/src/main.ts

Added `process.on("unhandledRejection")` and `process.on("uncaughtException")` handlers before the main function. These log the full error with stack trace and cause chain but do not exit. The Temporal worker's own health checks detect wedged workers.

### cursor-runner/src/proxy/fetch-interceptor.ts

Wrapped the `originalFetch` call in a try/catch that logs:
- Non-2xx responses: `[proxy-interceptor] Cursor request failed: POST /auth/exchange_user_api_key → proxy status=502`
- Network errors: `[proxy-interceptor] Cursor request error: POST /auth/exchange_user_api_key → fetch failed`

### CursorProxyController.java (stigmer-cloud)

Changed `isForwardableResponseHeader` from:
- **Before**: Block all `x-*` headers
- **After**: Block only `x-envoy-*`, `x-cloud-trace-*`, `x-goog-*` infrastructure headers; forward all other headers including `x-cursor-*` and `x-request-id`

## Diagnostic Findings

Ran three tests to pinpoint the failure:
- **API key valid**: `curl -u KEY: https://api.cursor.com/v1/me` → 200 OK
- **Endpoints reachable**: `curl https://api2.cursor.sh/` → 200 OK
- **SDK works directly**: Agent creates, streams, and handles errors gracefully (no crash) when not routed through the proxy
- **SDK uses Bearer auth**: Confirmed via fetch interception that the SDK sends `Authorization: Bearer` (not Basic), so the proxy's auth scheme was already correct
- **SDK's auth endpoint**: `POST api2.cursor.sh/auth/exchange_user_api_key` — this is the "API key exchange" step referenced in the error message

The crash was specifically from a background token refresh that failed through the proxy (transient `upstream connect error` from Cursor's Envoy), combined with the missing process error handler.

## Benefits

- Cursor-runner survives transient upstream errors instead of crashing
- Future proxy failures produce actionable log lines instead of minified stack traces
- Cursor SDK protocol headers forwarded correctly, preventing potential stream resumption issues

## Impact

- **cursor-runner**: More resilient in production — transient Cursor API issues cause activity retries instead of worker death
- **CursorProxyController**: Correct header forwarding for gRPC-Connect protocol
- **Operators**: Better observability for Cursor proxy debugging

## Related Work

- `2026-05-01-132919-fix-cursor-proxy-403-add-execution-authorization.md` — execution-level FGA authorization for the proxy
- `2026-05-01-114424-fix-cursor-activity-temporal-routing.md` — derived task queue for cursor-runner routing

---

**Status**: ✅ Production Ready
