# Usage Proto: Cursor Token Rate Cost Fields

**Date**: June 2, 2026

## Summary

Added two fields to the agent-execution usage proto so the billing system can
account for Cursor's "Cursor Token Rate" — a $0.25-per-million-token surcharge
Cursor applies on top of model API pricing for non-Auto agent requests on Teams
plans. `PricingSnapshot` gains the applied rate and `CostStamp` gains the
explicit, auditable fee amount. These are the contract additions backing the
cursor-token-rate billing fix implemented in the cloud billing service.

## Problem Statement

For Cursor-harness executions, our computed provider cost summed only the four
model token-price buckets (input/output/cache-write/cache-read). It omitted
Cursor's flat per-token surcharge entirely. Our percentage markup was then
applied to an under-counted base, silently consuming the margin — break-even on
balanced calls and a real loss on cache-read-heavy calls (where the flat fee is
a larger fraction of a low average $/token).

To fix the cost base in the billing engine, the per-call usage record needs to
both stamp the rate that was applied (for historical reproducibility) and carry
the fee as a distinct, auditable line item rather than burying it inside the
provider cost.

### Pain Points

- No place on the usage record to record the Cursor Token Rate that was applied.
- No way to surface the surcharge as a transparent sub-component of provider
  cost for audit or per-call breakdowns.

## Solution

Extend the existing usage messages in
`apis/ai/stigmer/agentic/agentexecution/v1/usage.proto` with two additive
fields:

- `PricingSnapshot.cursor_token_rate_micros_per_million` (field 15) — the rate
  applied at write time, in micro-USD per million tokens, alongside the existing
  per-bucket price fields. Zero for native harness and exempt cursor models
  (Auto and the Composer pool).
- `CostStamp.cursor_platform_fee_micros` (field 6) — the computed fee, already
  included in `provider_cost_micros`, surfaced explicitly for audit and per-call
  transparency.

Both are backward-compatible additions (new field numbers, no renames or removals).

## Implementation Details

- `PricingSnapshot`: added `int64 cursor_token_rate_micros_per_million = 15;`
  (15 was the next free number after the rate block 10-14).
- `CostStamp`: added `int64 cursor_platform_fee_micros = 6;` and clarified in the
  `provider_cost_micros` doc that, for cursor-harness calls, provider cost now
  includes this fee.
- Regenerated language stubs (Go, Java, Python, TypeScript) plus the SDK and
  mcp-server proto copies via `make protos`.

The billing engine that populates these fields — folding the fee into provider
cost so the markup covers it, the data-driven Auto/Composer exemption, and
customer-pricing parity — lives in the cloud billing service and is tracked
separately in that repository.

## Benefits

- Per-call usage records can now reproduce the exact Cursor charge and itemize
  the surcharge, instead of it being invisible inside provider cost.
- Additive contract change: existing consumers are unaffected until they opt in
  to reading the new fields.

## Impact

- Affects the agent-execution usage contract consumed by the cloud billing
  service and any SDK/runner consumers of `CostStamp` / `PricingSnapshot`.
- No behavioral change in this repository; the fields are populated by the cloud
  billing service.

## Related Work

- Cloud-side billing implementation: cursor-token-rate billing fix (cost-base
  correction, customer-pricing parity, native markup migration) in
  `stigmer-cloud`.
- Builds on the 2026-06-02 cache-token double-pricing fix, which made the four
  token buckets disjoint — the basis the surcharge is summed over.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
