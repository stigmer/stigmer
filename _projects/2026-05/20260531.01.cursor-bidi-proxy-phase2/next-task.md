# Next Task: 20260531.01.cursor-bidi-proxy-phase2

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260531.01.cursor-bidi-proxy-phase2  
**Description**: Build a Netty-based BiDi HTTP/2 proxy handler in the Java service to make Cursor billing proxy-authoritative. The proxy intercepts the full-duplex AgentService/Run stream, extracts usage from bytes on the wire, and removes dependency on runner-reported data.  
**Goal**: Deploy a working Netty BiDi proxy on port 8082 that transparently forwards Cursor SDK Connect RPC streams to api2.cursor.sh while extracting billing usage, functioning correctly in local desktop dev (make desktop-dev), released desktop apps, and production Kubernetes deployment.  
**Tech Stack**: Java/Netty/Spring Boot (stigmer-cloud), TypeScript (runner), Kustomize/Planton (deployment), Caddy (local dev proxy)  
**Components**: stigmer-cloud: Netty server + handler + Spring lifecycle; stigmer: runner CURSOR_BACKEND_URL routing, Caddy local dev config, desktop app proxy endpoint; stigmer-cloud _kustomize: port 8082 in base + prod overlays; Planton deployment: ingress/service port

**Created**: 2026-05-31  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-05-31  
**Last Session**: Session 6 — Root-caused the billing failure. Two issues identified and one fixed.  
**Current Focus**: Runner must inject `x-stigmer-execution-id` header onto the Connect RPC HTTP/2 stream so the proxy can meter it.

## Session Progress (2026-05-31, session 4)

- Completed Task 5: End-to-end validation with real Cursor API key
- Rebuilt stigmer-service fat JAR to ensure latest BiDi proxy code
- Ran `TestAgentExecution_CursorUsage_FullPipeline` — PASS (streaming/billing ratio=1.00)
- Ran `TestAgentExecution_Config_ModelOverride/cursor` with `claude-haiku-4-20250514` — PASS
- Ran `TestAgentExecution_Config_ModelOverride/native` with `claude-sonnet-4-6` — PASS
- Confirmed billing records use `USAGE_METERING_SOURCE_PROXY_PROVIDER_REPORTED`
- All billing assertions: providerCostMicros > 0, billableCostMicros > 0, cross-ref ratio=1.00
- Key insight: `RecordLlmCallUsageHandler` hardcodes PROXY_PROVIDER_REPORTED for all proxy-reported usage

## Session Progress (2026-05-31, session 3)

- Completed Task 4: Verified all deployment scenarios are already wired correctly via path-routing
- Key finding: NO production code changes needed — path-routing from Tasks 2/3 handled everything
- Added `PathRoutingProxy` to integration test harness (mirrors Caddy/Istio path-based routing)
- Added `BiDiProxyPort` to `JavaService` with dynamic port allocation
- Updated `suite_test.go` and `e2e_provider_test.go` to use path-routing proxy
- Verified auth flow: `effectiveApiKey` passed programmatically to SDK (no env var gap)

## Session Progress (2026-05-31, session 2)

- Completed Task 3: port 8082 exposed in kustomize base + HTTPRoute applied to prod cluster
- Added `cursor-bidi-proxy` port to `_kustomize/base/service.yaml` with `appProtocol: http2`
- Created `stigmer-cursor-bidi-path-route.yaml` — routes `PathPrefix /aiserver.v1` → port 8082
- Applied HTTPRoute to `stigmer-prod` namespace via `kubectl apply`
- Verified: Istio gateway controller accepted the route (Accepted: True, ResolvedRefs: True)
- Route will 503 until next service deploy rolls out container with port 8082 — expected and harmless

## Session Progress (2026-05-31, session 1)

- Completed Task 2: runner routes Connect RPC through Caddy → Netty :8082 via path-based routing
- Key design decision: NO new env var. Follow the same `stigmer-proxy-path-route.yaml` pattern port 8081 uses
- `CURSOR_API_BASE_URL` = proxy endpoint (no path prefix); Caddy/Istio routes `/aiserver.v1*` to :8082
- Auth: CURSOR_API_KEY carries STIGMER_TOKEN JWT in proxy mode (proxy validates, replaces with real Cursor key)
- Verified: CursorBidiStreamHandler uses Spring Security BearerTokenAuthenticationToken — compatible
- All unit tests passing (14/14)

## Session Progress (2026-05-31, session 5)

- **Task 5B ROUTING FIX — COMPLETE**: Traffic now reaches BiDi proxy, agent executes successfully
- Root cause was NOT the fetch interceptor — it was `CURSOR_BACKEND_URL` (not set)
- SDK's `connect-node` bypasses `globalThis.fetch` entirely (uses native HTTP/2)
- SDK reads `CURSOR_BACKEND_URL` (not `CURSOR_API_BASE_URL`) for Connect RPC transport
- SDK service path is `agent.v1.AgentService/Run` (not `aiserver.v1` as previously assumed)
- Changes made across both repos:
  - `main.ts`: Set `CURSOR_BACKEND_URL = proxyEndpoint` (also keep `CURSOR_API_BASE_URL`)
  - `fetch-interceptor.ts`: Expanded to handle proxy-endpoint-targeted REST calls
  - `Caddyfile.dev`: Added `/agent.v1*` route alongside `/aiserver.v1*`
  - `path_routing_proxy.go`: TLS + h2c backend transport + `/agent.v1` prefix
  - `unified_runner.go`: `NODE_TLS_REJECT_UNAUTHORIZED=0` for TLS proxy in tests
  - `stigmer-cursor-bidi-path-route.yaml`: Added `/agent.v1` PathPrefix match
  - `CursorBidiStreamHandler.java`: ByteBuf retain-before-async fix + forward access token
- Test result: Agent executes through proxy, streaming_usage populated (input=10247, output=35)
- **Remaining issue**: `ProxyUsageReporter` emits no billing records — `ConnectEnvelopeDecoder`
  can't parse Cursor's response (sees JSON end-of-stream trailers as invalid envelope frames)

## Session Progress (2026-05-31, session 6)

- **Root-caused billing failure** — TWO issues discovered, not one:
  1. **FIXED: Gzip decompression** — Cursor responds with `connect-content-encoding: gzip`,
     meaning envelope payloads are gzip-compressed. `ConnectCursorUsageExtractor` was skipping
     them. Added `GZIPInputStream` decompression. 6 new unit tests, all passing.
  2. **NOT YET FIXED: Execution ID header missing** — The runner's Connect RPC client
     (`connect-node`) uses native HTTP/2 and bypasses the fetch interceptor. No
     `x-stigmer-execution-id` header is sent on the BiDi stream. The proxy sees
     `scope.metered()=false` and skips billing entirely.
- **Original assumption was wrong**: The problem was never "JSON end-of-stream trailers" —
  it was HTTP-level compression (`connect-content-encoding: gzip`). The "invalid envelope"
  warnings in earlier sessions were from OTHER non-agent RPCs (BootstrapStatsig with
  `content-encoding: br`, TrackEvents, DashboardService) being routed through the BiDi proxy.
- **Investigation method**: Added diagnostic logging, ran integration test, captured actual
  bytes and HTTP headers on the wire. Evidence-driven, not speculation.
- Key files modified:
  - `ConnectCursorUsageExtractor.java`: Added `decompressGzip()` method, removed skip-on-compress
  - `ConnectCursorUsageExtractorTest.java`: 6 new tests for gzip-compressed envelopes
  - `ConnectEnvelopeDecoder.java`: Restored to original (diagnostic logging removed)
  - `CursorBidiStreamHandler.java`: Diagnostic logging removed

## Context for Resume

- **Issue 1 (gzip) is FIXED** — unit tests pass, code committed in stigmer-cloud.
- **Issue 2 (execution ID header) is the ONLY remaining blocker** for billing.
- The proxy's `completeStream()` fires correctly (phase=RELAYING, scope=present),
  but `scope.metered()` is `false` because `effectiveExecutionId` is null.
- The fetch interceptor already sets `x-stigmer-execution-id` on REST calls (line 140
  of `fetch-interceptor.ts`). The same must happen for the HTTP/2 Connect transport.
- The `@cursor/sdk` creates its own internal Connect transport from `CURSOR_BACKEND_URL`.
  The runner cannot inject interceptors into the SDK's transport directly.
- **Recommended fix**: Intercept `http2.connect()` in the runner to inject
  `x-stigmer-execution-id` as a default header on streams opened to the proxy endpoint.
  This mirrors the fetch interceptor pattern but at the HTTP/2 layer.
- Once the header reaches the proxy, `ProxyAuthorizationService.authorizeProxyScopes()`
  will return `metered=true` and billing will flow.
- No production users on cursor harness — safe to iterate.

## Next Steps

1. **Inject `x-stigmer-execution-id` on HTTP/2 streams** — patch `http2.connect` in runner
   to add the header when connecting to `CURSOR_BACKEND_URL` (proxy endpoint)
2. Rerun `TestAgentExecution_CursorUsage_FullPipeline` — verify billing records appear
3. Run `TestAgentExecution_Config_ModelOverride` — verify REST proxy still works
4. Deploy stigmer-cloud to prod (merge PRs or trigger CI)
5. Apply updated HTTPRoute to prod cluster
6. Write final changelog entry

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

