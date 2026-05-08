# Pricing Page Rewrite, Cost Calculator, and Billing Docs

**Date**: May 8, 2026

## Summary

Replaced the stale 3-tier subscription pricing page on stigmer.ai with a credit-based pricing page that reflects the live prepaid billing system. Added an interactive cost calculator that fetches real-time model pricing from a new public API endpoint, and created comprehensive billing documentation in the docs site.

## Problem Statement

The stigmer.ai/pricing page showed a placeholder subscription model (Free / Pro "Coming Soon" / Enterprise) with a waitlist form that no longer reflects how Stigmer Cloud billing works. Phases 1-5 of the billing project shipped a prepaid credit wallet, but the public-facing website still described an unreleased subscription model.

### Pain Points

- Pricing page misleads visitors about the actual billing model
- No public documentation explaining how credits, reservations, and per-token pricing work
- No cost estimation tool for prospects evaluating Stigmer Cloud
- Waitlist form collecting emails for a "Pro" plan that doesn't exist

## Solution

Three-part update across the marketing site, documentation, and backend:

1. **Pricing page rewrite** — replaced subscription tiers with credit-based pricing: how-it-works steps, credit pack cards, live model pricing table, interactive cost calculator, FAQ, and enterprise CTA
2. **Cost calculator** — interactive estimator that lets users select models, choose volume presets (Light/Moderate/Heavy) or enter custom token counts, and see real-time cost projections
3. **Billing docs** — new `docs/concepts/billing.mdx` covering the full billing lifecycle: credit wallet, pricing formula, execution reservation model, auto-recharge, balance signals, and ledger entry types

## Implementation Details

### Pricing Page (`site/src/components/pages/PricingPage.tsx`)
- Replaced `TIERS` array and `WaitlistForm` with credit-based content
- New sections: Hero, How It Works (3 steps), Credit Packs (Starter $10 / Growth $50 / Team $200), Model Pricing Table, Cost Calculator, FAQ (7 items), Enterprise CTA
- Fetches live pricing data from the public API on mount
- Graceful degradation: calculator and pricing table hidden if API is unreachable

### New Components (`site/src/components/pages/pricing/`)
- `types.ts` — shared `ModelPricingEntry` interface and formatting utilities (`formatUsdRate`, `estimateCostMicros`, `formatUsd`)
- `ModelPricingTable.tsx` — grouped-by-harness table showing per-model input/output rates per million tokens
- `CostCalculator.tsx` — interactive estimator with model selection, volume presets (Light: 1M/200K, Moderate: 10M/2M, Heavy: 100M/20M), custom token input, per-model cost breakdown, and total monthly estimate

### Site Configuration
- Added `cloudApiUrl` to `SITE_CONFIG` for public API calls
- Removed unused `waitlistUrl` property
- Updated pricing page metadata for SEO

### Documentation (`docs/concepts/billing.mdx`)
- Full billing concepts page covering: overview, credit packs, pricing formula, billing policies, execution lifecycle (4 phases), balance model, auto-recharge, low-balance behavior, credit ledger entry types, payment methods, self-hosting
- Added to docs sidebar navigation (`docs/concepts/meta.json`)

## Benefits

- Visitors see accurate pricing information that matches the live billing system
- Cost calculator helps prospects estimate monthly spend before signing up
- Billing documentation provides self-serve answers to common billing questions
- Removed dead waitlist form and "Coming Soon" messaging

## Impact

- **Marketing site**: stigmer.ai/pricing fully updated for credit-based model
- **Documentation**: New billing concepts page at stigmer.ai/docs/concepts/billing
- **SEO**: Updated page metadata to target credit-based pricing keywords
- **Conversion**: Cost calculator provides a concrete conversion path from prospect to signup

## Related Work

- Billing system Phases 1-5 (credit ledger, execution enforcement, Stripe integration, auto-recharge, dashboard)
- Public model pricing API (stigmer-cloud companion change)
- Phase 5.4 cost calculator (originally deferred, now implemented as Phase 6.3)

---

**Status**: Production Ready
**Timeline**: Single session
