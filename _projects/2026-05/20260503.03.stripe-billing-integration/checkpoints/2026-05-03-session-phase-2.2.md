# Session Notes: 2026-05-03 — Phase 2.2 AuthorizeExecution

## Accomplishments

- Implemented `BillingExecutionConfig` with research-backed defaults ($1.00 reserve, $0.05 minimum, 4h expiry)
- Implemented `ExecutionBillingService.authorizeExecution()` with full algorithm (idempotency, status gate, reservation sizing, transactional write)
- Implemented `AuthorizeExecutionHandler` with simplified pipeline (no IAM auth — internal RPC)
- Created 14 unit tests across 6 nested groups in `ExecutionBillingServiceTest`
- Added `stigmer.billing.execution.*` properties to `application.yaml`

## Decisions Made

- **Default reservation $1.00**: Research (OpenAI/Anthropic/Replicate pattern) — small upfront reserve, per-call debits handle the rest
- **Partial reservation with $0.05 minimum**: Users with $0.30 can start executions; $0.03 gets denied
- **4-hour expiry**: Safety net only — normal path is Temporal finally block calling FinalizeExecution
- **Reservation is an optimization, not a hard gate**: Critical constraint for Phase 2.3 design
- **No IAM auth on authorizeExecution**: Internal RPC called by Temporal workflow, uses `is_skip_authorization`

## Key Code Changes

- `BillingExecutionConfig.java`: Spring config properties with sensible defaults and env-var overrides
- `ExecutionBillingService.java`: Authorization algorithm with `@Transactional` on the atomic reservation path
- `AuthorizeExecutionHandler.java`: Thin handler delegating to service, simplified pipeline
- `ExecutionBillingServiceTest.java`: Comprehensive coverage of all scenarios
- `application.yaml`: Billing execution config section with env-var defaults

## Learnings

- The `@Transactional` annotation on a `protected` method within the same class works because Spring's proxy intercepts the call from the public method
- HITL approval can take days — reservation expiry needs to be handled gracefully in per-call debits, not by extending the expiry window indefinitely

## Open Questions

- **HITL + reservation expiry**: Recommended Option A (Phase 2.3 falls back to available balance when reservation expired). Discussed with user, pending final confirmation before Phase 2.3 implementation.
- Should `ReportLlmCallUsage` also check account status (suspended/closed) on every call, or just rely on the initial authorization?

## Next Session Plan

1. Resolve HITL reservation question (Option A vs Option B)
2. Start Phase 2.3: `ReportLlmCallUsageHandler` — rate usage, debit via burn order, return billing signal
3. Design the fallback path for expired reservations in per-call debits
