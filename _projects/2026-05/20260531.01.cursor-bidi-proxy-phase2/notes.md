# Notes: 20260531.01.cursor-bidi-proxy-phase2

**Created**: 2026-05-31

---

## Phase 1 Context (Completed — commit references)

Phase 1 restored cloud-side billing as a stopgap until this Phase 2 proxy is built.

- **stigmer** commit `645c352dd`: Removed runner-side billing emission, reverted CURSOR_BACKEND_URL
- **stigmer-cloud** commit `0583dd30`: Restored `recordCursorUsage` with correct provider resolution
- Plan file: `~/.cursor/plans/fix_cursor_billing_pipeline_ce007b46.plan.md`
- Changelog: `_changelog/2026-05/2026-05-31-154028-fix-cursor-billing-pipeline-phase1.md`

---

## Key Technical Findings (from investigation session)

### Why Tomcat Cannot Handle BiDi Streaming
- Tomcat uses the servlet model: reads full request body before dispatching
- Connect BiDi streaming (`AgentService/Run`) requires full-duplex HTTP/2
- Confirmed empirically: unary RPCs reach `CursorProxyController` successfully, but `AgentService/Run` never arrives

### Cursor SDK Env Var Mapping (reverse-engineered from @cursor/sdk v1.0.11 bundle)
- `CURSOR_BACKEND_URL` → Connect RPC transport baseUrl (AgentService) AND CloudApiClient baseUrl (REST)
- `CURSOR_API_BASE_URL` → REST token exchange endpoint only
- `api2.cursor.sh` serves Connect RPC but NOT REST (/v1/models → 404)
- `api.cursor.com` serves REST but NOT Connect RPC (AgentService/Run → 404)

### Runner Transport
- Cursor SDK uses `connect-node` (Node.js native HTTP/2) — bypasses `globalThis.fetch`
- This is why the fetch interceptor never sees the main agent stream
- The BiDi proxy must be a real HTTP/2 endpoint that `connect-node` can connect to

---

## Architecture Decision: Port 8082

| Port | Server | Protocol | Purpose |
|------|--------|----------|---------|
| 8080 | Netty (gRPC-java) | HTTP/2 (h2c) | Primary gRPC API |
| 8081 | Tomcat (Spring MVC) | HTTP/1.1 | REST proxy, webhooks |
| 8082 | Netty (NEW) | HTTP/2 (h2c local / TLS prod) | BiDi Cursor proxy |

### Why a New Port (Not Sharing 8080)
- Port 8080 uses gRPC-java's Netty integration which owns the channel pipeline
- Adding arbitrary HTTP/2 handlers to gRPC's pipeline would be fragile and conflict with gRPC's frame routing
- A dedicated port gives full control over the HTTP/2 codec and handler pipeline

---

## Reusable Code (Already Tested)

All of these exist in `stigmer-cloud` and have unit tests:

| Class | Tests | Purpose |
|-------|-------|---------|
| `ConnectEnvelopeDecoder` | 10 | Decode Connect RPC length-prefixed envelopes |
| `ProtobufFieldScanner` | 8 | Extract fields from protobuf without full deserialization |
| `ConnectCursorUsageExtractor` | 12 | Extract TurnEndedUpdate token usage from Connect stream |
| `ProxyUsageReporter` | — | Report extracted usage to billing pipeline |
| `ProxyAuthorizationService` | — | Validate runner auth tokens |
| `CursorModelResolver` | — | Resolve provider from model name |

---

## Key Files Reference

### stigmer-cloud (Java service)
| Purpose | Path |
|---------|------|
| Connect envelope decoder | `proxy/usage/connect/ConnectEnvelopeDecoder.java` |
| Connect usage extractor | `proxy/usage/ConnectCursorUsageExtractor.java` |
| Protobuf field scanner | `proxy/usage/connect/ProtobufFieldScanner.java` |
| Proxy usage reporter | `proxy/usage/ProxyUsageReporter.java` |
| Proxy auth service | `proxy/authorization/ProxyAuthorizationService.java` |
| Model resolver | `proxy/cursor/CursorModelResolver.java` |
| Kustomize base | `_kustomize/base/service.yaml` |
| Kustomize prod | `_kustomize/overlays/prod/service.yaml` |
| Spring gRPC config | `src/main/resources/application-grpc.yaml` |

### stigmer (OSS)
| Purpose | Path |
|---------|------|
| Runner main (CURSOR_BACKEND_URL) | `backend/services/runner/src/main.ts` |
| Runner config | `backend/services/runner/src/config.ts` |
| Desktop runner spawn | `client-apps/desktop/src-tauri/src/runner.rs` |
| Caddy local dev | `client-apps/desktop/scripts/Caddyfile.dev` |
| Usage accumulator | `backend/services/runner/src/activities/execute-cursor/usage-accumulator.ts` |

---

## Open Questions

1. **Ingress hostname for port 8082**: Use `api.stigmer.ai:8082` (same hostname, different port) or a dedicated hostname like `bidi.stigmer.ai:443`? Using a different port may have issues with some corporate firewalls.

2. **TLS termination**: Should Netty handle TLS directly, or should we terminate at the load balancer and use h2c internally? (Likely: TLS at LB, h2c inside cluster)

3. **Graceful degradation**: If the Netty proxy is down, should the runner fall back to direct Cursor connection? (Probably yes for resilience, with degraded billing.)

---

## Task 2 Design Decision: Path-Based Routing (No New Env Var)

**Date**: 2026-05-31

### Decision

Route Connect RPC to port 8082 via path-based routing at the infrastructure layer (Caddy locally, Istio HTTPRoute in prod) — same pattern port 8081 uses. NO new env var needed.

### Rationale

1. Production already uses supplementary HTTPRoutes for path-based routing (see `stigmer-proxy-path-route.yaml` for port 8081)
2. A new env var (`STIGMER_CURSOR_BIDI_ENDPOINT`) would require:
   - Desktop frontend changes (new VITE_ var)
   - Tauri changes (pass to runner)
   - CLI daemon changes
   - Planton variables-group entry
   - A public URL for port 8082 (non-standard port exposed via ingress — problematic for firewalls)
3. Path-based routing means: same hostname (`api.stigmer.ai`), same port (443), just different backend per path prefix
4. The runner doesn't need to know about port 8082 at all — it just talks to the proxy endpoint

### How CURSOR_API_BASE_URL Changed

| Before | After |
|--------|-------|
| `${proxyBase}/v1/proxy/cursor/api2.cursor.sh` | `${proxyBase}` |
| Path: `/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/Run` | Path: `/aiserver.v1.AgentService/Run` |
| All Connect RPC → Tomcat :8081 (which buffers BiDi) | Connect RPC → Caddy/Istio routes → Netty :8082 |

### Auth: Why CURSOR_API_KEY = STIGMER_TOKEN

The Cursor SDK is a black box — it uses `CURSOR_API_KEY` as the Bearer token for Connect RPC. The Netty handler validates Bearer tokens as JWTs via Spring Security. Since we can't inject custom headers into the SDK's internal `connect-node` transport, CURSOR_API_KEY must be the STIGMER_TOKEN JWT in proxy mode. This is the correct credential for the proxy endpoint (standard credential-injecting reverse proxy pattern).

### Open Question Resolved

Q: "Should port 8082 be exposed via ingress?"
A: YES, but NOT as a separate port. Use a supplementary HTTPRoute for `PathPrefix /aiserver.v1` on the SAME gateway (`api.stigmer.ai:443`). External clients hit the same URL — path routing sends to the right backend.

---

*Add notes here as you discover things during implementation.*
