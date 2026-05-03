# Billing Phase 2.3: Per-LLM-Call Usage Debit Pipeline (ReportLlmCallUsage)

**Date**: May 3, 2026

## Summary

Implemented the per-LLM-call usage reporting path for the prepaid billing system. The agent runner now calls `reportLlmCallUsage` after each LLM call to rate provider costs, debit credits via burn-order grant consumption, track reservation consumption, and receive a billing signal (continue/warn/stop). This completes the real-time billing enforcement loop: executions are authorized (Phase 2.2), metered per-call (Phase 2.3), and will be finalized (Phase 2.4) at completion.

## Problem Statement

Phase 2.2 established the execution authorization flow — reserving credits upfront before an agent starts. But the reservation alone doesn't enforce per-call billing. Without per-call debit reporting, a single reservation of $1.00 provides no visibility into actual consumption, no graceful degradation as credits run low, and no mechanism to stop a runaway execution.

### Pain Points

- No per-call billing enforcement: executions could consume unlimited LLM calls against a fixed reservation
- No billing signal to the agent runner: no way to warn about low balance or stop when credits are exhausted
- Reservation is a fixed budget with no consumption tracking — headroom is unknown at runtime
- HITL (human-in-the-loop) edge case: reservations expire after 4 hours, but approval can take days

## Solution

A unified per-call debit pipeline that:
1. Rates each LLM call by applying the billing policy markup to the provider cost
2. Routes the debit to the correct balance bucket(s) based on reservation state
3. Tracks consumption against the execution's reservation
4. Returns an execution-aware billing signal to direct the agent runner

The design treats the reservation as an escrow optimization, not a hard dependency — when reservations expire (HITL), debits fall back to the available balance.

## Implementation Details

### Repo Layer: `atomicUsageDebit` (BillingAccountRepo)

A single new MongoDB `findAndModify` method with 5 `$inc` operations that handles all three debit paths without branching:
- **Full reservation**: `atomicUsageDebit(orgId, debit, 0, promo, purchased)` — reserved decreases, available unchanged
- **Full available (fallback)**: `atomicUsageDebit(orgId, 0, debit, promo, purchased)` — available decreases, reserved unchanged
- **Split (headroom overflow)**: `atomicUsageDebit(orgId, headroom, remainder, promo, purchased)` — both decrease

### Service Layer: CreditLedgerService Refactor

Rather than duplicating the burn-order algorithm, extracted the grant consumption loop into a shared `consumeGrants()` method:
- `debitCredits()` — existing method, untouched, backward compatible (uses `atomicBalanceUpdate`)
- `debitUsageCredits()` — new method for execution billing (uses `atomicUsageDebit`)
- Both share `consumeGrants()` for promotional-first, soonest-expiry-first grant consumption

Added execution-aware `determineSignal(account, reservationHeadroom)` — computes `effectiveBalance = available + headroom` so the signal accurately reflects the execution's remaining budget, not just the org's liquid balance.

### Domain Layer: ExecutionBillingService.reportLlmCallUsage()

Full algorithm:
1. **Idempotency** — deduplicated by `usage_{executionId}_{sequence}` key
2. **Account status gate** — suspended/closed accounts get immediate STOP
3. **Rating** — `UsageRatingService.rate()` applies billing policy markup
4. **Zero-cost short circuit** — fully cached responses (billable=0) skip debit entirely
5. **Reservation resolution** — headroom = reserved_micros - consumed_micros
6. **Debit split** — `reservedDebit = min(headroom, billable)`, `availableDebit = remainder`
7. **@Transactional debit** — grant consumption + balance update + reservation tracking in one transaction
8. **Execution-aware signal** — factors in remaining reservation headroom

### Handler Layer: ReportLlmCallUsageHandler

Follows the established pattern: `validateFieldConstraints` → `ReportLlmCallUsageStep` → `sendResponse`. Internal RPC with `is_skip_authorization = true`.

## Benefits

- **Real-time billing enforcement**: Every LLM call is rated, debited, and signaled — no unbounded spending
- **Graceful degradation**: LOW_BALANCE_WARNING lets the runner inject user-facing messages before hard stop
- **HITL resilience**: Expired reservations don't block billing — seamless fallback to available balance
- **Zero-cost optimization**: Cached responses incur no debit and no ledger clutter
- **DRY burn-order**: Single `consumeGrants()` serves both existing and new debit paths
- **Audit completeness**: Every debit produces a `usage_debit` ledger entry with full `BillingUsageRating` and `CreditLedgerSource`

## Impact

- **7 of 10 billing RPCs now handler-wired** (3 deferred: finalizeExecution, getBillingUsageReport, getCustomerModelPricing)
- **Agent runner can now receive billing signals** — ready for Python integration (Phase 2.5)
- **Temporal workflow can now gate execution billing** — ready for workflow integration (Phase 2.6)
- **24 new unit tests** across BillingAccountRepoTest (5), CreditLedgerServiceTest (6), ExecutionBillingServiceTest (13)
- **1,086 lines changed** in stigmer-cloud across 6 modified + 1 new file

## Related Work

- Phase 2.2: AuthorizeExecution handler ([changelog](2026-05-03-134415-billing-authorize-execution-handler.md))
- Phase 2.1+2.7: Execution reservation collection and transaction infrastructure
- Phase 1: Ledger MVP (domain services, repos, handlers, 4 MongoDB collections)
- Phase 0: Proto definitions, billing policy, model registry, BillingMicros library
- Next: Phase 2.4 (FinalizeExecution), Phase 2.5 (agent-runner integration), Phase 3 (Stripe Checkout)

---

**Status**: ✅ Production Ready (pending Phase 2.4 finalization and agent-runner integration)
**Timeline**: Phase 2.3 session, ~1.5 hours
