# Billing Phase 2: Execution Reservation Infrastructure

**Date**: May 3, 2026

## Summary

Added the `execution_reservation` MongoDB collection with its Mongock migration and repository, and introduced `MongoTransactionManager` infrastructure to enable atomic multi-document operations for the Phase 2 debit path. This provides the foundation for execution-level credit enforcement (authorize, per-call debit, finalize).

## Problem Statement

Phase 1 built the credit ledger MVP — accounts, grants, ledger entries, and burn-order debits. But the debit path was standalone: credits were consumed without any tie to a specific execution lifecycle. Phase 2 needs to:

### Pain Points

- No mechanism to reserve credits at execution start (risk of overdraft across concurrent executions)
- No per-execution consumption tracking (can't finalize or release unused holds)
- No multi-document transaction support (debit path touches 3+ collections atomically)
- Balance model only had "available" and "total" — no "reserved" bucket management

## Solution

Two infrastructure pieces that unblock the Phase 2.2-2.4 handler implementations:

1. **Execution Reservation Collection** — MongoDB collection + Mongock migration + proto-JSON repository following established billing patterns
2. **Transaction Infrastructure** — Spring `MongoTransactionManager` bean (conditional on replica set) + two new atomic balance methods for the reservation lifecycle

## Implementation Details

### Execution Reservation Collection (Phase 2.1)

**Migration**: `U20260503e_ExecutionReservationCollection` (order 024)
- Collection: `execution_reservation` (singular snake_case convention)
- 4 indexes: `reservation_id` unique, `execution_id` unique, `(org_id, status)` compound, `(status, expires_at)` compound
- No seed data — reservations are runtime-created

**Repository**: `ExecutionReservationRepo`
- Proto-JSON pattern with int64 post-processing (reserved_micros, consumed_micros)
- `atomicIncrementConsumed` — $inc with active-status guard (prevents incrementing finalized reservations)
- `updateStatus` — lifecycle state transitions via findAndModify
- `findActiveByOrgId` — queries using compound index for balance computation

### MongoTransactionManager (Phase 2.7)

**Configuration**: `MongoTransactionConfig` in mongo-starter library
- Gated behind `spring.data.mongodb.transactions.enabled=true` (env-var defaulting to true)
- Allows environments without replica set to boot cleanly
- When active, `@Transactional` service methods get multi-document atomicity

**New BillingAccountRepo methods**:
- `atomicReservationDebit(orgId, debitMicros, promoConsumed, purchasedConsumed)` — decrements reserved_micros + total_micros + promo/purchased (does NOT touch available_micros)
- `atomicReservationTransfer(orgId, availableDelta, reservedDelta)` — moves funds between available and reserved (symmetric for authorize and release)

### Testing

- `ExecutionReservationRepoTest` — 14 unit tests (Mockito): insert serialization, int64 handling, query construction, status guards, edge cases
- `BillingAccountRepoTest` — 9 unit tests: $inc field correctness, invariant verification (no available touch on debit, no total touch on transfer), error cases

## Benefits

- **Execution-level credit enforcement ready**: Handlers can now reserve at start, track consumption, and release at end
- **Atomic safety**: MongoTransactionManager enables multi-document consistency for the debit path
- **Clean separation**: `atomicReservationDebit` vs `atomicReservationTransfer` have clear, non-overlapping intents
- **Environment flexibility**: Transaction support is conditional — won't break standalone dev setups

## Impact

- **Billing domain** — 1 new repo, 2 new methods on existing repo, 1 new migration
- **Infrastructure** — MongoTransactionManager available platform-wide (not just billing)
- **Unblocks** — Phase 2.2 (AuthorizeExecution), 2.3 (ReportLlmCallUsage), 2.4 (FinalizeExecution)

## Related Work

- Phase 0: `2026-05-03-113656-billing-proto-contracts-and-pricing-foundation.md`
- Phase 1.1: `2026-05-03-120942-billing-phase1-mongodb-collections-migrations.md`
- Phase 1.2: `2026-05-03-124707-billing-phase12-domain-services.md`

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (Phase 2.1 + 2.7 parallel implementation)
