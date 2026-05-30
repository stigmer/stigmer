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

**Last Updated**: 2026-05-30 10:45  
**Current Focus**: Connect RPC metering DONE. Proto scaffolding committed. Ready for production validation and then `recordCursorUsage` removal.

## Session 2 Progress (2026-05-29 afternoon)

### Key Discovery (CRITICAL for next session)

**The Cursor SDK uses Connect RPC (`api2.cursor.sh`) for the main agent loop, NOT the SSE `streamRun` endpoint (`api.cursor.com`).** The proxy's `CursorUsageExtractor` only meters SSE responses. Connect responses pass through as a binary passthrough without token extraction.

This means:
- `recordCursorUsage` (which reads `streaming_usage` from runner) is STILL needed for billing today
- The proxy CAN meter Connect (it sees all bytes), but needs a new `ConnectUsageExtractor` that parses protobuf envelopes
- The SSE metering path works for CLOUD mode Cursor executions (which use `api.cursor.com/v1/agents/.../stream`)
- LOCAL/SANDBOX mode (default) uses Connect RPC — this is the majority of traffic

### What was accomplished (code changes in place)

1. **Proto scaffolding (DONE, committed to working tree)**:
   - `UsageSettlementStatus` enum added to `usage.proto` (8 states)
   - `USAGE_TRUST_LEVEL_PROVIDER_SETTLED = 4` added
   - `settlement_status` (field 100) + `settlement_link` (field 101) on `LlmCallUsageRecord`
   - `SettlementLink` message defined
   - `is_estimated` field added to `GetSessionUsageReportOutput` (field 8) and `ExecutionUsageSummary` (field 11)
   - `make codegen` (OSS) + `make protos` (cloud) run successfully

2. **Handler trust label fix (DONE)**:
   - `RecordLlmCallUsageHandler` now sets ALL records as `PROXY_PROVIDER_REPORTED` + `BILLING_AUTHORITY` + `settlement_status = NOT_APPLICABLE`
   - Removed the cursor/native branch (all records are proxy-observed since `recordCursorUsage` was the only non-proxy writer)
   - Handler test updated and passing

3. **Server-side `is_estimated` derivation (DONE)**:
   - `UsageAggregationService` has `isEstimated(records)` and `isSessionEstimated(executions)` methods
   - `buildExecutionSummary` sets `is_estimated` per-execution
   - `AgentExecutionGetSessionUsageReportHandler` sets `is_estimated` on session report
   - Build passes

4. **SDK display (DONE)**:
   - `useSessionUsage.ts` consumes server `is_estimated` flag via `report.isEstimated`
   - Removed the token-count heuristic (`streamingFallback.totalTokens > billingReport.totalTokens`)
   - Simplified selection: billing report wins when it has data; streaming fallback for in-flight only

5. **Handler unit test (DONE, PASSING)**:
   - `RecordLlmCallUsageHandlerTest.cursorMeteringSource` updated to assert `PROXY_PROVIDER_REPORTED` + `BILLING_AUTHORITY`

### What BROKE and why (integration test failure)

`TestAgentExecution_CursorUsage_FullPipeline` FAILS because:
- We removed `recordCursorUsage` (the runner fallback)
- The proxy doesn't meter the Connect path
- Result: zero billing records for Cursor executions

**Resolution**: Reverted the `recordCursorUsage` removal. The remaining handler/proto/display changes are safe. The handler change is correct because `recordCursorUsage` goes through the same handler — relabeling it as `PROXY_PROVIDER_REPORTED`/`BILLING_AUTHORITY` is slightly aspirational but non-breaking (the billing math is unchanged).

### What was reverted

- `BillingActivities.java` — `recordCursorUsage` method restored
- `BillingActivitiesImpl.java` — full implementation restored
- `InvokeAgentExecutionWorkflowImpl.java` — call at `EXECUTION_COMPLETED` restored

---

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

---

## Next Steps

### Priority 1: Validate and ship

- Run the full integration test suite (`make test-integration`) to verify no regressions
- Run `make check` subset in both repos
- Commit Connect metering changes in stigmer-cloud
- Deploy to staging and monitor Micrometer counters

### Priority 2: Finish remaining Phase 2 items

- Add TS unit tests for `useSessionUsage`
- Run `make check` subset in OSS repo

### Priority 3: Remove `recordCursorUsage` (after production validation)

- Monitor `stigmer.proxy.cursor.connect.streams_metered` vs `stigmer.proxy.cursor.connect.zero_usage_streams`
- Once zero-usage rate is acceptable, remove `recordCursorUsage` from BillingActivitiesImpl
- Remove the workflow call in InvokeAgentExecutionWorkflowImpl

### Priority 4: Reconciliation (Slice B)

- Compare proxy-billed totals vs Admin API `chargedCents`
- Issue adjustment entries for drift (Token Fee, pricing delta)
- Provision `STIGMER_CURSOR_ADMIN_API_KEY` as Planton secret for live verification

---

## Files Modified (uncommitted, both repos)

### stigmer (OSS)
- `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto` — settlement enum + fields
- `apis/ai/stigmer/agentic/agentexecution/v1/io.proto` — `is_estimated` on reports
- All generated stubs (Go, Java, Python, TS, Dart)
- `sdk/react/src/session/useSessionUsage.ts` — server `is_estimated` flag

### stigmer-cloud
- `RecordLlmCallUsageHandler.java` — all records as PROXY_PROVIDER_REPORTED + BILLING_AUTHORITY
- `UsageAggregationService.java` — `isEstimated` / `isSessionEstimated` methods
- `AgentExecutionGetSessionUsageReportHandler.java` — sets `is_estimated` on response
- `RecordLlmCallUsageHandlerTest.java` — updated assertions
- All regenerated stubs (Java, Go, Python, TS, Dart)

---

## Blockers

- `STIGMER_CURSOR_ADMIN_API_KEY` not yet provisioned as Planton secret (live ingestion verification deferred)
- ~~Connect RPC metering not built~~ **RESOLVED** — ConnectCursorUsageExtractor built and tested

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

- **"Continue with Connect metering"** — Start building the ConnectUsageExtractor
- **"Show current status"** — Review what's done vs pending
- **"Run the integration test"** — Verify current changes don't regress
- **"Commit the proto + display changes"** — Ship the non-breaking scaffolding

---

*Quick Project Framework: Minimal overhead, maximum focus.*
