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
**Last Session**: Session 11 — Fixed billing model extraction. Discovered Cursor auto-selects model server-side (no model in request), sends empty trailers (`{}`), and embeds actual model in `providerOptions.cursor.modelName` inside JSON strings within protobuf response envelopes. Added regex scanner for model extraction, gzip support for request model extractor, `composer-2.5-fast` to pricing registry. Integration test `TestAgentExecution_CursorUsage_FullPipeline` PASSES fully.  
**Current Focus**: Deploy to production. All code is complete and tested.

## Session Progress (2026-05-31, session 11)

- **BILLING MODEL EXTRACTION — COMPLETE. Integration test PASSES fully.**
  - Root cause was threefold: Cursor auto-selects model server-side (no `model_details` in request protobuf), sends empty `{}` end-of-stream trailers, and embeds actual model in `providerOptions.cursor.modelName` inside JSON within protobuf response envelopes.
  - Wire-level investigation: Added INFO logging to `onEnvelope()` → 20 envelopes processed, trailer=`{}`. Hex-dumped first request envelope → `model_details` field 3 absent. ASCII-scanned all response envelopes → found `"modelName":"composer-2.5-fast"` in envelope #13.

- **Changes made (stigmer-cloud):**
  - `ConnectCursorUsageExtractor.java` — Added `scanForModelName()` regex scanner for `"modelName":"<value>"` in response payloads. Added `extractFromTrailer()` for Connect trailer metadata parsing. Uses extracted model in `finish()` instead of hardcoded "unknown".
  - `ConnectModelExtractor.java` — Added gzip decompression for compressed request envelopes. Fixed pre-existing `onFirstEnvelope()` reentrancy bug (second envelope overwrite).
  - `CursorModelResolver.java` — Added `"composer"` prefix → `"cursor"` provider mapping.
  - `model-registry.json` — Added `composer-2.5-fast` pricing entry.
  - `ConnectCursorUsageExtractorTest.java` — 10 new tests (trailer metadata, providerOptions scan, precedence).
  - `ConnectModelExtractorTest.java` — 1 new test (gzip-compressed extraction), renamed existing test.

- **Integration test result:**
  - `STREAMING_USAGE: input=10247 output=24 turns=1 cost=$0.011097 model=default`
  - `EXECUTION_REPORT: input=10247 output=24 calls=1 provider=5555 billable=6111 model=composer-2.5-fast`
  - `CROSS_REF: streaming_total=10271 billing_total=10271 ratio=1.00`
  - All assertions pass: `providerCostMicros > 0` ✓, `billableCostMicros > 0` ✓, ratio=1.00 ✓

## Next Steps

1. **Commit stigmer-cloud changes** — 7 files, 386 insertions
2. **Create PRs** — stigmer-cloud PR for billing model extraction
3. **Deploy** — Merge PRs, deploy stigmer-cloud to prod
4. **Run REST proxy validation** — `TestAgentExecution_Config_ModelOverride/cursor` to confirm REST proxy still works
5. **Complete project** — All tasks done, write final project completion notes

## Context for Resume

- The BiDi proxy billing pipeline is END-TO-END COMPLETE. Auth ✓, tokens ✓, model ✓, cost ✓.
- `TestAgentExecution_CursorUsage_FullPipeline` PASSES fully. Do NOT revisit any prior issues.
- The ONLY remaining work is deployment: commit, PR, merge, deploy.
- All diagnostic logging has been removed from production code.
- Fat JAR is rebuilt with all fixes.

## Session Progress (2026-05-31, session 10)

- **CURSOR SDK AGENT RUN ERROR — ROOT-CAUSED AND FIXED:**
  - **Root cause**: `rewriteHeaders()` unconditionally stripped the client's `authorization` header (which contained a valid Cursor access token from token exchange) and replaced it with the raw Cursor API key from `cursorConfig.getApiKey()`. Cursor's streaming endpoint rejects raw API keys — it requires the access token obtained via token exchange.
  - **Auth flow traced**: Runner → SDK exchanges Stigmer JWT for Cursor access token (via REST proxy) → SDK opens stream with `authorization: Bearer <access_token>` → HTTP/2 interceptor adds `x-stigmer-auth` (proxy auth) → BiDi proxy authenticates via `x-stigmer-auth` ✓ → BUT strips valid `authorization` and replaces with raw key → Cursor rejects
  - **Fix**: When `x-stigmer-auth` is present (Option A path), forward the client's `authorization` to upstream as-is (it's the Cursor access token). Only replace with raw API key in the legacy path where `authorization` was used for proxy auth.

- **Integration test CONFIRMS proxy works end-to-end:**
  - Agent execution completes in ~14 seconds (was: 4-min timeout / instant error)
  - `STREAMING_USAGE: input=10247 output=37 turns=1 cost=$0.012071 model=default`
  - `CROSS_REF: streaming_total=10284 billing_total=10284 ratio=1.00`
  - BiDi upstream connects to `api2.cursor.sh:443` successfully
  - Zero "authorization denied" messages

- **Remaining test failure — billing cost computation (pre-existing issue):**
  - `EXECUTION_REPORT: input=10247 output=37 calls=1 provider=0 billable=0 model=unknown`
  - `ConnectEnvelopeDecoder: invalid payload length 576941924` — still can't parse response
  - `ConnectEnvelopeDecoder: invalid payload length 68682032` — flags byte issue
  - The decoder can't handle Cursor's Connect RPC end-of-stream trailers
  - Without model extraction, pricing fails → provider_cost=0 → billable_cost=0

- **Changes made (stigmer OSS):**
  - `backend/services/runner/src/config.ts` — Updated comment to reflect correct Option A auth flow

- **Changes made (stigmer-cloud):**
  - `CursorBidiStreamHandler.java` → `rewriteHeaders()` — Conditional auth forwarding: forward client's `authorization` when `x-stigmer-auth` present, replace with API key otherwise

## Next Steps

1. **FIX: ConnectEnvelopeDecoder response parsing (billing blocker)**
   - The decoder sees `invalid payload length 576941924` (0x22 = `"` JSON) and `68682032` (0x04 flags)
   - Cursor's Connect RPC response likely includes end-of-stream trailer frames (flags=0x02) containing JSON metadata with usage
   - The decoder needs to handle: (a) trailers frame (flags != 0), (b) JSON metadata in the trailer
   - The `ConnectCursorUsageExtractor` may need to extract usage from the trailer JSON, not just from data envelopes
   - Reference: Connect streaming protocol spec — end-of-stream message has `flags & 0x02` set, body is JSON `{"metadata": {...}}`

2. **After decoder fix:** Rerun `TestAgentExecution_CursorUsage_FullPipeline` — should pass fully
3. **Then:** Run `TestAgentExecution_Config_ModelOverride/cursor` to confirm REST proxy path still works
4. **Deploy:** Merge PRs, deploy stigmer-cloud to prod
5. **Changelog:** Write final changelog entry

## Context for Resume

- The PROXY AUTH IS FULLY FIXED. Agent streams now complete successfully through the BiDi proxy. Do NOT revisit auth.
- The ONLY remaining issue is billing cost extraction — the `ConnectEnvelopeDecoder` can't parse Cursor's response bytes.
- The `ConnectCursorUsageExtractor.finish()` returns usage with tokens (from some path) but model="unknown" because it can't parse the response envelopes to find model/usage JSON.
- The Connect streaming protocol end-of-stream frame has `flags & 0x02` set and contains JSON like `{"metadata": {"trailer-key": "value"}}`. The decoder should recognize this flag byte and parse the trailer JSON instead of treating it as a data envelope.
- Token counts (10247/37) match between streaming and billing, suggesting the proxy IS seeing the data — it just can't decode the response format.
- The fat JAR and runner are both rebuilt with the auth fix.

## Session Progress (2026-05-31, session 9)

- **REFUSED_STREAM ROOT-CAUSED AND FIXED — two independent issues found:**
  1. **Auth identity mapping gap (PRIMARY)**: The test `IntegrationTestSecurityConfig.authenticationManager()` accepted all tokens but returned the raw `BearerTokenAuthenticationToken` unchanged. The BiDi handler passed this to `ProxyAuthorizationService.authorizeProxyScopes()`, which called `RequestCallerIdentityMapper.map()` — but the mapper couldn't extract an identity from a `BearerTokenAuthenticationToken` (it only knows `PlatformClientAuthenticationToken`, `FederatedAuthenticationToken`, `JwtAuthenticationToken`, `BearerTokenAuthentication`). Result: `user=""`, FGA denied `can_edit`, handler sent `RST_STREAM(REFUSED_STREAM)`.
  2. **Port readiness race (SECONDARY)**: `service.go` waited for the gRPC port but not the BiDi port. The BiDi proxy starts at `SmartLifecycle` phase `DEFAULT_PHASE - 1` (near end of Spring lifecycle). In the failing rerun, requests arrived 17 seconds before the BiDi proxy bound its port.

- **Both issues FIXED:**
  - `IntegrationTestSecurityConfig.java` — `authenticationManager()` now takes `StigmerJwtVerifier`, verifies Stigmer JWTs, returns `PlatformClientAuthenticationToken` with the JWT `sub` claim. Falls back to accept-all for non-Stigmer tokens.
  - `service.go` — Added `waitForPortOrExit(ctx, bidiAddr, 60s)` after gRPC port check. Service startup log now shows `bidi_proxy=` address.

- **Verified: BiDi proxy now works end-to-end through the test harness:**
  - Zero "authorization denied" messages in service log
  - Upstream connection to `api2.cursor.sh` succeeds
  - Data flows bidirectionally through the proxy
  - `ConnectCursorUsageExtractor` processes envelopes (1 processed, no turn_ended events — because the upstream run errored)

- **NEW ISSUE DISCOVERED: Cursor SDK agent run returns error:**
  - After fixing both proxy issues, the Cursor SDK `AgentService/Run` stream now flows through the BiDi proxy correctly
  - But the Cursor API returns an error — the SDK reports `status=ERROR` with no detail
  - The run goes RUNNING → ERROR in ~2 seconds with zero messages
  - REST proxy calls (token exchange, model list) return 200 — API key is valid
  - `ConnectEnvelopeDecoder: invalid payload length 576941924` appears on response data — suggesting the upstream response contains non-envelope content (possibly a JSON error body)
  - This error was previously masked: when auth denied the BiDi stream, the SDK likely retried via a direct connection path and succeeded
  - Runner also reports `Failed to fetch model registry from API: 401` but continues with default pricing

- **Changes made (stigmer OSS):**
  - `test/integration/harness/service.go` — Added BiDi port readiness wait, updated "ready" log message

- **Changes made (stigmer-cloud):**
  - `IntegrationTestSecurityConfig.java` — Updated `authenticationManager()` to resolve Stigmer JWTs via `StigmerJwtVerifier`

## Next Steps

1. **INVESTIGATE: Cursor SDK agent run error (the ONLY remaining blocker)**
   - The BiDi proxy is now correctly forwarding traffic — the error comes from the Cursor API upstream
   - Add `Http2FrameLogger` to the upstream client pipeline to see the exact HTTP status code and response headers from `api2.cursor.sh`
   - Check if the error is in the response STATUS (4xx/5xx) or in the response BODY (Connect RPC error envelope)
   - Compare request headers sent by the proxy vs what the Cursor SDK sends directly — look for missing headers that Cursor requires
   - Test with a direct connection (no proxy) to confirm the Cursor API works — if it also fails, the API key may be the issue
   - Check the `rewriteHeaders()` logic — are all required headers (content-type, connect-protocol-version, te, etc.) being forwarded?

2. **After SDK error is fixed:** Rerun `TestAgentExecution_CursorUsage_FullPipeline` — should validate full billing pipeline
3. **Then:** Run `TestAgentExecution_Config_ModelOverride/cursor` to confirm REST proxy path still works
4. **Deploy:** Merge PRs, deploy stigmer-cloud to prod
5. **Changelog:** Write final changelog entry

## Context for Resume

- The REFUSED_STREAM is FULLY DIAGNOSED AND FIXED. Do NOT revisit it.
- The BiDi proxy is now working correctly — auth succeeds, upstream connects, data relays bidirectionally.
- The remaining issue is that the Cursor API itself returns an error when the agent stream goes through the proxy. The proxy is forwarding the error faithfully.
- The `ConnectEnvelopeDecoder` sees `invalid payload length 576941924` — this is `0x22640E64` in hex, where `0x22` is `"` (double quote). This suggests the upstream response is JSON (not a Connect RPC envelope), which happens when the Cursor API returns an HTTP error response.
- REST proxy calls (token exchange, /v1/models) return 200 — the API key works for REST but the agent stream fails.
- The `rewriteHeaders()` method replaces auth with the Cursor API key and sets `:authority` to `api2.cursor.sh`. Other headers (content-type, connect-*, etc.) are passed through from the client.
- The fat JAR was rebuilt with the auth fix and Bazel confirms clean build.

## Session Progress (2026-05-31, session 8)

- **Option A IMPLEMENTED — code complete, all unit tests pass:**
  - Decided on Option A (`x-stigmer-auth` dedicated header) to resolve the dual-auth blocker
  - Runner interceptor now injects `x-stigmer-auth: Bearer <stigmerJWT>` instead of overwriting `authorization`
  - Java BiDi handler now reads `x-stigmer-auth` first (via new `extractStigmerAuthToken()`), falls back to `authorization`/`x-api-key` for backward compat
  - Removed `console.debug` diagnostic logging from interceptor
  - Key insight confirmed: `HttpSecurityConfig.java` docs explicitly state the shared `AuthenticationManager` validates "Auth0, API keys, federated IdPs, Stigmer-signed tokens" — so the Stigmer JWT from `x-stigmer-auth` will authenticate correctly

- **Unit tests ALL PASS:**
  - TypeScript: 17/17 (interceptor injects `x-stigmer-auth`, preserves original `authorization` untouched)
  - Java: All tests pass including 18 new tests for `extractStigmerAuthToken` and precedence logic

- **Integration test BLOCKED by Netty-level `REFUSED_STREAM`:**
  - The test `TestAgentExecution_CursorUsage_FullPipeline` fails with `REFUSED_STREAM` on all streams
  - ZERO `CursorBidiStreamHandler` log lines appear (handler is never invoked)
  - This means the refusal happens at the Netty HTTP/2 protocol layer (below the handler)
  - The `IntegrationTestSecurityConfig` accepts ALL tokens — auth is not the cause
  - This issue is NOT caused by the Option A changes (which only affect handler-internal logic)
  - Likely a pre-existing issue from earlier session workspace changes or environment config

- **Changes made (stigmer OSS):**
  - `backend/services/runner/src/activities/execute-cursor/http2-interceptor.ts` — renamed `AUTHORIZATION_HEADER` → `STIGMER_AUTH_HEADER`, updated injection, removed `console.debug`
  - `backend/services/runner/src/activities/execute-cursor/__tests__/http2-interceptor.test.ts` — updated assertions for `x-stigmer-auth`, added test verifying `authorization` passes through unchanged

- **Changes made (stigmer-cloud):**
  - `CursorBidiStreamHandler.java` — added `STIGMER_AUTH_HEADER` constant, `extractStigmerAuthToken()` method, updated `handleHeaders()` to prefer `x-stigmer-auth`, added `x-stigmer-auth` to NON_FORWARDABLE set
  - `CursorBidiStreamHandlerTest.java` — added `ExtractStigmerAuthToken` nested test class (7 tests) + `TokenExtractionPrecedence` class (3 tests)

## Next Steps

1. **DIAGNOSE: Netty REFUSED_STREAM (the ONLY remaining blocker)**
   - The Go `PathRoutingProxy` (h2c transport) connects to Netty BiDi proxy
   - Netty refuses ALL streams before the handler is even invoked
   - Need to investigate: Is this a pre-existing issue? Run the test with the session-7 code (before Option A changes) to confirm
   - Check if `CursorBidiUpstreamClient` initialization failure causes server-level stream refusal
   - Add temporary Netty pipeline-level logging (e.g., `Http2FrameLogger`) to see what's happening at the frame level
   - Check if the Go `http2.Transport` with `AllowHTTP: true` h2c prior-knowledge sends a proper connection preface that Netty accepts

2. **After REFUSED_STREAM is fixed:** Rerun `TestAgentExecution_CursorUsage_FullPipeline` — should validate full billing pipeline
3. **Then:** Run `TestAgentExecution_Config_ModelOverride/cursor` to confirm REST proxy path still works
4. **Deploy:** Merge PRs, deploy stigmer-cloud to prod
5. **Changelog:** Write final changelog entry

## Context for Resume

- The Option A implementation is COMPLETE and tested (unit level). The only gap is end-to-end validation.
- The `REFUSED_STREAM` issue happens BELOW the handler — adding handler-level logging won't help. Need Netty frame-level diagnostics.
- The `PathRoutingProxy` (Go) uses `http2.Transport{AllowHTTP: true}` to speak h2c to Netty's `Http2FrameCodecBuilder.forServer()`. This worked in session 5 but is now failing.
- Possible causes: Netty server not fully initialized when first stream arrives, upstream client blocking server startup, or Go transport sending frames Netty doesn't expect.
- The fat JAR was rebuilt with Option A changes and Bazel confirms clean build (only a pre-existing deprecation warning).
- Runner was rebuilt (`make build-runner`) — fingerprint `1cd2483bfc61ea08`.

## Session Progress (2026-05-31, session 7)

- **HTTP/2 interceptor BUILT AND WORKING** — full implementation complete:
  - Created `http2-interceptor.ts` using `createRequire()` to patch `http2.connect` on the CJS module singleton
  - Discovered and solved the ESM namespace freeze problem: `import * as http2 from "node:http2"` creates a frozen namespace; default import mutations are invisible to namespace consumers. Fix: use `require()` which modifies the shared singleton visible to all importers.
  - 17 unit tests passing, all wired into `runner.ts` and `runner-manager.ts`
  - Integration test CONFIRMS header injection works: Go PathRoutingProxy logs show `X-Stigmer-Execution-Id` reaching the Java service on ALL streams including `/agent.v1.AgentService/Run`

- **Discovered dual-auth architectural issue** — the ONLY remaining blocker:
  - The BiDi proxy's `AuthenticationManager` validates Cursor access tokens (obtained via token exchange). This is how it worked in sessions 4-5.
  - For billing (metered=true), FGA needs to check `can_edit` on `agent_execution`. This requires a Stigmer JWT as the authenticated principal.
  - If we replace `authorization` with the Stigmer JWT, auth fails (the auth manager doesn't recognize it). If we keep the Cursor token, FGA can't authorize the execution.
  - This is NOT a runner-side problem — the interceptor correctly injects both the token and the execution ID. The issue is the Java service's auth configuration for the BiDi handler.

- **Changes made (stigmer OSS)**:
  - `backend/services/runner/src/activities/execute-cursor/http2-interceptor.ts` (NEW)
  - `backend/services/runner/src/activities/execute-cursor/__tests__/http2-interceptor.test.ts` (NEW, 17 tests)
  - `backend/services/runner/src/runner.ts` — wired interceptor
  - `backend/services/runner/src/runner-manager.ts` — wired interceptor

- **Changes made (stigmer-cloud)** — TENTATIVE, needs revision:
  - `CursorBidiStreamHandler.java` — added `authorization` to non-forwardable headers and removed conditional cursor key injection. This change is directionally correct but insufficient alone — the auth manager must ALSO accept Stigmer JWTs.

## Architectural Decision Required: Dual Authentication

Three options identified:

### Option A: Dedicated Stigmer auth header (`x-stigmer-auth`)
- Runner sends `x-stigmer-auth: Bearer <stigmer-jwt>` alongside the regular `authorization` (Cursor token)
- BiDi handler reads `x-stigmer-auth` for FGA/billing, uses regular `authorization` for upstream
- **Pros**: Clean separation, no auth manager changes, backward compatible
- **Cons**: Non-standard header for auth, adds a bespoke protocol concept

### Option B: Dual auth provider in `AuthenticationManager`
- Configure Spring Security to try Stigmer JWT validation first, fall back to Cursor token
- When Stigmer JWT is present: full FGA + billing
- When Cursor token is present: relay-only (unmetered, backward compat)
- **Pros**: Standard Spring Security pattern, single `authorization` header
- **Cons**: More complex auth chain, implicit behavior difference based on token type

### Option C: Trust execution ID without FGA (skip `authorize()`)
- When `x-stigmer-execution-id` is present, set `metered=true` without FGA check
- The execution ID itself is proof of intent (only the runner knows it)
- **Pros**: Simplest change (2 lines in Java), no auth changes needed
- **Cons**: Weakens security — any request with a valid execution ID gets metered regardless of who sent it

### RECOMMENDATION: Option A

**Rationale:**
1. **Cleanest separation of concerns** — auth for Cursor upstream (authorization header) vs auth for Stigmer billing (x-stigmer-auth) are two distinct purposes that shouldn't share a header
2. **No auth chain complexity** — the existing AuthenticationManager stays unchanged for the Cursor token path; a separate, simple JWT validation handles the Stigmer header
3. **Fully backward compatible** — requests without `x-stigmer-auth` continue to work exactly as before (UNSCOPED, unmetered)
4. **Mirrors the fetch interceptor pattern** — the REST proxy already receives Stigmer JWT as `authorization` because it replaces Cursor tokens. The BiDi path has a different constraint (Cursor token must reach upstream for token validation). A separate header is the natural solution when you need both.
5. **Security posture preserved** — FGA still validates the authenticated Stigmer identity against the execution, unlike Option C which trusts the header alone
6. **Implementation is straightforward**:
   - Runner: interceptor already injects `authorization`; change to `x-stigmer-auth` instead
   - Java handler: read `x-stigmer-auth` for `authenticationManager.authenticate()` and FGA; keep `authorization` for upstream forwarding
   - Add `x-stigmer-auth` to non-forwardable headers (don't send to Cursor)

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

- **HTTP/2 interceptor is COMPLETE and WORKING** — headers reach the Java proxy.
- **The ONLY remaining blocker** is the dual-auth problem described above.
- The interceptor uses `createRequire(import.meta.url)` to get the CJS module singleton,
  patches `http2.connect`, wraps sessions targeting the proxy, and injects both
  `authorization` (Stigmer JWT) and `x-stigmer-execution-id` per-stream from AsyncLocalStorage.
- The ESM namespace freeze issue is solved. Verified via integration test: Go proxy logs
  confirm headers arrive on `/agent.v1.AgentService/Run`.
- The `CursorBidiStreamHandler.java` change (authorization → non-forwardable) is
  directionally correct but needs to be paired with Option A's `x-stigmer-auth` approach.
- No production users on cursor harness — safe to iterate.
- The stigmer-cloud change to `CursorBidiStreamHandler.java` should be REVERTED to the
  session-6 state before implementing Option A (the current edit assumed we'd replace
  `authorization`, but with Option A we use a separate header instead).

## Next Steps

1. **Decide on Option A/B/C** (recommendation: Option A — `x-stigmer-auth` header)
2. **Implement chosen option in Java BiDi handler** — add `x-stigmer-auth` header extraction,
   validate Stigmer JWT from it, use for FGA. Keep `authorization` for Cursor upstream.
3. **Update HTTP/2 interceptor** — inject `x-stigmer-auth` instead of replacing `authorization`
4. Rerun `TestAgentExecution_CursorUsage_FullPipeline` — verify billing records appear
5. Run `TestAgentExecution_Config_ModelOverride` — verify REST proxy still works
6. Remove diagnostic logging from interceptor (console.debug calls)
7. Deploy stigmer-cloud to prod (merge PRs or trigger CI)
8. Write final changelog entry

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

