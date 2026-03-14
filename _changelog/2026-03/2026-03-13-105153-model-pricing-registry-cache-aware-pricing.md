# Model Pricing Registry: Cache-Aware Pricing Fields

**Date**: March 13, 2026

## Summary

Extended the Model Registry with cache-aware pricing fields and fixed a misleading unit mislabeling in the existing pricing fields. `ModelMetadata` now carries 4 per-million pricing rates (input, output, cache creation, cache read) that map directly to the proto `ModelUsage` fields with zero conversion, enabling accurate per-execution cost calculation in Phase 3.

## Problem Statement

The `UsageMetrics` proto schema (Phase 1) added `ModelUsage` with pricing fields (`input_price_per_million`, `cache_creation_price_per_million`, etc.) to enable per-execution cost reporting. But the Model Registry — the source of truth for all model metadata — had no cache pricing data and used a misleading field name (`input_cost_per_1k`) that stored per-million values. Phase 3 would need to stamp pricing from the registry onto proto messages, and the naming mismatch was a conversion bug waiting to happen.

### Pain Points

- `ModelMetadata.input_cost_per_1k = 3.0` stored $3/MTok pricing but the field name suggested $3/1K tokens — off by 1000x. Any developer multiplying by 1000 to "convert per-1K to per-million" would produce $3000/MTok.
- No cache pricing data existed. Provider prompt caching (Anthropic: up to 90% savings on repeated prefixes, OpenAI: 50% savings) requires different rates for cache writes vs cache reads.
- The Python field names didn't match the proto field names, requiring mental mapping during Phase 3 integration.

## Solution

Extended `ModelMetadata` with 2 new cache pricing fields and renamed the 2 existing pricing fields to match the proto convention. All 22 registered models now carry complete pricing data for 4 token types.

## Implementation Details

**Field rename** (36 occurrences across the file):
- `input_cost_per_1k` → `input_price_per_million`
- `output_cost_per_1k` → `output_price_per_million`

**New fields** on `ModelMetadata`:
- `cache_creation_price_per_million: float | None` — cost to write tokens to provider cache
- `cache_read_price_per_million: float | None` — cost to read tokens from provider cache

**Pricing data populated**:
- 8 Anthropic models: cache creation = 1.25x input (5-minute ephemeral TTL), cache read = 0.1x input (90% discount)
- 7 OpenAI models: cache creation = 1x input (automatic, no write premium), cache read = 0.5x input (50% discount)
- 7 Ollama models: `None` (local, no cost, no provider caching)

**Key design decision**: Anthropic offers two cache TTLs with different write costs (5-min at 1.25x, 1-hour at 2.0x). We store the 5-minute ephemeral pricing since that's the standard `cache_control: {"type": "ephemeral"}` mode that Phase 4 will implement.

**Tests**: 9 new tests in `TestCachePricing` class verifying provider multiplier rules, spot-check values, and default behavior.

**Documentation**: Updated `adding-new-models.md` with renamed fields, cache pricing reference section, PR checklist additions, and 2 new common mistakes.

## Benefits

- **Zero-conversion stamping**: `ModelMetadata.input_price_per_million` maps directly to `ModelUsage.input_price_per_million` — same name, same unit
- **Complete cost calculation**: All 4 token types (input, output, cache write, cache read) now have pricing data
- **Self-documenting**: Explicit per-model cache prices instead of derived multipliers
- **Bug prevention**: Fixed the `per_1k` naming footgun before Phase 3 builds on it

## Impact

- **Model Registry** (`model_registry.py`): 22 model entries enriched with cache pricing
- **Tests** (`test_model_registry.py`): 9 new tests, all existing tests updated for rename
- **Engineering docs** (`adding-new-models.md`): Cache pricing reference added for new model onboarding
- **Phase 3 unblocked**: Agent-runner can now look up complete pricing at execution time

## Related Work

- Phase 1: Schema Foundation (proto changes) — `2026-03-13-102447-usage-metrics-schema-foundation.md`
- Phase 3 (next): Agent-runner populates `UsageMetrics` from LangChain events using these pricing rates
- Phase 4 (future): Agent-runner enables Anthropic prompt caching with `cache_control` breakpoints

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2 of usage-metrics-cost-optimization project
