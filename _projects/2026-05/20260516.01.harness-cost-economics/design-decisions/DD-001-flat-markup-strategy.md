# DD-001: Flat Per-Harness Markup Strategy

**Date:** 2026-05-17
**Status:** Accepted
**Context:** Billing policy pricing for Stigmer Cloud

## Decision

Replace the tiered markup structure (5 policies varying by harness + cost tier) with flat per-harness markups:

| Harness | Markup | Basis Points | Minimum Charge |
|---------|--------|-------------|----------------|
| Native (all models) | 20% | 12,000 | 100 micros ($0.0001) |
| Cursor (all models) | 10% | 11,000 | 100 micros ($0.0001) |

## Previous Structure (Replaced)

| Policy | Harness | Cost Tier | Markup |
|--------|---------|-----------|--------|
| native-economy-v1 | native | economy | 35% (13,500 bp) |
| native-standard-v1 | native | standard | 25% (12,500 bp) |
| native-premium-v1 | native | premium | 15% (11,500 bp) |
| cursor-standard-v1 | cursor | standard | 10% (11,000 bp) |
| cursor-max-v1 | cursor | premium | 5% (10,500 bp) |

## Rationale

### 1. User Perception

The tiered structure penalized budget-conscious users in percentage terms. A developer choosing an economy model (already the cheapest option) paid the highest markup percentage (35%). While the absolute margin was small ($0.09/M extra on a $0.25/M model), the percentage signals "Stigmer taxes frugal users more." That is the wrong brand signal for an infrastructure platform.

### 2. Constant Cost-to-Serve

Stigmer's actual cost to serve an LLM call is roughly constant regardless of the underlying model. The proxy processes the same bytes, the billing system debits the same way, the ledger writes the same entry, the credit reservation lifecycle is identical. A flat percentage honestly reflects the cost structure: the margin naturally scales with model price (20% of $15/M gives $3/M vs. 20% of $0.25/M gives $0.05/M) without artificial inflation on cheap models.

### 3. Simplicity and Explainability

The new structure is explainable in one sentence: "Stigmer charges 20% on native harness and 10% on cursor harness, on top of provider rates." No footnotes, no tier lookup tables, no cognitive burden for users evaluating pricing.

### 4. Native vs. Cursor Differential

- **Native at 20%**: Stigmer provides the full operational stack — LLM proxy with provider-grade observability, 4-bucket cache-aware cost computation, credit reservation system, cost cap signals, auto-recharge, billing ledger with audit trail, model registry, and execution authorization/finalization. This justifies a meaningful commission.
- **Cursor at 10%**: Stigmer provides orchestration, credit management, billing deduction, cost caps, auto-recharge, and unified billing view — but NOT the LLM proxy (Cursor handles the model call). Less Stigmer-owned infrastructure means a lower commission. Additionally, users choosing cursor already pay Cursor's own fees (including a $0.25/M Token Rate on Teams plans), so a higher Stigmer commission would make the combined cost uncompetitive.

## Competitive Positioning

| Platform | Pricing Model |
|----------|--------------|
| **Cursor** | Provider rates + $0.25/M flat surcharge on Teams |
| **Vercel AI Gateway** | Zero markup on BYOK; monetizes via platform subscription |
| **GitHub Copilot** | Token-based billing at provider rates (+ Actions minutes for agentic infra) |
| **Windsurf** | Token quotas at provider rates with daily/weekly refresh budgets |
| **Stigmer (new)** | Provider rates + 20% native / 10% cursor |

Stigmer's 10% cursor commission ($0.30/M on a $3/M model) is directly comparable to Cursor's own $0.25/M surcharge. The 20% native commission ($0.60/M on $3/M) is slightly higher but justified by full infrastructure ownership that eliminates the need for users to build their own proxy, billing, and observability stack.

## Concrete Economics

### Typical native multi-turn session (Sonnet 4.6, 5 turns)

- ~250k input tokens, ~25k output tokens
- Raw provider cost: ~$1.13
- With 20% markup: ~$1.35 (user pays $0.22 extra)

### Typical cursor coding session (3 calls)

- ~45k input tokens (including ~10k overhead per call), ~3k output
- Raw provider cost: ~$0.18
- With 10% markup: ~$0.20 (user pays $0.02 extra)

Both feel proportionate to the value delivered.

## Future Evolution

The architecture already supports progressive sophistication without breaking the flat default:

1. **Org-specific overrides** — `BillingPolicyService` resolution order already documents future phases for org-specific policies. High-volume enterprise customers could negotiate reduced markups.
2. **Volume discounts** — Could be implemented as org-level policy overrides that activate when monthly spend exceeds thresholds.
3. **Model-specific adjustments** — If a specific model has anomalous cost-to-serve (e.g., extremely long context windows requiring special proxy handling), a model-specific policy could override the flat default.
4. **Promotional rates** — Time-limited policies with reduced markup for onboarding or growth campaigns.

The `costTier` field is retained in the model registry for analytics (cost tier distribution dashboards) but billing policy resolution falls through to the flat `default` tier.

## Implementation

1. New MongoDB migration: deactivate v1 policies, seed v2 flat-rate policies with `costTier=default`
2. `BillingPolicyService.resolvePolicy()` gains a fallback: if no policy matches `(harness, costTier)`, retry with `(harness, "default")`
3. Existing model registry `costTier` fields are preserved for reporting; they no longer drive markup differentiation
4. Documentation updated to reflect simplified pricing language
