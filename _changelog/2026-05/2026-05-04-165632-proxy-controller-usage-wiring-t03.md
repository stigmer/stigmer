# Wire SSE Usage Parser into LlmProxyController (T03)

**Date**: May 4, 2026

## Summary

Connected the T01 SSE usage parser and T02 updateUsage billing handler into the live LLM proxy data path, completing the critical integration that makes proxy-side billing metering operational. This required a compatibility audit of T01 code against the research-driven T02 architecture, expanding the parser to capture all provider usage fields, and wiring the full metering pipeline into LlmProxyController with zero impact on the LLM response stream.

## Problem Statement

The SSE usage parser (T01) and the billing metering handler (T02) existed as isolated components with no runtime connection. The proxy controller still did a naive `inputStream.transferTo(outputStream)` with no usage extraction or billing. Additionally, the T01 parser was written before the architecture revision driven by the deep research phase, leaving compatibility gaps.

### Pain Points

- T01 `ParsedLlmUsage` captured only 4 token fields as `int`, missing `total_tokens`, `reasoning_tokens`, cached tokens, `finish_reason`, and raw usage JSON
- OpenAI's reasoning tokens (o-series) and prompt cache hits were not captured
- Anthropic's `stop_reason` was ignored
- No raw provider usage JSON preservation for audit (research strongly recommended this)
- `ModelPricingService` and `BillingMicros` took `int` parameters while the proto used `int64`
- The proxy had no `requested_model` tracking for the audit trail
- OpenAI streaming requires explicit `stream_options.include_usage` injection to get final usage

## Solution

A three-phase approach: (1) audit and upgrade T01 parser to match T02 contract, (2) fix T02 type mismatches and add proto field, (3) wire the full pipeline into the proxy controller.

## Implementation Details

### Phase 1: Parser Compatibility Upgrade

**`ParsedLlmUsage`** expanded from 6 fields (`int`) to 11 fields (`long`): `totalTokens`, `reasoningTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `finishReason`, `complete`, `providerUsageJson`.

**`OpenAiUsageExtractor`** now extracts `total_tokens`, `completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens`, `finish_reason` (tracked across SSE events since it appears on a separate chunk from usage), and raw usage JSON.

**`AnthropicUsageExtractor`** now extracts `stop_reason` from `message_delta.delta`, preserves raw usage JSON from both `message_start` and `message_delta`, and signals completeness via `messageStartSeen && messageDeltaSeen`.

### Phase 2: T02 Type Fixes

Widened `BillingMicros.tokenCost()`, `ModelPricingService.computeProviderCostMicros()`, and `ExecutionBillingService.reportLlmCallUsage()` from `int` to `long` token parameters. Added `requested_model` field to `UpdateUsageInput` proto and handler.

### Phase 3: Proxy Controller Wiring

**`LlmProxyController`** rewritten with:
- Tee stream loop replacing `transferTo` — each byte chunk written to runner AND fed to extractor
- `stream_options` injection for OpenAI (ensures provider reports final usage in SSE)
- Request body parsing to extract `requested_model` for the audit trail
- `ProxyTiming` capture: 5 timestamps (received, upstream start, first byte, last byte, completed) + derived durations
- Provider request-id extraction from response headers (`x-request-id` / `request-id`)

**`ProxyUsageReporter`** (new): Bridges `ParsedLlmUsage` + proxy context to the billing pipeline. Builds `LlmCallUsageRecord`, inserts via repo, debits billing, updates execution aggregate. All exceptions caught and logged.

**`ProxyCallSequencer`** (new): Per-execution atomic sequence counter with 2-hour TTL eviction.

### Cardinal Error Handling Rule

Usage extraction and reporting never break the LLM response stream. All billing work runs in a `finally` block wrapped in `try-catch`. The proxy's primary job is relaying bytes; billing is secondary.

## Benefits

- Proxy-observed billing is now live: tampered runners cannot fake zero-token usage
- Full audit trail: `requested_model` vs `resolved_model`, provider request IDs, raw usage JSON
- Rich token capture: reasoning tokens (o-series), cached tokens (OpenAI + Anthropic), provider-reported totals
- `ProxyTiming` gives trusted TTFB/TTLB/stream duration for provider SLO monitoring
- Zero regression risk: the tee loop is strictly additive to the existing streaming path

## Impact

- **Billing accuracy**: Cloud-mode billing now uses proxy-observed provider usage instead of runner-attested data
- **Audit compliance**: Raw provider JSON, pricing snapshots, and model resolution audit trail stored per call
- **Observability**: Proxy timing metrics enable provider latency dashboards and anomaly detection
- **Future-proof**: Reasoning tokens, cached tokens, and multimodal token fields ready for new model families

## Related Work

- T01: SSE Usage Parser (`7f0882b5` on stigmer-cloud, `14ac70c41` on stigmer)
- T02: updateUsage RPC + Per-Call Usage Records (`45da500c` on stigmer-cloud)
- Research: `research.llm-usage-capture-model/04.report.gpt.md` (1681-line competitive analysis)
- Next: T04 (CursorProxyController wiring), T05 (strip runner llm_metrics + billing signal)

---

**Status**: Production Ready (pending stub regeneration after proto lands)
**Timeline**: 1 session (~45 minutes implementation)
