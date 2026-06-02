# Fix Cursor Variant Model Pricing Lookup

**Date**: June 1, 2026

## Summary

Added a model name normalization layer to the billing handler so that Cursor variant model IDs (like `claude-4.6-opus-high-thinking`) resolve to their base model's pricing in the registry. Previously, these variants produced `$0.00` cost because the wire name didn't match any registry entry.

## Problem Statement

Cursor embeds reasoning-effort and speed-mode configuration into model names reported in the Connect RPC response stream via `providerOptions.cursor.modelName`. The billing pipeline received names like `claude-4.6-opus-high-thinking` but the model registry has `claude-opus-4-6`. Two mismatches prevented lookup: (a) variant suffix `-high-thinking` and (b) segment order `claude-4.6-opus` vs `claude-opus-4-6`.

### Pain Points

- Agent executions using Cursor harness models showed `$0.00` cost in the Usage tab
- Billing records were inserted with `COST_CALCULATION_STATUS_PRICE_NOT_FOUND` and `isBillable = false`
- No credits were debited for real LLM usage, creating silent revenue loss
- The existing `requestedModel` fallback didn't help because `ConnectModelExtractor` usually returns null for Cursor auto-routed requests

## Solution

New `CursorModelNormalizer` utility in `proxy.cursor` package, consumed by `RecordLlmCallUsageHandler` as fallback steps 3-4 in the pricing lookup chain.

## Implementation Details

**`CursorModelNormalizer` (new, stigmer-cloud)**
- Static utility class (`final`, private ctor) following the `CursorModelResolver` pattern
- Strips known variant suffixes: `-high-thinking`, `-medium-thinking`, `-thinking-high`, `-high-fast`, `-medium`, `-fast`, etc.
- Reorders Anthropic model segments: `claude-{version}-{class}` → `claude-{class}-{version}` with dots replaced by hyphens
- Returns `NormalizationResult` record with base model ID, normalization flag, and stripped suffix
- Conservative: unknown patterns pass through unchanged

**`RecordLlmCallUsageHandler` (modified, stigmer-cloud)**
- Added normalization as fallback steps 3-4 after the existing exact-match and requestedModel fallback
- Provider inference: when input provider is `"cursor"` but normalized model is a claude/gpt model, retries with the inferred provider (`"anthropic"`, `"openai"`) via `CursorModelResolver.inferProviderFromModel()`
- Billing records preserve the original wire name in `resolvedModel` for audit trail
- Normalized matches are marked `COST_CALCULATION_STATUS_ESTIMATED`

**Design decision**: Normalization in the handler (not `ModelPricingService` or the proxy layer) preserves audit information and keeps the pricing service's exact-match contract clean.

## Benefits

- Cursor variant model names now resolve to correct pricing (e.g., `claude-4.6-opus-high-thinking` → $5/$25 per million from `claude-opus-4-6`)
- All known reasoning-effort variants (high/medium/low thinking) correctly match base model pricing
- Both segment-reordered (`claude-4.6-opus-*`) and standard-order (`claude-opus-4-8-*`) Cursor formats handled
- Original wire model names preserved in billing records for debugging and analytics

## Impact

- **Billing accuracy**: Agent executions using Cursor harness will now show correct non-zero costs
- **Revenue**: Credit debits will occur for previously unbilled LLM usage
- **Scope**: All Cursor harness model variants across Anthropic, OpenAI, and future providers

## Related Work

- BiDi proxy phase 2 (`20260531.01.cursor-bidi-proxy-phase2`) — built the proxy-authoritative billing pipeline this fix extends
- Runner-side model validation gap identified as follow-up: `resolveModelId()` in `model-pricing.ts` falls back to "default" for variant IDs

---

**Status**: ✅ Production Ready
**Repos**: stigmer-cloud (4 files: 2 new, 2 modified)
