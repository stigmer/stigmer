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
**Last Session**: Completed Task 4 (verified production wiring, added PathRoutingProxy to test harness).  
**Current Focus**: Task 5 — End-to-end validation with real Cursor API key

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

## Context for Resume

- Tasks 1, 2, 3, 4 are DONE. The Netty handler is built, local dev is wired, prod routing is deployed, and all deployment scenarios verified.
- HTTPRoute `stigmer-cursor-bidi-path-route` is live in `stigmer-prod` namespace (will 503 until next deploy)
- The kustomize base change (port 8082) will take effect on the next CI deploy of stigmer-service
- Task 4 required no production code changes — path-routing eliminated the need
- Integration test harness now has `PathRoutingProxy` for end-to-end testing through the BiDi proxy
- Task 5 is about running actual Cursor API calls through the proxy and verifying billing records

## Next Steps

1. Task 5: Run `TestAgentExecution_CursorUsage_FullPipeline` with real CURSOR_API_KEY
2. Task 5: Verify MongoDB billing records have `metering_source: PROXY_OBSERVED`
3. Task 5: Test with both `claude-sonnet-4` and `gpt-4o` models
4. Task 6: Retire Phase 1 `recordCursorUsage` after prod validation

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

