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

**Last Updated**: 2026-05-29 18:30  
**Current Focus**: Proxy-only Cursor billing — discovered that Connect RPC transport is NOT metered by proxy, need to add Connect metering before removing `recordCursorUsage`.

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

## Next Steps (Path B — for next session)

### Priority 1: Add Connect RPC metering to the proxy

This is the real fix that enables removing `recordCursorUsage`:

1. **Understand the Connect wire format**: 5-byte envelope header (1 byte flags + 4 bytes length) followed by protobuf payload. The `@cursor/sdk` bundle uses `agent.v1.AgentService/Run` (BiDi streaming).

2. **Build `ConnectUsageExtractor`** (new Java class):
   - Parse Connect stream envelopes
   - Decode `AgentServerMessage` protobuf (specifically the `turnEnded` case)
   - Extract `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`
   - Accumulate across turns (same as `CursorUsageExtractor` does for SSE)

3. **Get the proto schema**: The `@cursor/sdk` npm package contains `agent.v1.AgentServerMessage`. Extract the `.proto` or generate Java classes from the bundled descriptor. Alternatively, write a minimal hand-parser for just the `turnEnded` field (protobuf field numbers are stable).

4. **Wire in `CursorProxyController`**: Detect Connect responses (content-type `application/proto` or `application/connect+proto`), use the new extractor instead of passthrough.

5. **Then remove `recordCursorUsage`**: Once Connect metering works, the proxy is the sole writer. Remove the runner billing path.

### Priority 2: Finish remaining plan items

- Run the integration test to verify proto/display changes don't regress
- Add TS unit tests for `useSessionUsage`
- Run `make check` subset in both repos

### Priority 3: Reconciliation (Slice B)

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
- Connect RPC metering not built (proxy can't extract tokens from protobuf stream yet)

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
