# BiDi Proxy Phase 2: Task 4 — Production Wiring Verification and Test Harness

**Date**: May 31, 2026

## Summary

Verified that all production deployment scenarios (released desktop, cloud runners, CLI daemon) are already correctly wired for the Cursor BiDi proxy through path-based routing. Added a path-routing reverse proxy to the integration test harness to mirror production routing semantics (Caddy/Istio HTTPRoute) in test environments.

## Problem Statement

Task 4 required verifying that `CURSOR_BACKEND_URL` (actually `CURSOR_API_BASE_URL`) resolves correctly for all runner deployment scenarios: released desktop apps, cloud-spawned Daytona sandboxes, and CLI daemon mode.

### Pain Points

- Integration tests pointed `ProxyEndpoint` directly at Tomcat (port 8081), which cannot handle BiDi streaming
- No path-routing layer existed in the test environment (unlike production's Caddy/Istio)
- Needed to confirm the path-routing approach from Tasks 2/3 propagated correctly to all deployment paths

## Solution

Discovered that the "NO new env var — path-based routing" design decision from Task 2 eliminated the need for any production code changes. All deployment paths already flow `STIGMER_PROXY_ENDPOINT` correctly. The only actual work was adding test infrastructure to exercise the BiDi proxy end-to-end.

## Implementation Details

### Production Verification (No Code Changes Needed)

Traced the full data path for each scenario:

| Scenario | Proxy Source | Value | Routing |
|----------|-------------|-------|---------|
| Released desktop | `useEmbeddedRunner.ts` → `VITE_STIGMER_API_URL` | `https://api.stigmer.ai` | HTTPRoute `/aiserver.v1` → :8082 |
| Cloud runners (Daytona) | `DaytonaSandboxProvisioner.buildEnvVars()` | `https://api.stigmer.ai` | Same HTTPRoute |
| CLI daemon | Not set (direct mode) | N/A | Direct to `api2.cursor.sh` |

### Integration Test Harness Changes

1. **`test/integration/harness/path_routing_proxy.go`** (new): Lightweight Go reverse proxy with h2c support. Routes `/aiserver.v1*` to Netty BiDi port, everything else to Tomcat. Uses `golang.org/x/net/http2/h2c` for cleartext HTTP/2.

2. **`test/integration/harness/service.go`**: Added `BiDiProxyPort` to `JavaService` struct. Dynamically allocates a free port and passes `STIGMER_PROXY_CURSOR_BIDI_PORT` to the Java process.

3. **`test/integration/suite_test.go`**: Starts `PathRoutingProxy` and uses its address as the runner's `ProxyEndpoint`.

4. **`test/integration-session-routing/e2e_provider_test.go`**: Same pattern for session-routing tests.

## Benefits

- Integration tests now mirror production routing semantics exactly
- Enables end-to-end testing through the BiDi proxy (preparation for Task 5)
- Zero production code changes needed — validates the architectural decision from Task 2
- h2c-capable proxy allows Connect RPC testing without TLS in test environments

## Impact

- **Test infrastructure**: Integration tests can now exercise the full BiDi proxy path
- **Production confidence**: All deployment scenarios verified — no gaps in the env var chain
- **Architecture validation**: Confirms the path-routing approach scales across all deployment models

## Related Work

- Task 1: CursorBidiProxyHandler + CursorBidiProxyServer (Netty implementation)
- Task 2: Local dev wiring (Caddy path routing to :8082)
- Task 3: Kustomize + HTTPRoute deployment for port 8082
- Task 5 (next): End-to-end validation with real Cursor API key

---

**Status**: Production Ready
**Timeline**: 1 session (verification + test infrastructure)
