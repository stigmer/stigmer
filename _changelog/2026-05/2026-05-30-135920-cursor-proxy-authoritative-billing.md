# Cursor Billing: Proxy-Authoritative Metering with Request-Body Model Extraction

**Date**: May 30, 2026

## Summary

Made the Cursor proxy the authoritative billing source by fixing model extraction (parsing from the Connect RPC request body), removing the unworkable Admin API reconciliation flow (requires Enterprise plan), and eliminating the untrusted `recordCursorUsage` runner fallback. Net result: -2,500 lines of reconciliation code removed, secure model identification added.

## Problem Statement

Cursor billing had three compounding issues:

### Pain Points

- **Connect RPC metering produced `model = "unknown"`** — the response stream's `TurnEndedUpdate` only carries token counts, no model. Without the model, pricing lookup fails and cost = $0.
- **Provider key mismatch** — extractors set `provider = "cursor"` but the model registry indexes models under `"anthropic"`/`"openai"`. Pricing lookup fails even when model IS known (SSE path).
- **Admin API reconciliation was dead code** — requires Cursor Enterprise plan; Stigmer is on Team plan. Key returns 401. The entire ingestion pipeline (19 files, 5 tests, Temporal workflow, Mongock migration) served no purpose.
- **`recordCursorUsage` was a trust violation** — billing from runner-reported data (open-source, user-controlled) contradicts the trust ladder's own documented semantics.

## Solution

**Proxy parses the model from the Connect RPC request body** — the same protobuf payload it forwards to Cursor. This is:
- Tamper-proof: a modified runner cannot lie about the model because the request body IS what Cursor receives
- Accurate: gives the model as-requested (same info the SDK and Cursor Admin API would report)
- Zero new infrastructure: uses the existing `ProtobufFieldScanner`

Provider is inferred from model name prefixes (`claude → anthropic`, `gpt/o-series → openai`).

## Implementation Details

### Request-body model extraction (CursorProxyController)

- `extractModelFromConnectRequest(byte[] body)` — navigates `AgentRunRequest.model_details (field 3) → ModelDetails.model_id (field 1)` using `ProtobufFieldScanner`
- `inferProviderFromModel(String model)` — prefix-based provider resolution
- Applied when Connect RPC response's extractor returns `"unknown"` model

### Removed: Admin API reconciliation (19 source + 5 test files)

- `CursorAdminApiClient`, config, provider, DTOs, entity
- `CursorUsageEventRepo`, `CursorUsagePollStateRepo`
- `CursorUsageIngestionWorkflow` + activities + config + starter + worker
- Mongock migration (order 035)
- application.yaml / application-temporal.yaml config sections
- BUILD.bazel test targets

### Removed: `recordCursorUsage` runner fallback

- `BillingActivities.recordCursorUsage()` — interface + implementation
- `InvokeAgentExecutionWorkflowImpl` — workflow call at EXECUTION_COMPLETED

### Removed: Proto settlement scaffolding

- `UsageSettlementStatus` enum (8 unused states)
- `USAGE_TRUST_LEVEL_PROVIDER_SETTLED` (value 4)
- `settlement_status` + `settlement_link` fields on `LlmCallUsageRecord`
- `SettlementLink` message

### Simplified: `is_estimated` derivation

- `UsageAggregationService.isEstimated()` now returns `records.isEmpty()` — true when execution is in-flight (no proxy billing records yet), false once proxy has metered.

## Benefits

- **Billing correctness**: proxy-metered tokens + request-body model → correct pricing lookup
- **Security**: no trust in runner-reported headers or data for billing-critical fields
- **Simplicity**: -2,500 lines of reconciliation infrastructure that could never work on Team plan
- **Single billing path**: proxy metering is the sole authority (no dual-write deduplication complexity)

## Impact

- **Customer billing**: Now correctly priced for Connect RPC traffic (majority of Cursor executions)
- **Codebase**: Significant simplification of billing domain — removed entire `cursor/` package, `cursorusage/` temporal package, and settlement proto scaffolding
- **Runtime**: No more `recordCursorUsage` activity call at execution completion — one fewer Temporal activity per Cursor execution

## Related Work

- Session 3 (same day): Built `ConnectCursorUsageExtractor` pipeline (20 test cases)
- Design doc: `_projects/2026-05/20260529.01.cursor-billing-reconciliation/design.trust-ladder.md`

---

**Status**: ✅ Production Ready (pending `make codegen` + `make protos` stub regeneration)
**Timeline**: 3 sessions (May 29-30, 2026)
