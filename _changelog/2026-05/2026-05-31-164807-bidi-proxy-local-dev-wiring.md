# Wire BiDi Proxy for Local Dev via Path-Based Routing

**Date**: May 31, 2026

## Summary

Routed Cursor Connect RPC traffic (BiDi streaming) through the Netty BiDi proxy on port 8082 by leveraging path-based routing at the infrastructure layer — the same pattern the REST proxy (port 8081) already uses in production. No new environment variables introduced; the runner, desktop app, and CLI all work unchanged.

## Problem Statement

The Phase 2 Netty BiDi proxy on port 8082 (built in Task 1) was operational but no traffic reached it. The runner's `connect-node` transport was still sending Connect RPC requests through Caddy → Tomcat on port 8081, which buffers request bodies and deadlocks on BiDi streaming.

### Pain Points

- Agent executions using the Cursor harness could not leverage proxy-authoritative billing (the BiDi stream never reached the usage extractor)
- The old Tomcat path appeared to "work" for unary RPCs but silently failed for the main `AgentService/Run` BiDi stream
- The runner needed a way to reach port 8082 that worked identically in local dev and production without adding deployment complexity

## Solution

Follow the established infrastructure pattern: path-based routing at the routing layer (Caddy locally, Istio HTTPRoute in production) determines which backend handles the request. The runner simply sets `CURSOR_API_BASE_URL` to the proxy endpoint — no path prefix, no port awareness — and the routing layer sends `/aiserver.v1.*` paths to the Netty BiDi proxy on 8082.

This mirrors exactly how port 8081 is exposed in production via `stigmer-proxy-path-route.yaml` (supplementary HTTPRoute on the same Istio Gateway).

## Implementation Details

### Runner startup (`main.ts`)

Removed the `/v1/proxy/cursor/api2.cursor.sh` path prefix from `CURSOR_API_BASE_URL`. The SDK's `connect-node` transport now constructs natural Connect RPC paths like `/aiserver.v1.AgentService/Run`, which the routing layer matches.

### Runner config (`config.ts`)

In proxy mode, `CURSOR_API_KEY` now carries the STIGMER_TOKEN (a valid JWT) instead of the placeholder `"proxy-managed"`. This is the correct credential for the proxy endpoint — the Netty handler validates it via Spring Security's `AuthenticationManager` and replaces it with the real Cursor API key before forwarding upstream.

### Caddy routing (`Caddyfile.dev`)

Added `/aiserver.v1*` route with h2c backend transport to port 8082, placed before the existing `/v1/proxy/*` and catch-all rules.

### Unit tests (`config.test.ts`)

Added test cases verifying: STIGMER_TOKEN is used as cursorApiKey in proxy mode, explicit CURSOR_API_KEY takes precedence, and the fallback chain works correctly.

## Architecture

```
Runner (connect-node)
  → CURSOR_API_BASE_URL = http://localhost:9090 (Caddy)
  → Path: /aiserver.v1.AgentService/Run

Caddy :9090
  /aiserver.v1*   → :8082 (h2c, Netty BiDi proxy)
  /v1/proxy/*     → :8081 (Tomcat REST proxy)
  gRPC            → :8080 (gRPC server)
  other           → :9091 (grpcwebproxy)
```

Production (Task 3) will add a supplementary HTTPRoute for `PathPrefix /aiserver.v1` → port 8082, following the identical pattern as the existing `stigmer-proxy-path-route.yaml`.

## Benefits

- Zero new environment variables — runner, desktop, and CLI config unchanged
- Same URL in all environments (`http://localhost:9090` locally, `https://api.stigmer.ai` in production)
- Follows established infrastructure pattern (path-based routing via Caddy/Istio)
- Fails loudly if misconfigured (502 from Caddy, not silent buffering)
- Production deployment (Task 3) is a single YAML file, not a code change

## Impact

- Runner developers get BiDi streaming through the proxy in `make desktop-dev`
- Billing pipeline can observe token usage from the wire (proxy-authoritative billing)
- No changes required to desktop app, CLI daemon, or any env file
- Unblocks Task 3 (Kustomize/HTTPRoute) and Task 5 (end-to-end validation)

## Related Work

- Task 1: Netty BiDi proxy implementation (CursorBidiProxyServer, CursorBidiStreamHandler) — stigmer-cloud
- Phase 1: `_changelog/2026-05/2026-05-31-154028-fix-cursor-billing-pipeline-phase1.md` — server-side billing stopgap
- Production routing precedent: `stigmer-proxy-path-route.yaml` (port 8081 HTTPRoute)

---

**Status**: ✅ Production Ready (local dev); Task 3 needed for production deployment
**Timeline**: 1 session
