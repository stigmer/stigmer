# Billing Phase 2.2: AuthorizeExecution Handler — Credit Reservation at Execution Start

**Date**: May 3, 2026

## Summary

Implemented the `AuthorizeExecution` gRPC handler and backing `ExecutionBillingService` for Stigmer Cloud's prepaid billing system. This is the first runtime enforcement point in the billing lifecycle — it reserves credits from an org's available balance before an agent execution starts, enabling real-time budget enforcement. The implementation uses research-backed defaults ($1.00 reservation, $0.05 minimum threshold, 4-hour safety expiry) derived from competitive analysis of OpenAI, Anthropic, Replicate, and other prepaid AI platforms.

## Problem Statement

With the billing domain infrastructure (Phase 0-1) and reservation collection (Phase 2.1) in place, Stigmer Cloud had no mechanism to actually gate executions based on credit balance. Agents could start executing without any billing check, meaning:
- Organizations with zero credits could consume LLM resources indefinitely
- There was no credit reservation to protect against concurrent executions draining the same balance
- No audit trail existed for the "execution authorized" billing event

### Pain Points

- No runtime enforcement: executions start regardless of credit balance
- No reservation mechanism to prevent concurrent executions from over-spending
- No billing signal at execution start to inform the runner of budget constraints
- Missing audit trail for when credits were held for an execution

## Solution

Built a three-layer solution following the established billing domain patterns:

1. **`BillingExecutionConfig`** — Spring-configurable reservation parameters with research-backed defaults
2. **`ExecutionBillingService`** — Domain service implementing the full authorization algorithm with idempotency, partial reservation, and transactional atomicity
3. **`AuthorizeExecutionHandler`** — gRPC handler wiring the service to the `authorizeExecution` RPC

The authorization algorithm computes `min(effectiveCap, available + allowedNegative)` and denies if below the $0.05 minimum threshold. This means users with small balances can still start executions (reduced headroom), while per-call debits (Phase 2.3) handle graceful degradation.

## Implementation Details

### New Files (stigmer-cloud)

| File | Purpose |
|------|---------|
| `ai.stigmer.domain.billing.config.BillingExecutionConfig` | `@ConfigurationProperties` for reservation defaults |
| `ai.stigmer.domain.billing.service.ExecutionBillingService` | Core authorization algorithm with `@Transactional` reservation |
| `ai.stigmer.domain.billing.request.handler.AuthorizeExecutionHandler` | gRPC handler with simplified pipeline (no IAM auth) |
| `ExecutionBillingServiceTest` | 14 unit tests across 6 nested groups |

### Modified Files

| File | Change |
|------|--------|
| `application.yaml` | Added `stigmer.billing.execution.*` properties with env-var overrides |

### Authorization Algorithm

1. **Idempotency check** — if a reservation for this execution_id exists and is active, return it (Temporal retry safe)
2. **Account status gate** — deny if billing account is suspended or closed
3. **Reservation sizing** — `min(effectiveCap, available + allowedNegative)`, deny if < $0.05
4. **Atomic reservation** — `@Transactional`: balance transfer + reservation insert + ledger hold entry
5. **DuplicateKeyException handling** — concurrent insert race treated as idempotent return

### Research-Backed Defaults

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| Default reservation | $1.00 (1,000,000 micros) | OpenAI/Anthropic/Replicate "small upfront reserve" pattern; covers ~5-10 standard LLM calls |
| Minimum start threshold | $0.05 (50,000 micros) | Rejects executions that can't afford even one cheap LLM call |
| Reservation expiry | 4 hours | Safety net for orphaned reservations; normal finalization via Temporal finally block |

### Design Question Surfaced: HITL + Reservation Expiry

During review, a critical edge case was identified: human-in-the-loop approval can take days, but reservations expire after 4 hours. The recommended resolution is that Phase 2.3 (`ReportLlmCallUsage`) must gracefully handle expired/missing reservations by falling back to debiting from available balance directly. The reservation is a budget optimization, not a hard gate.

## Benefits

- **Budget enforcement**: Organizations can no longer start executions without sufficient credits
- **Concurrent safety**: Reservation transfer is atomic — two concurrent executions can't double-spend
- **Temporal-friendly**: Full idempotency support for workflow retries
- **Configurable**: All thresholds are Spring properties with env-var overrides — tunable without redeployment
- **Audit trail**: `reservation_hold` ledger entries provide full visibility into when and why credits were held
- **UX-optimal**: Partial reservation allows small-balance users to start executions; per-call signals handle degradation

## Impact

- **Billing domain**: 6 of 10 RPCs now handler-wired (was 5)
- **stigmer-cloud**: 4 new files, 1 modified — clean addition with zero changes to existing billing code
- **Test suite**: 14 new tests covering happy path, partial reservation, 5 denial scenarios, 4 idempotency cases, negative balance edge cases, and integrity checks

## Related Work

- Phase 0: Proto definitions and model-registry pricing metadata
- Phase 1: Domain services, repos, handlers, unit tests
- Phase 2.1: `execution_reservation` collection and `ExecutionReservationRepo`
- Phase 2.7: `MongoTransactionManager` (consumed by `ExecutionBillingService.executeReservation()`)
- **Next**: Phase 2.3 (`ReportLlmCallUsage`) — per-call debit with burn-order grant consumption

---

**Status**: ✅ Production Ready (pending Phase 2.3-2.4 for full enforcement lifecycle)
**Timeline**: Single session
