# Model Registry Refresh: Add GPT-5.1 via Cursor Proxy

**Date**: May 1, 2026

## Summary

Ran the periodic model registry refresh workflow against live sources (Cursor pricing page, Cursor model catalog API via Stigmer proxy, Anthropic/OpenAI provider pricing). Cross-referenced 27 proxy models against the pricing page, confirmed all existing pricing is current, and added the new `gpt-5.1` model.

## Problem Statement

The unified model registry at `backend/libs/model-registry.json` must stay current with the models available through the Cursor proxy. A new model (`gpt-5.1`) appeared in the proxy catalog without a corresponding registry entry, meaning it would fall back to "default" pricing for cost tracking.

### Pain Points

- `gpt-5.1` available in proxy but missing from registry — cost tracking would use Auto fallback pricing instead of the model's actual rate
- `gpt-5.3-codex-spark` also appeared in the proxy but has no published pricing yet

## Solution

Executed the `@update-model-registry` workflow end-to-end:

1. Fetched Cursor pricing page (`cursor.com/docs/models-and-pricing.md`)
2. Fetched Cursor model catalog via Stigmer proxy (27 models)
3. Fetched Anthropic and OpenAI provider pricing pages
4. Cross-referenced all sources — no pricing changes for any existing model
5. Added `gpt-5.1` at $1.25 input / $0.125 cache read / $10 output (matching the GPT-5.1 Codex tier, consistent with the pattern where base and Codex variants share pricing)
6. Skipped `gpt-5.3-codex-spark` — no published pricing available; will add in next refresh

## Implementation Details

Single JSON entry added to `backend/libs/model-registry.json` in the OpenAI cursor harness section:

```json
{
  "id": "gpt-5.1",
  "displayName": "GPT-5.1",
  "provider": "openai",
  "harness": "cursor",
  "costTier": "standard",
  "featured": false,
  "pricing": {
    "inputPricePerMillion": 1.25,
    "outputPricePerMillion": 10.0,
    "cacheWritePricePerMillion": 0,
    "cacheReadPricePerMillion": 0.125
  }
}
```

Pricing rationale: OpenAI base and Codex variants consistently share the same pricing tier (GPT-5 = GPT-5-Codex = $1.25/$10, GPT-5.2 = GPT-5.2 Codex = $1.75/$14). GPT-5.1 Codex is listed at $1.25/$10 on the Cursor pricing page, so GPT-5.1 base follows the same rate.

## Benefits

- Accurate cost tracking for `gpt-5.1` sessions (previously falling back to Auto pricing)
- Registry now covers 48 models (8 native Anthropic, 7 native OpenAI, 7 Ollama, 26 Cursor)
- All consumers (`cursor-runner`, `sdk/react`, `graphton`) pick up the new model automatically

## Impact

- **cursor-runner**: Can now resolve and price `gpt-5.1` correctly (154 tests pass)
- **React SDK**: Model picker includes `gpt-5.1` (typecheck clean)
- **graphton**: Native harness unchanged

## Related Work

- `2026-05-01-183214-unified-model-registry.md` — Established the unified registry this refresh updates
- `2026-05-01-170717-automated-cursor-pricing-codegen-pipeline.md` — Previous pricing automation work

---

**Status**: ✅ Production Ready
