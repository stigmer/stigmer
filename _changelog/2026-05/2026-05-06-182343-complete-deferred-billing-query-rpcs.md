# Complete Deferred Billing Query RPCs

**Date**: May 6, 2026

## Summary

Implemented the last two billing query RPCs (`getCustomerModelPricing` and `getBillingUsageReport`), completing the full 14-RPC billing API surface. Added TypeScript SDK methods and React data hooks for both, plus comprehensive unit tests for the handler logic.

## Problem Statement

The billing proto contract defined 14 RPCs across `BillingCommandController` and `BillingQueryController`, but two query RPCs remained unimplemented:

### Pain Points

- `getCustomerModelPricing` had no handler — customers couldn't see what they pay per model
- `getBillingUsageReport` handler existed but had zero unit tests
- Neither RPC was wired into the TypeScript SDK or React hooks, blocking frontend integration

## Solution

Implemented the `getCustomerModelPricing` handler as a pure-read join between the model registry (48 models with pricing data) and the billing policy table (5 active markup policies). Added unit tests for both handlers. Wired both RPCs through the full stack — Java handler, TypeScript SDK client, and React data hooks.

## Implementation Details

### Backend (stigmer-cloud)

**GetCustomerModelPricingHandler** — new handler in `ai.stigmer.domain.billing.request.handler`:
- Pipeline: validate -> extractResourceId -> authorize (can_view_billing) -> BuildPricingStep -> sendResponse
- `BuildPricingStep` iterates all models from `ModelPricingService.getAllModels()`, resolves the active billing policy per (harness, costTier) pair, applies markup to all 4 per-million-token rates via `BillingMicros.applyMarkup()`, and builds `CustomerModelPricingEntry` protos
- Models without a matching policy are silently skipped (logged at WARN) rather than failing the entire response
- Results sorted by harness, costTier, provider, modelId for deterministic ordering

**ModelPricingService changes:**
- Added `displayName` field to the `ModelPricing` record (sourced from `model-registry.json`)
- Added `getAllModels()` method — public accessor to iterate all registered models

**Unit tests:**
- `GetCustomerModelPricingHandlerTest` — 7 tests: markup math across harness/tier combos, missing policy skip, null harness skip, empty registry, identity markup passthrough, null field safety, sort order
- `GetBillingUsageReportHandlerTest` — 6 tests: multi-record aggregation, distinct execution counting, same-model-different-harness separation, empty execution_id handling, no-cost-stamp records, repo exception handling

### SDK (stigmer OSS)

**TypeScript SDK (`@stigmer/sdk`):**
- `BillingClient.getBillingUsageReport(params)` — accepts `{ orgId, startTime: Date, endTime: Date }`, converts to proto Timestamps
- `BillingClient.getCustomerModelPricing(params?)` — accepts optional `{ orgId }` for future org-specific overrides

**React SDK (`@stigmer/react`):**
- `useBillingUsageReport(orgId, startTime, endTime)` — data hook with loading/error/refetch states
- `useCustomerModelPricing(orgId)` — data hook; pass `null` to skip, `undefined` for default pricing
- Barrel exports updated at `billing/index.ts` and top-level `index.ts`

## Benefits

- All 14 billing RPCs now have handler implementations — the billing API surface is complete
- Customer-facing pricing endpoint enables building a transparent pricing page
- Billing usage report endpoint provides the foundation for billing-specific dashboards (distinct from the agent execution usage reports)
- React hooks make both endpoints immediately consumable by frontend components
- 13 new unit tests cover the handler aggregation logic

## Impact

- **Billing API**: Complete — 14/14 RPCs handler-wired (was 12/14)
- **SDK**: 2 new methods on `BillingClient`, 2 new React data hooks
- **Testing**: 13 new test cases across 2 test classes
- **Model registry**: `ModelPricing` record now carries `displayName` for customer-facing display

## Related Work

- Parent project: `20260503.03.stripe-billing-integration`
- Sub-project (complete): `20260504.01.sp.proxy-side-billing-metering`
- Changelog: `2026-05-06-171747-phase5-usage-dashboard-enrichment.md` (Phase 5.1+5.2+5.5)
- Remaining: Phase 5.3 (Alerts) on hold pending email infrastructure

---

**Status**: Production Ready
**Timeline**: Single session
