# Desktop Dev TLS Proxy for Runner HTTP/2

**Date**: May 31, 2026

## Summary

Added a TLS-enabled Caddy listener on port 9093 for the embedded runner's Cursor SDK traffic, fixing a `REFUSED_STREAM` error that occurred because the SDK only uses HTTP/2 over TLS and the existing plain-HTTP proxy on port 9090 caused it to fall back to HTTP/1.1 — bypassing the HTTP/2 interceptor that injects authentication headers.

## Problem Statement

After completing the BiDi proxy implementation (sessions 1-11) and confirming all integration tests pass, agent executions triggered from the desktop app via `make desktop-dev` failed with `REFUSED_STREAM` errors on every Connect RPC stream to the BiDi proxy.

### Pain Points

- Agent executions from the desktop UI returned "Cursor run failed (no detail from SDK)" after ~30 seconds
- All `/agent.v1.*` and `/aiserver.v1.*` requests got 502 from Caddy
- The integration test passed perfectly — creating a confusing "tests pass, app broken" state
- The error gave no obvious clue about the root cause (HTTP protocol mismatch)

## Solution

Root-caused the failure to a protocol mismatch between the integration test environment (HTTPS) and desktop-dev (HTTP):

1. **Integration test**: `PathRoutingProxy` serves HTTPS with a self-signed cert → SDK negotiates HTTP/2 via ALPN → `http2.connect()` fires → interceptor injects `x-stigmer-auth` → BiDi proxy authenticates → success
2. **Desktop-dev**: Caddy on `:9090` serves plain HTTP → SDK uses HTTP/1.1 → `http2.connect()` never fires → no `x-stigmer-auth` → BiDi proxy rejects → `REFUSED_STREAM`

Fix: added a second Caddy listener on `:9093` with TLS, dedicated to the runner's traffic.

## Implementation Details

**Architecture**: Two Caddy ports with clear separation of concerns:
- `:9090` (HTTP) — Frontend entry point (gRPC-Web, REST, native gRPC). Unchanged.
- `:9093` (HTTPS/H2) — Runner entry point (Connect RPC over HTTP/2). New.

**Files changed** (8 total, 118 insertions):

| File | Purpose |
|------|---------|
| `scripts/gen-dev-certs.sh` | Idempotent ECDSA P-256 cert generation for localhost |
| `scripts/Caddyfile.dev` | HTTPS :9093 site block with h2c backend transport |
| `.env.development` | `VITE_STIGMER_RUNNER_PROXY_URL=https://localhost:9093` |
| `useEmbeddedRunner.ts` | Proxy endpoint precedence: runner URL > API URL > fallback |
| `runner.rs` | `NODE_TLS_REJECT_UNAUTHORIZED=0` when proxy is HTTPS |
| `Makefile` | Cert generation before Caddy start |
| `.gitignore` | Exclude `.certs/` directory |
| `useEmbeddedRunner.test.ts` | New tests for env var precedence |

**Key design decisions**:
- Second port (not converting :9090) — zero blast radius on frontend/UI dev flow
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (not `NODE_EXTRA_CA_CERTS`) — same pattern as integration test, simpler wiring, acceptable in dev
- Gated on `proxy.starts_with("https://")` — only disables cert verification for TLS proxy, not all connections

## Benefits

- Desktop-dev agent executions now work end-to-end through the BiDi proxy
- Integration test and desktop-dev use the same TLS/HTTP/2 pattern — "test passes, app works" is a reliable invariant
- Frontend development flow completely untouched (no Tauri config changes, no cert trust issues)
- Cert generation is fully automatic and idempotent (runs once, skips thereafter)

## Impact

- **Desktop developers**: `make desktop-dev` now works for agent executions without manual intervention
- **CI/Integration tests**: Unchanged (they have their own `PathRoutingProxy` with ephemeral certs)
- **Production**: Unchanged (uses real TLS via Istio gateway)

## Related Work

- BiDi proxy implementation (sessions 1-11 of `20260531.01.cursor-bidi-proxy-phase2`)
- HTTP/2 interceptor (`http2-interceptor.ts`, session 7)
- `PathRoutingProxy` TLS design (`path_routing_proxy.go`, session 5)

---

**Status**: ✅ Production Ready (dev tooling)  
**Timeline**: 1 session (~30 minutes)
