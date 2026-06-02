# BiDi Proxy Routing Fix — Connect RPC Traffic Reaches Port 8082

**Date**: May 31, 2026

## Summary

Fixed the traffic routing so Cursor SDK's Connect RPC BiDi stream flows through the Netty proxy on port 8082 instead of bypassing it entirely. The root cause was not the fetch interceptor (as originally diagnosed) but an unset `CURSOR_BACKEND_URL` env var — the SDK's connect-node transport uses native HTTP/2 which bypasses `globalThis.fetch`, making the interceptor irrelevant for Connect RPC.

## Problem Statement

The BiDi proxy on port 8082 received zero traffic from the Cursor SDK. After deleting the Phase 1 `recordCursorUsage` fallback, billing for the cursor harness was intentionally broken pending this fix.

### Pain Points

- `CURSOR_API_BASE_URL` (the env var being set) only controls token exchange in SDK v1.0.13
- `CURSOR_BACKEND_URL` (the actual env var for Connect RPC transport) was never set
- Without it, the SDK defaults to `https://api2.cursor.sh` — connecting directly to Cursor, bypassing the proxy
- The SDK service uses `agent.v1.AgentService` (not `aiserver.v1.AgentService`) — routing rules only matched `aiserver.v1`
- The BiDi proxy handler had a ByteBuf reference counting bug (retain inside async lambda after frame release)
- The handler replaced valid Cursor access tokens with raw API keys (Cursor's Connect RPC rejects raw keys)

## Solution

Multi-layered fix addressing the actual root causes discovered through empirical testing:

1. **Set `CURSOR_BACKEND_URL`** — routes Connect RPC through the proxy endpoint
2. **Expand fetch interceptor** — handles SDK REST calls that now target the proxy endpoint
3. **Add `/agent.v1*` path routing** — matches the SDK's actual service name
4. **TLS proxy in tests** — SDK requires HTTPS for HTTP/2 (BiDi streaming needs HTTP/2)
5. **ByteBuf retain fix** — prevents use-after-free in response relay
6. **Forward access token** — Cursor expects tokens from token exchange, not raw API keys

## Implementation Details

### Runner (`stigmer` repo)

| File | Change |
|------|--------|
| `backend/services/runner/src/main.ts` | Set both `CURSOR_BACKEND_URL` and `CURSOR_API_BASE_URL` |
| `backend/services/runner/src/activities/execute-cursor/fetch-interceptor.ts` | `isProxyEndpointHost()` detection + `resolveUpstreamHost()` for proxy-targeted REST |
| `client-apps/desktop/scripts/Caddyfile.dev` | Added `/agent.v1*` → `:8082` (h2c) route |
| `test/integration/harness/path_routing_proxy.go` | TLS listener + h2c backend transport + `/agent.v1` prefix |
| `test/integration/harness/unified_runner.go` | `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed test cert |

### Java Service (`stigmer-cloud` repo)

| File | Change |
|------|--------|
| `_ops/.../stigmer-cursor-bidi-path-route.yaml` | Added `PathPrefix /agent.v1` to Istio HTTPRoute |
| `.../CursorBidiStreamHandler.java` | ByteBuf retain before async relay + forward original auth header |

## Benefits

- Connect RPC BiDi streams now flow: Runner → PathRouting → Netty :8082 → Cursor
- Agent executes successfully through the proxy (verified: input=10247, output=35 tokens)
- Production routing (HTTPS → HTTP/2) will enable full BiDi streaming
- Foundation for proxy-authoritative billing (once ConnectEnvelopeDecoder parses responses)

## Impact

- **Routing**: Complete — all deployment scenarios (local dev, tests, production) wired
- **Billing**: Pending — `ConnectEnvelopeDecoder` can't parse Connect protocol end-of-stream JSON trailers yet
- **Security**: Improved — forwards short-lived access tokens instead of raw API keys

## Remaining Work

The `ConnectEnvelopeDecoder` in `stigmer-cloud` doesn't handle Connect protocol's end-of-stream JSON trailer format (`{"code": "ok", ...}`). It interprets the JSON bytes as envelope frame headers, reads garbage length values, and resets. This prevents `ProxyUsageReporter` from extracting billing usage. Fixing the decoder is a focused Java-side task unrelated to routing.

---

**Status**: ✅ Routing Complete / ⏳ Billing Extraction Pending
**Timeline**: 1 session (session 5 of this project)
