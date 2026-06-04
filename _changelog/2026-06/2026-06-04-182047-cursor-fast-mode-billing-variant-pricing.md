# Cursor Fast-Mode Billing: Speed-Variant Pricing

**Date**: June 4, 2026

## Summary

Made Cursor "fast" mode a first-class pricing concept so fast-tier usage is billed at Cursor's actual fast rates instead of the standard rate. Previously, when a user selected the default/auto Cursor harness, Cursor routed to `composer-2.5-fast` and the billing pipeline priced it at the standard Composer rate ($0.5/$2.5 per million) — roughly a 6x undercharge versus Cursor's published fast rate ($3/$15). Fast pricing now lives on the base model entry under a new `pricingVariants` block, the billing engine resolves wire names like `composer-2.5-fast` to base + variant rates, and a guard refuses to bill a fast call at the base rate if its fast price is missing.

## Problem Statement

Cursor's Auto/Composer pool defaults to the **fast** variant of Composer 2.5, which Cursor charges at a materially higher per-token rate than the standard tier. Cursor documents this only on the model doc page, not the main pricing table. Our registry carried a separate `composer-2.5-fast` entry whose prices were mistakenly copied from standard Composer, so every fast call was billed at ~1/6th of the real input/output rate.

The same class of bug existed for any Cursor `-fast` wire name: the variant-normalization fallback stripped `-fast` and silently billed the base (normal) price, which would undercharge Anthropic/OpenAI fast modes too.

### Pain Points

- Composer 2.5 fast usage billed at standard rates — the reported `$0.0925` vs Cursor's `$0.26` gap
- A duplicate `composer-2.5-fast` registry entry with wrong (copied-standard) pricing
- `-fast` speed suffixes silently stripped to the base price — a quiet undercharge with no signal
- No single "fast multiplier" exists across providers (Composer fast is 6x input/output but unchanged cache; GPT-5 fast is 2x; Opus fast is 6x on all buckets), so fast pricing must be explicit per-model data, never a formula

## Solution

One base model entry with an optional `pricingVariants` block keyed by speed mode. Billing decomposes the wire model into `(base, variant)` and applies the variant's rates. The duplicate `composer-2.5-fast` entry is removed; the wire name now resolves through the base model's fast variant.

## Implementation Details

**stigmer-cloud (authoritative billing)**

- `model-registry.json` — added `pricingVariants.fast` to `composer-2.5` (`$3/$15`, cache unchanged, with `wireIds: ["composer-2.5-fast"]`) and to the two fully-published Anthropic fast rows (`claude-opus-4-6`, `claude-opus-4-7`). Removed the standalone `composer-2.5-fast` entry. Each variant records `source`/`sourceNote` provenance.
- `ModelPricingService` — loads variants into harness-aware indexes plus a wire-id index; new `findVariant`, `findVariantByWireId`, and `ModelPricing.withVariantRates`. The flat `ModelPricing` record shape is preserved so existing call sites are unaffected.
- New `CursorModelPricingResolver` — ordered resolution: exact base id → explicit variant wire id → normalized base + suffix. Speed suffixes get fast-tier rates; effort suffixes (`-high`, `-thinking`) keep base rates. A fast variant with no fast pricing returns a distinct missing-variant outcome.
- `CursorModelNormalizer` — `composer-*` is no longer short-circuited, so `composer-2.5-fast` decomposes to `composer-2.5` + `fast`; added an `isSpeedVariant` classifier (speed vs. price-neutral effort).
- `RecordLlmCallUsageHandler` — uses the resolver, stamps `pricing_variant`/`pricing_base_model` audit labels, and on a missing fast price records `PRICE_NOT_FOUND` (not billable) with a loud error rather than undercharging.
- `update-model-registry.mdc` — new Step 1b (extract fast pricing from the three doc shapes), variant coverage check, revised variant-id guidance, and `pricingVariants` schema docs.

**stigmer (OSS)**

- `execute-cursor/model-pricing.ts` + `model-pricing-data.ts` (runner) — the in-session cost preview now mirrors base + variant resolution so a `composer-2.5-fast` estimate matches the authoritative cloud bill instead of falling back to Auto-pool defaults.
- `workflow/validation` — the workflow model registry and validator now accept the base `composer-2.5` slug (the requestable model) rather than the internal `composer-2.5-fast` wire name; Go and Java validation tests updated to match.

**Anti-undercharge guard (key design decision)**: a detected speed variant with no `pricingVariants.fast` is never silently billed at the base rate. It is recorded as `PRICE_NOT_FOUND`/not-billable and logged loudly, so a missing fast price surfaces as unbilled usage rather than quiet revenue loss.

## Benefits

- Composer 2.5 fast now reconstructs to ~`$0.284` on the reported token shape (was ~`$0.084` at the standard rate), closing the undercharge gap
- Fast pricing is explicit, sourced, and maintainable per model — no formula guessing
- Runner display estimate and authoritative cloud billing stay consistent
- Future `-fast` models cannot silently undercharge; missing prices are loud

## Impact

- **Billing accuracy**: fast-mode Cursor usage (today: the Auto/Composer default) is billed at the correct rate
- **Scope**: all Cursor-harness speed variants; fast pricing populated for models the platform dispatches today (Composer 2.5, Opus 4.6/4.7)
- **No selector change**: `-fast` is billing-only; the model selector continues to expose base models only

## Out of Scope (documented, not half-implemented)

- Max Mode surcharge (applies to legacy request-based plans; current Teams plan bills Max at API rate — no surcharge to model)
- Long-context 2x multipliers, image-output tokens, regional surcharges, Premium-pool routing
- Cursor Admin API `chargedCents` reconciliation
- Retroactive correction of historical `llm_call_usage_record` rows

## Related Work

- [Fix Cursor Variant Model Pricing Lookup](2026-06-01-183928-fix-cursor-variant-model-pricing-lookup.md) — added the normalization layer this change builds on (effort variants → base price); this change extends it to price speed variants correctly
- [Cursor Token Rate usage proto fields](2026-06-02-160723-cursor-token-rate-usage-proto-fields.md) — the Cursor Token Rate that fast variants inherit from the base entry
- [Model registry Cursor catalog coverage check](2026-06-02-175312-model-registry-cursor-catalog-coverage-check.md) — the registry maintenance gate now extended with variant coverage

---

**Status**: ✅ Production Ready
**Repos**: stigmer-cloud (core billing: 2 new + 5 modified), stigmer (runner display + workflow validation: 1 new + 4 modified)
