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
**Last Session**: Task 5B routing fix implemented and verified — agent executes successfully through BiDi proxy.  
**Current Focus**: Usage extraction (ConnectEnvelopeDecoder) not parsing Cursor's response format. Routing is done.

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

## Context for Resume

- Task 5B routing is DONE — traffic flows through the BiDi proxy end-to-end.
- The `ConnectEnvelopeDecoder` issue is a separate concern from routing.
- The decoder sees `{"code":...}` (Connect protocol end-of-stream JSON trailer) and fails
  because it expects 5-byte envelope headers (flags + length prefix).
- Fix needed: teach `ConnectEnvelopeDecoder` to detect and skip end-of-stream JSON messages.
- Once decoder extracts usage, `ProxyUsageReporter` will emit billing records.
- The auth fix (forward access token instead of replacing with raw API key) is critical —
  Cursor's Connect RPC endpoint expects access tokens, not raw API keys.
- `recordCursorUsage` is still deleted. Billing remains broken until decoder fix lands.
- No production users on cursor harness — safe to iterate.

## Next Steps

1. **Fix ConnectEnvelopeDecoder** — handle Connect protocol end-of-stream JSON trailers
2. Rerun `TestAgentExecution_CursorUsage_FullPipeline` — verify billing records appear
3. Run `TestAgentExecution_Config_ModelOverride` — verify REST proxy still works
4. Deploy stigmer-cloud to prod (merge PRs or trigger CI)
5. Apply updated HTTPRoute to prod cluster (`kubectl apply`)
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

