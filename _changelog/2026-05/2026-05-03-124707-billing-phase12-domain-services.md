# Billing Phase 1.2 — Domain Services, Repositories, and gRPC Handlers

**Date**: May 3, 2026

## Summary

Implemented the full Phase 1.2 (Domain Services) of the prepaid billing system in stigmer-cloud. This includes 4 proto-JSON MongoDB repositories, 4 domain services (including the burn-order credit debit algorithm), 5 gRPC handlers wired to the billing proto contracts, and comprehensive unit tests covering all ledger invariants. This work builds on Phase 0 (proto definitions, BillingMicros utility) and Phase 1.1+1.4 (MongoDB collections, migrations, seeded policies) to deliver a working credit ledger with manual credit management and billing account provisioning.

## Problem Statement

Phase 0 defined the billing proto contracts and Phase 1.1+1.4 created the MongoDB collections. The platform still had no domain logic connecting the proto contracts to the database — no way to provision billing accounts, adjust credits, query the ledger, or apply pricing policies. The burn-order credit consumption algorithm (promotional grants first, then purchased, soonest-expiry first) needed to be implemented and validated before Phase 2 could wire it to execution enforcement.

### Pain Points

- No billing account lifecycle management (get-or-create, balance queries)
- No credit adjustment capability for platform admins (testing, support)
- No billing policy resolution to convert provider costs to customer prices
- No burn-order algorithm for grant consumption (critical for Phase 2)
- No gRPC handlers to expose billing RPCs to clients
- Proto-JSON int64 fields serialize as strings, breaking MongoDB `$inc` operations

## Solution

Built the complete Phase 1.2 domain layer following existing stigmer-cloud patterns (non-API-resource repos like OAuthGrantRepo, CustomOperationHandlerV2 pipeline handlers, Mockito-based unit tests). Documents are stored as proto-JSON with a targeted fix for int64 fields that need numeric MongoDB operations.

## Implementation Details

### Repositories (4 files in `ai.stigmer.domain.billing.repo`)

- **BillingPolicyRepo** — Read-only policy resolution by `(harness, cost_tier, active)` compound index. Simplest repo, no write operations at runtime.
- **BillingAccountRepo** — Idempotent `getOrCreate` with `DuplicateKeyException` race-condition handling. `atomicBalanceAdjust` via `findOneAndUpdate` with `$inc` for single-field adjustments. `atomicBalanceUpdate` for multi-field balance updates (promotional/purchased split in debit path). `save` for non-balance field updates.
- **CreditLedgerEntryRepo** — Append-only insert with `idempotency_key` deduplication. Paginated query with type/time filters sorted by `created_at DESC`. Count method for total-pages computation.
- **CreditGrantRepo** — Insert grants, find active grants sorted by burn order (`priority ASC, expires_at ASC`), atomic `decrementRemaining` with guard condition (`remaining_amount_micros >= requested`).

### Proto-JSON Int64 Fix

Proto-JSON (`JsonFormat.printer()`) serializes int64 values as JSON strings per the proto3 spec. MongoDB `$inc` and numeric comparisons require BSON longs. Each repo that needs numeric operations has an `ensureNumericFields()` post-processor that converts known int64 fields from strings to longs after `Document.parse()`. This is explicit per-repo (each repo knows its schema) and preserves the proto-JSON storage approach approved in the plan.

### Domain Services (4 files in `ai.stigmer.domain.billing.service`)

- **BillingPolicyService** — `resolvePolicy(harness, costTier)` with custom `BillingPolicyNotFoundException`. Delegates to repo with future extensibility for model-specific and org-specific overrides.
- **UsageRatingService** — `rate(providerCostMicros, harness, costTier, model)` producing `BillingUsageRating` proto. Applies markup via `BillingMicros.applyMarkup()`, enforces `minimum_charge_micros` floor, returns full audit rating.
- **BillingAccountService** — Thin wrapper: `getOrCreate`, `get`, `getBalance` with `BillingAccountNotFoundException`.
- **CreditLedgerService** — The core service:
  - `adjustCredits` — admin credit/debit with grant creation (for credits), atomic balance update, idempotent ledger entry
  - `debitCredits` — burn-order grant consumption algorithm, split tracking (promotional vs purchased), atomic balance update, billing signal determination (continue/warning/stop). Implemented and tested but not wired to any RPC until Phase 2.
  - `getLedger` — paginated ledger query with type and time filters
  - `DebitResult` / `LedgerPage` records for structured return values

### gRPC Handlers (6 files in `ai.stigmer.domain.billing.request`)

- **BillingGrpcAutoController** — Annotation-processor-driven routing for both `BillingCommandControllerGrpc` and `BillingQueryControllerGrpc` stubs.
- **GetOrCreateBillingAccountHandler** — Idempotent account provisioning (`can_manage_billing`)
- **GetBillingAccountHandler** — Account retrieval (`can_view_billing`)
- **GetCreditBalanceHandler** — Balance-only retrieval (`can_view_billing`)
- **AdjustCreditsHandler** — Admin credit adjustment with caller identity capture (`can_manage_billing`)
- **GetCreditLedgerHandler** — Paginated ledger query with filters, page size bounds (`can_view_billing`)

All handlers follow the `CustomOperationHandlerV2` pipeline pattern: validateFieldConstraints → extractResourceId → authorize → custom step → sendResponse.

### Unit Tests (4 files, Mockito + JUnit 5)

- **BillingPolicyServiceTest** — Policy resolution for all 5 tiers, missing policy exception
- **UsageRatingServiceTest** — All 5 markup tiers, minimum charge floor, zero cost edge case, realistic LLM call scenario
- **BillingAccountServiceTest** — getOrCreate delegation, get/getBalance with not-found handling
- **CreditLedgerServiceTest** — Burn order (promotional first, split across grants, concurrent grant skip), idempotency deduplication, negative amount rejection, balance chain integrity, billing signals (continue/warning/stop)

## Benefits

- **Credit ledger is operational**: Platform admins can provision billing accounts and adjust credits via gRPC RPCs
- **Burn-order algorithm validated**: 6 unit tests prove the grant consumption ordering, including concurrent-access resilience
- **Billing signals ready for Phase 2**: The `debitCredits` method returns continue/warning/stop signals that the agent runner will use
- **Idempotency guaranteed**: Every balance-affecting operation uses unique idempotency keys with database-enforced deduplication
- **Atomic balance updates**: All balance mutations use MongoDB `$inc` — no read-modify-write races

## Impact

- **stigmer-cloud**: 15 new Java files (4 repos, 4 services, 1 controller, 5 handlers, 1 repo method addition)
- **stigmer-cloud tests**: 4 new test files with ~40 test cases covering all ledger invariants
- **Phase 2 unblocked**: CreditLedgerService.debitCredits() is ready to wire into authorizeExecution / reportLlmCallUsage / finalizeExecution

## Related Work

- Phase 0: Billing proto definitions (`_changelog/2026-05/2026-05-03-120942-billing-phase1-mongodb-collections-migrations.md`)
- Phase 1.1+1.4: MongoDB collections, migrations, seeded policies
- Phase 2 (next): Execution enforcement — reservation, per-call debit, finalization

---

**Status**: ✅ Production Ready (Phase 1.2 complete)
**Timeline**: Single session (~1 hour)
