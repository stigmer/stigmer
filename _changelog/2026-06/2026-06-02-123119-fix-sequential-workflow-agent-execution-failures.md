# Fix Sequential Workflow Agent Execution Failures

**Date**: June 2, 2026

## Summary

Fixed a critical bug where the second agent execution in a sequential workflow always failed with a 30-second timeout and zero messages. The root cause was a SecurityContext propagation bug in the BiDi proxy's auth thread pool, compounded by protocol-level error handling that poisoned HTTP/2 connections. Defense-in-depth session lifecycle management was added to the runner.

## Problem Statement

When running a workflow with multiple sequential `agent_call` tasks (e.g., `daily-notification-plan` with `analyze_player_data` → `design_notification_campaigns`), the first task completed successfully but the second task consistently failed with:
- SDK status: ERROR
- Messages received: 0
- Duration: ~30 seconds (timeout)
- Error: "Cursor run failed (no detail from SDK)"

### Pain Points

- Sequential workflows were unreliable — only single-task workflows worked
- The failure pattern was deterministic (first succeeds, second fails)
- No retry or recovery existed for this class of error
- `DashboardService/GetTeamAdminSettingsOrEmptyIfNotInTeam` errors flooded logs during execution

## Root Cause (4-Layer Failure Chain)

**Layer 1 — SecurityContext bug (BiDi proxy):** `CursorBidiStreamHandler` runs auth on a `bidi-auth` thread pool via `authExecutor.submit()`. The `authenticationManager.authenticate()` returns a valid `Authentication` object, but `SecurityContextHolder` was never set on that thread. When `authorizeProxyScopes` makes an in-process gRPC call to IAM/FGA, it finds no SecurityContext and treats the call as unauthenticated — resulting in `ProxyAccessDeniedException`.

**Layer 2 — Over-scoped FGA (BiDi proxy):** The proxy applied execution-level FGA (`can_edit` on `agent_execution`) to ALL paths including Cursor SDK-internal calls (`/aiserver.v1.DashboardService/*`, `/aiserver.v1.AnalyticsService/*`) that only need JWT authentication.

**Layer 3 — REFUSED_STREAM protocol misuse (BiDi proxy):** Auth failures were returned as raw `Http2Error.REFUSED_STREAM` instead of Connect-compatible error responses. After the client sends HEADERS + DATA, a stream reset at the protocol level poisons the HTTP/2 connection — Go's h2 transport reports "cannot retry after Request.Body was written" and subsequent streams fail.

**Layer 4 — No transport isolation (runner):** The runner never closed proxy h2 sessions between sequential activities. A degraded session from task #1 was reused by task #2. The error classifier didn't recognize transport-timeout patterns.

## Solution

### BiDi Proxy Fix (stigmer-cloud)

1. **SecurityContext propagation**: Set `SecurityContextHolder` on the `bidi-auth` thread before calling `authorizeProxyScopes`, clear in `finally` block. Mirrors what Spring Security's filter chain does for Tomcat requests.

2. **Path-based scope policy**: Added `requiresExecutionScope()` — only `/agent.v1.*` paths require execution-level FGA. All other paths (DashboardService, AnalyticsService) bypass FGA with `UNSCOPED` result while still requiring valid JWT authentication.

3. **Connect-compatible error responses**: Added `sendConnectError()` method that returns proper HTTP/2 response headers with `grpc-status` trailers instead of raw `RST_STREAM`. Auth failures now send 403/401 at the application level, preserving connection health.

### Runner Defense-in-Depth (stigmer OSS)

1. **Session lifecycle in http2-interceptor**: Track wrapped proxy sessions in a `Set`; export `closeProxySessions()` to force fresh connections.

2. **Activity entry cleanup**: Call `closeProxySessions()` at `ExecuteCursor` start so each workflow task gets a fresh h2 connection. Call `agent.close()` on completion paths.

3. **Transport-timeout heuristic**: Error classifier detects "0 messages + ~30s timeout on fresh agent" and classifies as `network/retryable`.

4. **One-shot transport retry**: When the heuristic fires, reset proxy sessions and retry with a fresh agent (mirrors existing poisoned-handle retry structure).

## Implementation Details

### Files Changed

**stigmer-cloud:**
- `backend/services/stigmer-service/.../bidi/CursorBidiStreamHandler.java` — SecurityContext, path policy, Connect errors

**stigmer (OSS):**
- `backend/services/runner/src/activities/execute-cursor/http2-interceptor.ts` — session tracking + `closeProxySessions()`
- `backend/services/runner/src/activities/execute-cursor/index.ts` — activity entry reset + agent.close() + transport retry
- `backend/services/runner/src/activities/execute-cursor/error-classifier.ts` — transport timeout heuristic + `refused_stream` pattern
- `test/integration/workflow_sequential_agent_calls_test.go` — new E2E test

### Key Design Decisions

- **No new module**: Session tracking lives in `http2-interceptor.ts` (natural extension of its existing `http2.connect` wrapping responsibility)
- **Deterministic cleanup over health scoring**: Close sessions between activities rather than threshold-based degradation detection
- **Security posture preserved**: Non-agent paths still require valid Stigmer JWT; only FGA authorization is relaxed for paths that don't need it
- **Protocol correctness**: `REFUSED_STREAM` reserved only for pre-authentication "no bearer token" case

## Benefits

- Sequential workflow tasks now complete reliably
- No more `DashboardService` REFUSED_STREAM noise in logs
- Transport isolation between activities prevents cascading failures
- Automatic recovery from transport degradation via one-shot retry
- Integration test coverage for the exact failure pattern

## Impact

- **Workflows**: Multi-step agent workflows (the primary user-facing feature) now work reliably
- **Billing**: Usage tracking for non-agent SDK calls no longer triggers spurious FGA denials
- **Observability**: Cleaner logs — no more `http2: Transport: cannot retry err [REFUSED_STREAM]` spam
- **Platform**: Unlocks production use of sequential agent orchestration patterns

## Related Work

- `2026-06-01-132458-fix-bidi-proxy-auth-failure.md` — earlier BiDi auth fix (different issue)
- `2026-06-01-140033-fix-bidi-proxy-fetch-interceptor-gap.md` — fetch interceptor alignment
- `2026-06-01-192653-fix-cursor-error-classification-and-session-persistence.md` — error classifier foundation

---

**Status**: Production Ready
**Timeline**: ~2 hours (investigation + implementation + test)
**Test**: `TestWorkflow_SequentialCursorAgentCalls` — PASS (24s, both tasks COMPLETED)
