# Tasks: 20260531.01.cursor-bidi-proxy-phase2

**Created**: 2026-05-31

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

---

## Task 1: Implement CursorBidiProxyHandler + CursorBidiProxyServer

**Status**: 🚧 IN PROGRESS
**Created**: 2026-05-31

Build a Netty-based HTTP/2 handler in the Java service that supports full-duplex BiDi streaming for Cursor's `AgentService/Run` Connect RPC endpoint.

### Subtasks
- [ ] Create `CursorBidiProxyServer` — Spring `@Component` that starts a Netty `ServerBootstrap` on port 8082 with HTTP/2 (h2c for local, TLS for prod). Lifecycle-managed by Spring (start on app startup, shutdown gracefully).
- [ ] Create `CursorBidiProxyHandler` — Netty `ChannelInboundHandler` that:
  - Accepts HTTP/2 connections from the runner
  - Validates auth by calling existing `ProxyAuthorizationService`
  - Opens an HTTP/2 connection to upstream (`api2.cursor.sh`)
  - Relays frames bidirectionally (client → upstream, upstream → client)
  - Tees upstream response frames through `ConnectEnvelopeDecoder` + `ConnectCursorUsageExtractor`
  - On stream completion, calls `ProxyUsageReporter.report()` with extracted usage
  - Extracts model from request body using existing `extractModelFromConnectRequest()`
- [ ] Add Spring configuration property `stigmer.proxy.cursor.bidi.port` (default: 8082)
- [ ] Wire into existing test infrastructure

### Key Files to Reuse (Zero Porting)
- `ConnectEnvelopeDecoder` (10 unit tests)
- `ProtobufFieldScanner` (8 unit tests)
- `ConnectCursorUsageExtractor` (12 unit tests)
- `ProxyUsageReporter`
- `ProxyAuthorizationService`
- `CursorModelResolver.inferProviderFromModel()`
- `RecordLlmCallUsageHandler` (full billing pipeline)

### Notes
- Tomcat (port 8081) cannot handle BiDi streaming — reads full request body before dispatch. This is why we need Netty.
- The Java service already runs Netty-based gRPC on port 8080. Port 8082 is a new Netty listener specifically for this proxy.
- Connect RPC BiDi streaming uses HTTP/2 with interleaved request/response frames on the same connection.

---

## Task 2: Wire local dev environment (make desktop-dev)

**Status**: ⏸️ TODO
**Created**: 2026-05-31

Ensure the Netty BiDi proxy on port 8082 is reachable in local desktop dev mode and the runner routes `AgentService/Run` through it.

### Subtasks
- [ ] Update `client-apps/desktop/scripts/Caddyfile.dev` to add routing rule for the BiDi proxy port
  - Connect RPC requests to `aiserver.v1.AgentService/Run` should route to `:8082`
  - OR: Runner connects to 8082 directly (bypassing Caddy) since it's local
- [ ] Update runner's `main.ts` to set `CURSOR_BACKEND_URL` to the Netty proxy port when `proxyEndpoint` is configured
  - In proxy mode: `CURSOR_BACKEND_URL = http://localhost:8082` (local) or `https://api.stigmer.ai:8082` (remote)
  - In non-proxy mode (no STIGMER_PROXY_ENDPOINT): leave CURSOR_BACKEND_URL unset (direct to Cursor)
- [ ] Verify `make desktop-dev` starts Java service with Netty listener on 8082
- [ ] Test: Run a Cursor execution locally and confirm traffic flows through the Netty proxy

### Current Local Dev Architecture (for reference)
```
Desktop App → Caddy (:9090) → /v1/proxy/* → Tomcat :8081
                             → gRPC        → gRPC server :8080 (h2c)
                             → gRPC-Web    → grpcwebproxy :9091

Runner (embedded Node.js) → CURSOR_BACKEND_URL → Netty :8082 (NEW)
                          → CURSOR_API_BASE_URL → Caddy :9090 → Tomcat :8081
```

### Key Decision
The runner uses `connect-node` (Node.js native HTTP/2 client), not `globalThis.fetch`. This means:
- It can connect directly to port 8082 without going through Caddy
- For local dev, `CURSOR_BACKEND_URL=http://localhost:8082` (h2c, no TLS)
- The existing `CURSOR_API_BASE_URL` (for REST token exchange) stays routed through Caddy/Tomcat

---

## Task 3: Update Kustomize + Planton deployment for port 8082

**Status**: ⏸️ TODO
**Created**: 2026-05-31

Expose port 8082 in the Kubernetes service spec so the Netty BiDi proxy is reachable in production.

### Subtasks
- [ ] Add port to `_kustomize/base/service.yaml`:
  ```yaml
  - name: cursor-bidi-proxy
    appProtocol: http2
    networkProtocol: TCP
    servicePort: 8082
    containerPort: 8082
    isIngressPort: false  # Only reachable from within the cluster (runner → service)
  ```
- [ ] Verify `_kustomize/overlays/prod/service.yaml` inherits the port (or add overlay if needed)
- [ ] If ingress is needed (runners outside the cluster), set `isIngressPort: true` and add hostname routing
- [ ] Verify Planton `KubernetesDeployment` CRD renders the port correctly into the k8s Service manifest

### Current Ports
| Port | Protocol | Purpose |
|------|----------|---------|
| 8080 | gRPC (h2c) | Primary API — all resource CRUD |
| 8081 | HTTP (Tomcat) | REST endpoints — LLM proxy, webhooks |
| **8082** | **HTTP/2 (Netty)** | **BiDi proxy — Cursor agent stream (NEW)** |

### Key Question
Should port 8082 be exposed via ingress (api.stigmer.ai:8082)?
- If runners always run in the same cluster → no ingress needed, use ClusterIP
- If runners can be remote (e.g., released desktop app) → need ingress
- **Answer: YES** — released desktop apps and CLI-managed runners connect from outside the cluster

---

## Task 4: Wire released desktop app and remote runners

**Status**: ⏸️ TODO
**Created**: 2026-05-31

Ensure the CURSOR_BACKEND_URL is correctly resolved in all deployment scenarios, not just local dev.

### Subtasks
- [ ] Desktop released builds (Tauri): ensure runner gets `CURSOR_BACKEND_URL` pointing to the remote Netty proxy
  - Check `client-apps/desktop/src-tauri/src/runner.rs` line ~149 where `STIGMER_PROXY_ENDPOINT` is passed
  - May need a separate env var or derive from STIGMER_PROXY_ENDPOINT (e.g., replace port with 8082)
- [ ] CLI daemon mode: runner started via `stigmer daemon start` — ensure config passes correct endpoint
- [ ] Cloud-deployed runners (pod-to-pod): `CURSOR_BACKEND_URL` should point to the service's internal DNS (e.g., `http://stigmer-service.stigmer-prod.svc:8082`)
- [ ] Verify the `config.ts` logic correctly derives the BiDi proxy URL from the existing config

### Deployment Scenarios
| Scenario | CURSOR_BACKEND_URL |
|----------|-------------------|
| Local dev (make desktop-dev) | `http://localhost:8082` |
| Released desktop (remote) | `https://api.stigmer.ai:8082` (or dedicated hostname) |
| CLI daemon (remote) | `https://api.stigmer.ai:8082` |
| Cloud runner (pod-to-pod) | `http://stigmer-service.stigmer-prod.svc:8082` |

### Notes
- The desktop app sets `STIGMER_PROXY_ENDPOINT` which is currently `http://localhost:9090` locally or `https://api.stigmer.ai` remotely
- The runner derives proxy config from `STIGMER_PROXY_ENDPOINT` in `config.ts`
- Need to decide: new env var `CURSOR_BIDI_PROXY_URL` vs derive from existing endpoint

---

## Task 5: Validate end-to-end

**Status**: ⏸️ TODO
**Created**: 2026-05-31

Run integration tests and manual validation to confirm proxy-authoritative billing works.

### Subtasks
- [ ] Run `TestAgentExecution_CursorUsage_FullPipeline` with CURSOR_API_KEY
- [ ] Verify new MongoDB billing records have:
  - `metering_source: USAGE_METERING_SOURCE_PROXY_OBSERVED` (not SERVER_OBSERVED)
  - Non-zero `providerCostMicros`
  - `BILLING_DEBIT_STATUS_DEBITED`
  - Correct provider (anthropic/openai, not "cursor")
- [ ] Verify `GetExecutionUsageReport` returns non-zero cost for cursor harness
- [ ] Test with both `claude-sonnet-4` and `gpt-4o` models to verify provider resolution
- [ ] Confirm Phase 1 `recordCursorUsage` is no longer needed (proxy records are appearing)

### Test Command
```bash
cd test/integration
CURSOR_API_KEY=$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key) \
STIGMER_SERVICE_JAR=/path/to/stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar \
go test -tags integration -run 'TestAgentExecution_CursorUsage' -timeout 300s -count=1 -v ./...
```

---

## Task 6: Retire Phase 1 recordCursorUsage

**Status**: ⏸️ TODO
**Created**: 2026-05-31

Once proxy-authoritative billing is validated in prod, remove the Phase 1 fallback.

### Subtasks
- [ ] Remove `recordCursorUsage` from `BillingActivities` interface
- [ ] Remove implementation from `BillingActivitiesImpl`
- [ ] Remove the call from `InvokeAgentExecutionWorkflowImpl.executeCursorFlow`
- [ ] Restore `usage-accumulator.ts` comment to "display-only" (its original purpose)
- [ ] Remove `CursorModelResolver` dependencies from `BillingActivitiesImpl` (AgentExecutionRepo, BillingUsageGrpcRepo)
- [ ] Keep `CursorModelResolver` — still used by `CursorProxyController`

### Notes
- Only do this AFTER prod validation confirms proxy records are reliably appearing
- The proxy is now the single billing source — runner's UsageAccumulator becomes truly display-only
- Consider a Workflow.getVersion gate for replay safety during the transition

---

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Integration test passing with proxy-authoritative billing
- [ ] Local dev (make desktop-dev) works end-to-end
- [ ] Released desktop app routes through the proxy correctly
- [ ] Prod deployment has port 8082 exposed and healthy
- [ ] Phase 1 fallback removed
- [ ] Changelog written

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!
