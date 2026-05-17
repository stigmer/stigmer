# Flat Per-Harness Billing Markup Strategy

**Date**: May 17, 2026

## Summary

Replaced the tiered billing markup structure (5 policies varying by harness + model cost tier) with flat per-harness rates: 20% for native, 10% for cursor. Added a comprehensive cost optimization guide to help users make informed harness selection decisions.

## Problem Statement

The existing billing policy structure used 5 different markup rates across harness and cost tier combinations (35%/25%/15% for native economy/standard/premium, 10%/5% for cursor standard/premium). This created three issues:

### Pain Points

- Higher percentage on cheaper models sent the wrong signal ("Stigmer penalizes budget-conscious users")
- Five tiers were harder to explain than two flat rates — pricing pages need footnotes
- The wide native/cursor gap (15-35% vs 5-10%) felt disproportionate given both use the same billing infrastructure
- Cursor at 5% barely covered infrastructure costs for credit management, billing lifecycle, and execution authorization

## Solution

Simplified to two flat rates with a `BillingPolicyService` fallback mechanism that resolves any model's cost tier to the harness-level default policy:

| Harness | Commission | Rationale |
|---------|-----------|-----------|
| Native  | 20%       | Full infrastructure: proxy, caching, metering, cost caps, auto-recharge |
| Cursor  | 10%       | Orchestration + billing on top of Cursor's own infrastructure |

## Implementation Details

**stigmer-cloud (backend):**
- New migration `U20260517_FlatMarkupBillingPolicies` deactivates v1 policies and seeds v2 flat-rate policies with `costTier=default`
- `BillingPolicyService.resolvePolicy()` gains a fallback: if no policy matches `(harness, costTier)`, retries with `(harness, "default")`
- Model registry `costTier` field retained for analytics; no longer drives markup differentiation
- 5 new unit tests for fallback behavior

**stigmer (documentation):**
- `docs/concepts/billing.mdx` — "Billing policies" section rewritten as "Platform commission" with flat rate language
- `docs/guides/runners/cost-optimization.mdx` — New guide with harness economics, prompt caching math (78% savings over 10 turns), decision matrix (9 task types), session length economics
- `docs/concepts/harnesses.mdx` — Comparison table expanded with commission, overhead, caching, and latency rows

**Internal:**
- Design decision `DD-001-flat-markup-strategy.md` documents rationale, competitive positioning, and future evolution path

## Benefits

- One-sentence pricing explanation: "20% on native, 10% on cursor"
- Competitive positioning aligned with Cursor ($0.25/M surcharge) and Vercel (zero-markup BYOK)
- Architecture preserves future flexibility (org-specific overrides, volume discounts) via policy resolution order
- Users now have data-backed guidance on when each harness saves money

## Impact

- **Users**: Clearer pricing, no penalty for choosing economy models, actionable cost optimization guidance
- **Business**: Sustainable 10% cursor margin (was 5%), simplified pricing communication
- **Architecture**: Backward-compatible — fallback mechanism means existing models work without registry changes

## Related Work

- WI-1 (Anthropic Prompt Caching) — validated 97-100% cache hit rates that inform the optimization guide
- WI-2 (Billing Architecture) — resolved model capture that enables accurate pricing
- WI-4 (Cursor Context Trimming) — quantified ~10k token overhead documented in the guide
- WI-5 (Benchmark Local vs Cloud) — infrastructure for future benchmark narrative

---

**Status**: ✅ Production Ready (pending migration deployment)
**Timeline**: Single session
