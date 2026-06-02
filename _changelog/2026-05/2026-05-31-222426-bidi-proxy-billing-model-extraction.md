# BiDi Proxy Billing: Model Extraction from Cursor Response Stream

**Date**: May 31, 2026

## Summary

Fixed the BiDi proxy billing pipeline so that provider cost and billable cost are correctly computed for Cursor agent executions. The root cause was threefold: Cursor auto-selects models server-side (no model in the request protobuf), sends empty Connect RPC end-of-stream trailers (`{}`), and embeds the actual model name inside JSON strings within protobuf response envelopes. A wire-level investigation discovered the model at `providerOptions.cursor.modelName` and a regex scanner now extracts it from response data.

## Problem Statement

After sessions 8–10 fixed BiDi proxy authentication and the agent stream completed successfully, the billing pipeline still reported `provider_cost=0` and `billable_cost=0` despite correct token counts (streaming and billing matched at ratio=1.00).

### Pain Points

- `ConnectCursorUsageExtractor` hardcoded `model="unknown"` — no model extraction from response
- `ConnectModelExtractor` failed to extract model from request because Cursor's `AgentRunRequest` does not include a `model_details` field (model is auto-routed server-side)
- `ConnectModelExtractor` also couldn't handle gzip-compressed request envelopes
- End-of-stream trailer was skipped entirely (returned early) instead of being parsed
- `CursorModelResolver.inferProviderFromModel()` didn't recognize `"composer"` prefix
- `composer-2.5-fast` (Cursor's auto-routing default model) was missing from the model pricing registry
- Billing handler logged `Model not found in registry: resolved=unknown, requested=, provider=cursor` → pricing lookup failed → cost=0

## Solution

Three-pronged approach, informed by wire-level diagnostics:

1. **Model extraction from response envelope payloads** — Cursor embeds the actual model used in `providerOptions.cursor.modelName` within JSON strings inside protobuf response message fields. A regex scanner (`"modelName"\s*:\s*"([^"]+)"`) finds this on the first matching envelope.

2. **Fallback model extraction from Connect trailers and request** — End-of-stream trailers are now parsed for metadata-based model keys (future-proofing). Request model extraction now handles gzip-compressed envelopes.

3. **Pricing registry and resolver updates** — Added `composer-2.5-fast` to the model registry and `"composer"` prefix → `"cursor"` provider mapping.

## Implementation Details

### ConnectCursorUsageExtractor (stigmer-cloud)

- Added `scanForModelName()`: scans decoded envelope payload bytes for `"modelName":"<value>"` using regex on ISO-8859-1 interpretation (safe for embedded JSON in protobuf binary)
- Added `extractFromTrailer()`: parses end-of-stream JSON trailers for model metadata keys (`x-cursor-model`, `x-model`, etc.) with fuzzy fallback to any key containing "model"
- Trailer model overrides providerOptions model (more authoritative when present)
- `finish()` now returns the extracted model instead of hardcoded `"unknown"`

### ConnectModelExtractor (stigmer-cloud)

- Added gzip decompression support for compressed request envelopes (mirrors the pattern in `ConnectCursorUsageExtractor`)
- Fixed pre-existing bug: added `if (done) return` guard in `onFirstEnvelope()` callback to prevent second-envelope overwrite when the decoder dispatches multiple envelopes from a single `decode()` call

### CursorModelResolver (stigmer-cloud)

- Added `"composer"` prefix → `"cursor"` provider mapping

### model-registry.json (stigmer-cloud)

- Added `composer-2.5-fast` entry with pricing matching `composer-2` rates ($0.50/$2.50 per million input/output tokens)

### Test Coverage

- `ConnectCursorUsageExtractorTest`: 10 new tests covering trailer metadata extraction (5 key variants + empty/malformed), providerOptions model scanning (first-occurrence, precedence), and trailer-override behavior
- `ConnectModelExtractorTest`: 1 new test for gzip-compressed request envelope extraction; renamed existing compressed-envelope test for clarity

## Benefits

- Billing records now have correct model identity (`composer-2.5-fast`) instead of `"unknown"`
- Provider cost and billable cost are computed ($5,555 / $6,111 micros in test) instead of $0
- Token cross-reference still perfect: `streaming_total=10271 billing_total=10271 ratio=1.00`
- Future Cursor model variants (composer-3, etc.) will be extracted automatically via the providerOptions scan
- If Cursor adds trailer metadata in the future, the trailer parser will pick it up without code changes

## Impact

- **Billing accuracy**: All Cursor BiDi proxy executions now have correct cost attribution
- **Integration test**: `TestAgentExecution_CursorUsage_FullPipeline` passes fully for the first time
- **Deploy readiness**: The BiDi proxy billing pipeline is end-to-end complete (auth ✓, tokens ✓, model ✓, cost ✓)

## Investigation Method

Wire-level diagnostics drove every fix:
1. Added INFO-level logging to `onEnvelope()` → discovered 20 envelopes processed, trailer = `{}`
2. Added hex dump of first request envelope → discovered `model_details` field absent
3. Added ASCII string scanner across all response envelopes → found `"modelName":"composer-2.5-fast"` in `providerOptions.cursor.modelName` inside envelope #13
4. Each diagnostic round: rebuild fat JAR → run integration test → read service log → remove diagnostics

## Related Work

- [BiDi proxy auth forwarding fix](2026-05-31-215123-bidi-proxy-auth-forwarding-fix.md) — session 10 (prerequisite)
- [BiDi proxy REFUSED_STREAM diagnosis](2026-05-31-213014-bidi-proxy-refused-stream-diagnosis.md) — session 9
- [HTTP/2 interceptor ESM namespace fix](2026-05-31-202438-http2-interceptor-esm-namespace-fix.md) — session 7

---

**Status**: ✅ Production Ready
**Timeline**: Session 11 (~1.5 hours), building on 10 prior sessions
