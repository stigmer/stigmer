# Session Notes: 2026-05-03 — Phase 2.3 ReportLlmCallUsage

## Accomplishments

- Refactored `CreditLedgerService`: extracted `consumeGrants()`, added `debitUsageCredits()`, added execution-aware `determineSignal(account, headroom)` — zero behavior change for existing callers
- Added `atomicUsageDebit()` to `BillingAccountRepo` — unified debit with explicit reserved/available split in a single atomic MongoDB `findAndModify`
- Implemented `ExecutionBillingService.reportLlmCallUsage()` with full algorithm: idempotency → status gate → rate → zero-cost short circuit → reservation resolution → debit split → @Transactional debit → execution-aware signal
- Created `ReportLlmCallUsageHandler` with simplified pipeline (validate → report → sendResponse)
- Added 24 new unit tests across 3 files: 13 for reportLlmCallUsage, 6 for debitUsageCredits, 5 for atomicUsageDebit

## Decisions Made

- **HITL reservation expiry (confirmed Option A)**: Expired reservations fall back to available balance debit. Reservation is an escrow optimization, not a hard dependency.
- **Unified `atomicUsageDebit`**: One repo method handles all three debit paths (full-reserved, full-available, split) via caller-provided split parameters. No branching at the persistence layer.
- **CreditLedgerService kept backward compatible**: `debitCredits()` untouched (still calls `atomicBalanceUpdate`), `debitUsageCredits()` added for execution path. Both share `consumeGrants()` for burn-order.
- **Execution-aware signal**: `effectiveBalance = available + reservationHeadroom`. Old signal used `available` alone — stale during reservation debits.
- **Zero-cost short circuit**: billable_amount=0 returns CONTINUE with no debit and no ledger entry.
- **Org resolution from reservation**: No org_id in proto input — resolved from reservation document. Missing reservation = programming error → FAILED_PRECONDITION.
- **Account status check on every call**: Suspended/closed accounts get immediate STOP signal.

## Key Code Changes

### stigmer-cloud (Java)
- `BillingAccountRepo.java`: Added `atomicUsageDebit(orgId, reservedDebit, availableDebit, promoConsumed, purchasedConsumed)`
- `CreditLedgerService.java`: Extracted `consumeGrants()`, added `debitUsageCredits()`, added `determineSignal(account, headroom)`, added `GrantConsumption` record
- `ExecutionBillingService.java`: Added `reportLlmCallUsage()`, `executeUsageDebit()` (@Transactional), `resolveOrgId()`, `reconstructResponse()`, `stopResponse()`. New deps: `CreditLedgerService`, `UsageRatingService`.
- `ReportLlmCallUsageHandler.java`: New handler with `ReportLlmCallUsageStep` inner class
- `BillingAccountRepoTest.java`: 5 new tests for atomicUsageDebit
- `CreditLedgerServiceTest.java`: 6 new tests for debitUsageCredits
- `ExecutionBillingServiceTest.java`: 13 new tests in `ReportLlmCallUsage` nested group

## Learnings

- Refactoring to extract shared logic (burn-order) while keeping existing callers unchanged requires careful layering: the new method adds capability without breaking existing contracts.
- Proto input design matters: `ReportLlmCallUsageInput` not having `org_id` means the reservation is the only way to resolve the org. This is correct (every execution must be authorized first) but surprising.
- The `balance_after_micros` in the ledger entry tracks available balance, which doesn't change during reservation debits. This is consistent with the existing convention but means consecutive reservation debits have the same `balance_after` value.

## Next Session Plan

1. Start Phase 2.4: `FinalizeExecutionHandler` — release unused reservation, produce billing record
2. Consider whether `billable_usage_events` collection (Phase 2.6) is needed before Phase 5, or if the `usage_debit` ledger entries are sufficient
3. Agent runner integration (Phase 2.5): billing hook in Python `UsageTracker`
