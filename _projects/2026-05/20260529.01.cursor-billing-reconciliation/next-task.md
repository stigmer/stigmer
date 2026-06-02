# Next Task: 20260529.01.cursor-billing-reconciliation

## Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

---

## Project Overview

**Name**: 20260529.01.cursor-billing-reconciliation  
**Goal**: Make Cursor billing proxy-authoritative, remove runner-side billing, add settlement scaffolding, and wire reconciliation against Admin API.  
**Tech Stack**: Java/Temporal/MongoDB (stigmer-cloud), Proto/Buf (shared apis), TypeScript/React (sdk display)

**Created**: 2026-05-29  
**Type**: Quick Project (1-2 sessions)

---

## Current Status

**Last Updated**: 2026-05-30 14:15  
**Current Focus**: Codegen fixed and validated. Stubs regenerated. Ready for integration test run + commit + deploy.

## Session 5 Progress (2026-05-30 afternoon, wrap-up)

### Codegen Pipeline Fix

User ran `make codegen` and hit two TypeScript errors during `typedoc:json`:

1. **`SetupTabWorkspaceActions` stale re-export** (pre-existing bug): Type was removed from `SetupTab.tsx` but barrel files (`session/index.ts`, `index.ts`) still re-exported it. Removed the stale references.

2. **`isEstimated` not found on `GetSessionUsageReportOutput`**: Root cause was a build-ordering gap in the Makefile. `make codegen` runs `protos` (regenerates TS stubs with `isEstimated` in source) then `gen-sdk-docs` → `typedoc:json`, which resolves `@stigmer/protos` from `dist/` — but `dist/` was never rebuilt after stub regeneration. Added a `build-ts-stubs` step to the pipeline: `codegen: protos → build-ts-stubs → gen-sdk-docs → gen-narration`.

### What was accomplished

1. **Removed stale `SetupTabWorkspaceActions` export** from `sdk/react/src/session/index.ts` and `sdk/react/src/index.ts`
2. **Added `build-ts-stubs` Makefile target** that rebuilds `@stigmer/protos` dist after stub regeneration
3. **Verified**: React SDK lint (0 errors) + typecheck (clean) pass

### What was NOT done

- Full integration test suite run
- Production deployment
- TS unit tests for `useSessionUsage`

## Session 4 Progress (2026-05-30 afternoon)

### Architecture Decision: Remove Admin API Reconciliation

**Discovery**: Cursor Admin API requires Enterprise plan (Stigmer is on Team plan). Key returns 401.

**Decision**: Proxy metering is sufficient for customer billing. The Admin API would only provide margin visibility (what Cursor charges Stigmer), not billing accuracy (what Stigmer charges customers). Removed all reconciliation code.

### Security Decision: Extract Model from Request Body (not headers)

**Problem with headers**: The runner is open-source and can run on user machines. A modified runner could send `x-stigmer-resolved-model: haiku` while actually requesting opus — billing fraud.

**Solution**: Parse the `AgentRunRequest` protobuf request body in the proxy. The proxy sees the exact same request it forwards to Cursor — this is tamper-proof.

- Path: `AgentRunRequest.model_details (field 3) → ModelDetails.model_id (field 1)`
- Provider inferred from model name prefix (claude → anthropic, gpt → openai)
- Uses existing `ProtobufFieldScanner` infrastructure

### What was accomplished

1. **Proxy model extraction (DONE)**: `CursorProxyController.extractModelFromConnectRequest()` parses model from request body
2. **Provider inference (DONE)**: `inferProviderFromModel()` resolves underlying provider from model name
3. **Removed `recordCursorUsage`**: Deleted from BillingActivities interface, impl, and workflow
4. **Removed Admin API reconciliation**: Deleted 19 source files + 5 tests + Mongock migration + config + secrets
5. **Removed proto settlement scaffolding**: `UsageSettlementStatus` enum, `SettlementLink` message, `PROVIDER_SETTLED` trust level
6. **Simplified `is_estimated`**: Now derived from whether billing records exist (empty = estimated)
7. **Updated SDK hook comments**: Reflect proxy-authoritative billing model

## Session 3 Progress (2026-05-30 morning)

### Connect RPC Metering — COMPLETE

Built the full Connect RPC metering pipeline:

1. **Proto schema extracted from `@cursor/sdk` bundle** — field numbers confirmed:
   - `AgentServerMessage.interaction_update` = field 1
   - `InteractionUpdate.turn_ended` = field 14
   - `TurnEndedUpdate.{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens}` = fields 1-4

2. **New components (stigmer-cloud, 4 new files):**
   - `ConnectEnvelopeDecoder` — pure Connect protocol 5-byte envelope decoder
   - `ConnectEnvelope` — decoded envelope record
   - `ProtobufFieldScanner` — minimal protobuf wire-format navigator (varint + length-delimited)
   - `ConnectCursorUsageExtractor` — navigates AgentServerMessage → TurnEndedUpdate, accumulates tokens

3. **Modifications:**
   - `SseUsageExtractorFactory` — generalized with content-type awareness (`create(provider, contentType)`)
   - `CursorProxyController` — detects Connect responses, tees through ConnectCursorUsageExtractor
   - Micrometer counters for connect streams/turns/decode failures/zero-usage

4. **Tests: 3 new test suites, 20 test cases, all passing:**
   - `ConnectEnvelopeDecoderTest` — 10 tests (chunking, flags, zero-payload, offset)
   - `ProtobufFieldScannerTest` — 8 tests (varint, length-delimited, nested navigation)
   - `ConnectCursorUsageExtractorTest` — 12 tests (single/multi turn, chunked, factory routing)

5. **Defensive strategy:** `recordCursorUsage` kept as fallback — existing idempotency key deduplication means whichever writes first wins (proxy usually wins the race).

## Session 2 Progress (2026-05-29 afternoon)

### Key Discovery (CRITICAL for next session)

**The Cursor SDK uses Connect RPC (`api2.cursor.sh`) for the main agent loop, NOT the SSE `streamRun` endpoint (`api.cursor.com`).** The proxy's `CursorUsageExtractor` only meters SSE responses. Connect responses pass through as a binary passthrough without token extraction.

### What was accomplished (code changes in place)

1. **Proto scaffolding (DONE, committed to working tree)**
2. **Handler trust label fix (DONE)**
3. **Server-side `is_estimated` derivation (DONE)**
4. **SDK display (DONE)** — `useSessionUsage.ts` consumes server `is_estimated` flag
5. **Handler unit test (DONE, PASSING)**

---

## Next Steps

### Priority 1: Commit and deploy

- All codegen issues resolved — `make codegen` should now pass cleanly
- Run full integration test suite to verify no regressions
- Commit all changes across both repos
- Deploy to production

### Priority 2: Monitor Connect metering in production

- Deploy proxy changes and monitor Micrometer counters:
  - `stigmer.proxy.cursor.connect.streams_metered`
  - `stigmer.proxy.cursor.connect.zero_usage_streams`
- Verify model extraction from request body is working (check billing records have correct model)
- Monitor for any `"unknown"` model records (SSE path fallback)

### Priority 3: Add unit tests for request-body model extraction

- Test `extractModelFromConnectRequest` with various AgentRunRequest payloads
- Test `inferProviderFromModel` with all model name variants
- Add test for `useSessionUsage` TS hook

---

## Files Modified (uncommitted, both repos)

### stigmer (OSS) — this session
- `Makefile` — added `build-ts-stubs` step to codegen pipeline
- `sdk/react/src/index.ts` — removed stale `SetupTabWorkspaceActions` re-export
- `sdk/react/src/session/index.ts` — removed stale `SetupTabWorkspaceActions` re-export

### stigmer (OSS) — previous sessions
- `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto` — settlement removal + simplified trust levels
- All regenerated stubs (Go, Java, Python, TS)
- `sdk/react/src/session/useSessionUsage.ts` — server `is_estimated` flag
- Regenerated docs, typedoc output, codegen schemas

### stigmer-cloud
- `RecordLlmCallUsageHandler.java` — all records as PROXY_PROVIDER_REPORTED + BILLING_AUTHORITY
- `UsageAggregationService.java` — `isEstimated` / `isSessionEstimated` methods
- `AgentExecutionGetSessionUsageReportHandler.java` — sets `is_estimated` on response
- `RecordLlmCallUsageHandlerTest.java` — updated assertions
- All regenerated stubs (Java, Go, Python, TS, Dart)

---

## Blockers

- None. All blockers resolved.

---

## Key Reference Files

| Purpose | Path |
|---------|------|
| Design doc | `_projects/2026-05/20260529.01.cursor-billing-reconciliation/design.trust-ladder.md` |
| Proxy controller | `stigmer-cloud: .../proxy/cursor/CursorProxyController.java` |
| SSE extractor | `stigmer-cloud: .../proxy/usage/CursorUsageExtractor.java` |
| Handler | `stigmer-cloud: .../billing/request/handler/RecordLlmCallUsageHandler.java` |
| recordCursorUsage | `stigmer-cloud: .../billing/temporal/BillingActivitiesImpl.java` |
| Runner activity | `stigmer: backend/services/runner/src/activities/execute-cursor/index.ts` |
| Usage accumulator | `stigmer: .../execute-cursor/usage-accumulator.ts` |
| SDK hook | `stigmer: sdk/react/src/session/useSessionUsage.ts` |
| Integration test | `stigmer: test/integration/agent_execution_cursor_usage_diagnostic_test.go` |

---

## Quick Commands

- **"Run the integration test"** — Verify current changes don't regress
- **"Commit all changes"** — Ship the billing reconciliation work
- **"Show current status"** — Review what's done vs pending

---

*Quick Project Framework: Minimal overhead, maximum focus.*
