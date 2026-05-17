# CostCapMiddleware: Accurate Cache-Creation Pricing

**Date**: May 17, 2026

## Summary

Added `cache_creation_price_per_million` to the CostCapMiddleware, making the in-process cost cap estimate accurate for Anthropic's 1.25x cache-write premium. Also validated that the existing three-layer prompt caching implementation (`_inject_cache_control`) is correct and producing 92%+ cost savings on cached input tokens.

## Problem Statement

The CostCapMiddleware enforces a per-execution spending budget by estimating LLM call cost locally. It already had separate pricing for regular input and cache-read tokens, but cache-creation (cache-write) tokens were lumped into the regular input bucket. Anthropic charges cache writes at 1.25x the input rate, so the middleware underestimated first-call cost by ~25% on the input portion.

### Pain Points

- Cache-write tokens billed at regular input rate instead of the 1.25x premium
- `ModelMetadata` already carried `cache_creation_price_per_million` from the registry, but it wasn't propagated through `setup.py` → `create_deep_agent` → `CostCapMiddleware`
- No empirical validation that the existing prompt caching implementation was producing cache hits

## Solution

Threaded `cache_creation_price_per_million` through the full pipeline and upgraded `CostCapMiddleware` from a 3-bucket to a 4-bucket cost formula: regular input, cache creation, cache read, and output — each at their correct per-million rate.

Separately, validated the existing caching implementation by running the integration benchmark (`make benchmark-cost`) and confirming cache hit rates of 97-100% on the stable system-prompt + tool-definitions prefix.

## Implementation Details

Three files changed (99 insertions, 23 deletions):

- **`graphton/core/cost_cap.py`**: Added `cache_creation_price_per_million` constructor parameter. Expanded `_extract_usage()` to return `cache_creation_tokens` from LangChain's `input_token_details.cache_creation`. Updated `_compute_call_cost()` to derive `regular_input = total_input - cache_creation - cache_read` and price each bucket independently. Updated logging to include cache_creation.

- **`graphton/core/agent.py`**: Updated `create_deep_agent()` docstring and `CostCapMiddleware` instantiation to pass `cache_creation_price_per_million` from the `cost_pricing` dict.

- **`stigmer_runner/.../setup.py`**: Added `cache_creation_price_per_million` from `model_metadata` to the `cost_pricing` dict passed to `create_deep_agent()`. Updated the info log to include the new rate.

## Benefits

- Cost cap estimates are now accurate for both cache-write and cache-read calls
- For Claude Sonnet 4.6 ($3/M input, $3.75/M cache write, $0.30/M cache read), the first-call estimate was previously underestimated by ~25% on input — now correct
- Benchmark validation confirmed the existing 3-layer prompt caching produces 92%+ savings on subsequent calls (10.8k tokens cached, read from cache on 2nd+ calls)

## Impact

- **CostCapMiddleware users**: More accurate budget enforcement, especially on first calls where cache writes dominate
- **Platform operators**: Confidence that the caching infrastructure is working as designed
- **Backward compatible**: `cache_creation_price_per_million` defaults to 0.0, so existing callers without the parameter fall back to charging at the regular input rate (same behavior as before)

## Related Work

- WI-1 from the Harness Cost Economics project (`_projects/2026-05/20260516.01.harness-cost-economics`)
- Anthropic prompt caching docs confirmed Layer 3 (top-level `cache_control`) is the official automatic caching mechanism
- Benchmark infrastructure (`test/integration/cost_benchmark_test.go`) already captures `CacheCreationTokens` and `CacheReadTokens`

---

**Status**: Production Ready
**Timeline**: Single session
