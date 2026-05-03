# Next Task: 20260503.03.stripe-billing-integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260503.03.stripe-billing-integration

**Description**: Implement a prepaid credit-based billing system for Stigmer Cloud with Stripe integration. Customers purchase credits upfront via Stripe Checkout and consume them as their AI agents execute. Includes a custom MongoDB credit ledger, versioned pricing policies with per-harness/per-tier margins, execution reservation and per-LLM-call debit enforcement, auto-recharge via saved payment methods, usage dashboards, and enterprise invoicing.
**Goal**: Ship a production-ready, cloud-only prepaid billing system that enables Stigmer to monetize AI agent execution usage with transparent pricing, real-time credit enforcement, and Stripe-powered payment processing.
**Tech Stack**: Java 21/Spring Boot (stigmer-service), MongoDB, Stripe API, gRPC/Connect, Temporal, Python (agent-runner integration), TypeScript/React (billing UI)
**Components**: stigmer-cloud billing bounded context (new), stigmer-service domain handlers, MongoDB collections, Stripe webhook integration, agent-runner UsageTracker billing hooks, web console billing pages, proto definitions (apis/), model-registry.json pricing policy

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-03 09:55
**Current Task**: T01 — Phase 2 (Execution Enforcement MVP)
**Status**: Phase 2.3 Complete — ReportLlmCallUsage Handler + Service

## Session Progress (2026-05-03)

### Phase 0 Completed
- Defined 7 billing proto files in `apis/ai/stigmer/billing/v1/`
- 5 enums, 28 messages, 2 services (10 RPCs total)
- Added `can_view_billing` / `can_manage_billing` to IamPermission
- Enhanced model-registry.json with provider cost source metadata (48 models)
- Generated stubs in both repos (Go, Java, Python, TS, Dart)
- Created `BillingMicros` Java utility class with 30 unit tests in stigmer-cloud

### Phase 1.1 + 1.4 Completed (Collections & Migrations)
- Created 4 MongoDB collections via Mongock migrations in stigmer-cloud:
  - `billing_account` — org_id unique, stripe_customer_id sparse unique
  - `credit_ledger_entry` — idempotency_key unique, (org_id, created_at desc), (org_id, type)
  - `credit_grant` — (org_id, priority, expires_at) burn-order, (org_id, remaining_amount_micros)
  - `billing_policy` — policy_id unique, (harness, cost_tier, active) resolution
- Seeded 5 initial billing policies (native-economy/standard/premium, cursor-standard/max)
- Collection names follow platform convention: singular snake_case matching proto message names
- Deferred: `credit_purchase` (Phase 3), `execution_reservation` (Phase 2)

### Key Design Decisions
- BillingAccount is NOT a standard API Resource (authorizes via organization)
- Single `billing/v1/` package (not per-resource sub-packages)
- Markup as int32 basis points (10000 = 1.0x), not doubles
- Billing domain does NOT import from agentic domain
- Credit packs simplified to 3 (Starter $10, Growth $50, Team $200) + auto-granted trial
- Collection names: singular snake_case (billing_account, not billing_accounts)
- Billing documents stored as proto-JSON (via JsonFormat), not hand-mapped POJOs

### Phase 1.2 + 1.3 Completed (Domain Services, Repos, Handlers)
- Created 4 proto-JSON MongoDB repositories in `ai.stigmer.domain.billing.repo`:
  - `BillingPolicyRepo` — read-only policy resolution by (harness, cost_tier, active)
  - `BillingAccountRepo` — getOrCreate (idempotent with DuplicateKeyException), atomicBalanceAdjust via $inc, atomicBalanceUpdate for mixed promotional/purchased debits
  - `CreditLedgerEntryRepo` — append-only insert with idempotency_key dedup, paginated query with type/time filters
  - `CreditGrantRepo` — insert, findActive sorted by burn order, decrementRemaining with atomic guard
- Created 4 domain services in `ai.stigmer.domain.billing.service`:
  - `BillingPolicyService` — resolvePolicy(harness, costTier), custom BillingPolicyNotFoundException
  - `UsageRatingService` — rate(providerCost, harness, costTier, model) with markup + minimum charge floor
  - `BillingAccountService` — getOrCreate, get, getBalance with BillingAccountNotFoundException
  - `CreditLedgerService` — adjustCredits (admin), debitCredits (burn-order algorithm), getLedger, DebitResult/LedgerPage records
- Created gRPC auto-controller + 5 handlers in `ai.stigmer.domain.billing.request`:
  - `BillingGrpcAutoController` — wires BillingCommandControllerGrpc + BillingQueryControllerGrpc
  - `GetOrCreateBillingAccountHandler` — idempotent account provisioning
  - `GetBillingAccountHandler` — retrieve account with balance
  - `GetCreditBalanceHandler` — balance breakdown only
  - `AdjustCreditsHandler` — admin credit adjustment with idempotency
  - `GetCreditLedgerHandler` — paginated ledger query with filters
- Created 4 unit test files (Mockito, JUnit 5):
  - `BillingPolicyServiceTest` — policy resolution, missing policy
  - `UsageRatingServiceTest` — all 5 markup tiers, minimum charge floor, edge cases
  - `BillingAccountServiceTest` — getOrCreate, get, getBalance, not-found
  - `CreditLedgerServiceTest` — append-only invariant, burn order (promotional first, split across grants, concurrent skip), idempotency dedup, billing signals (continue/warning/stop), negative balance enforcement
- Int64 proto-JSON fix: repos post-process Documents to convert int64 strings to BSON longs for $inc and numeric query support
- Burn order algorithm implemented and tested but NOT wired to runtime (Phase 2)

### Phase 2.1 + 2.7 Completed (Reservation Collection + Transaction Infrastructure)
- Created `execution_reservation` collection via Mongock migration (order 024):
  - `reservation_id` unique index (primary key lookup)
  - `execution_id` unique index (one reservation per execution invariant)
  - `(org_id, status)` compound index (active reservations per org)
  - `(status, expires_at)` compound index (expiry cleanup job)
- Created `ExecutionReservationRepo` in `ai.stigmer.domain.billing.repo`:
  - insert, findByExecutionId, findByReservationId, findActiveByOrgId
  - `atomicIncrementConsumed` — $inc on consumed_micros with active-status guard
  - `updateStatus` — lifecycle state transitions
  - Proto-JSON pattern with int64 post-processing for reserved_micros + consumed_micros
- Added `MongoTransactionConfig` in `ai.stigmer.infra.mongostarter`:
  - `MongoTransactionManager` bean with `@ConditionalOnProperty(spring.data.mongodb.transactions.enabled)`
  - Enables `@Transactional` support for multi-document operations
  - Gated to allow environments without replica set to boot cleanly
- Added `application-mongo.yaml` property: `transactions.enabled: ${MONGO_TRANSACTIONS_ENABLED:true}`
- Added 2 new methods to `BillingAccountRepo`:
  - `atomicReservationDebit(orgId, debitMicros, promoConsumed, purchasedConsumed)` — debits from reserved bucket (does NOT touch available)
  - `atomicReservationTransfer(orgId, availableDelta, reservedDelta)` — moves funds between available and reserved (authorize/release)
- Created 2 new test files (Mockito, JUnit 5):
  - `ExecutionReservationRepoTest` — 14 tests covering insert/find/increment/status operations
  - `BillingAccountRepoTest` — 9 tests verifying $inc field correctness, invariants, error cases

### Key Design Decisions (Phase 2 Infrastructure)
- `atomicReservationDebit` is a targeted method (not generalized) — clear intent, less risk of misuse
- `atomicReservationTransfer` is symmetric for authorize (available→reserved) and finalize (reserved→available)
- `@Transactional` will be used on Phase 2.2-2.4 service methods (transaction manager registered but not yet consumed)
- No TTL index on expires_at — expired reservations kept for audit, status updated by cleanup job
- Reservation status stored as proto enum name string (same pattern as existing billing repos)

### Phase 2.2 Completed (AuthorizeExecution Handler + Service)
- Created `BillingExecutionConfig` in `ai.stigmer.domain.billing.config`:
  - Spring `@ConfigurationProperties(prefix = "stigmer.billing.execution")`
  - `defaultReservationMicros` = 1,000,000 ($1.00) — research-backed
  - `minimumStartThresholdMicros` = 50,000 ($0.05) — deny below this
  - `reservationExpiryHours` = 4 — safety net for orphaned reservations
- Created `ExecutionBillingService` in `ai.stigmer.domain.billing.service`:
  - `authorizeExecution(orgId, executionId, harness, expectedCostCapMicros)` → `AuthorizeExecutionResponse`
  - Full algorithm: idempotency check → account status gate → reservation sizing → @Transactional atomic write
  - Reservation amount: `min(effectiveCap, available + allowedNegative)`, deny if < $0.05
  - Partial reservation: users with $0.30 can start (reduced headroom, per-call signals handle degradation)
  - Idempotency: existing active reservation returned on Temporal retry; finalized/expired → denied
  - `DuplicateKeyException` caught for concurrent insert race → reads back winner
  - `@Transactional` on `executeReservation()`: balance transfer + reservation insert + ledger hold entry
  - Writes `reservation_hold` ledger entry (type, negative amount, idempotency key `reserve_{executionId}`)
- Created `AuthorizeExecutionHandler` in `ai.stigmer.domain.billing.request.handler`:
  - `@RequestRoute(controller = BillingCommandControllerGrpc.class, method = authorizeExecution)`
  - Simplified pipeline: validateFieldConstraints → AuthorizeExecutionStep → sendResponse
  - No extractResourceId or authorize (RPC has `is_skip_authorization = true`)
  - Error mapping: `IllegalStateException` → `FAILED_PRECONDITION`, generic → `INTERNAL`
- Created `ExecutionBillingServiceTest` (14 tests, Mockito + JUnit 5):
  - Happy path: $10 available, reserves $1.00, verifies reservation + ledger entry fields
  - Partial reservation: $0.30 available, reserves $0.30
  - expected_cost_cap: respects caller-provided cap
  - Denials: insufficient ($0.03), suspended account, closed account, not found, zero balance
  - Idempotency: active reservation returned, finalized denied, expired denied, concurrent race
  - Allowed negative balance: extends headroom, edge cases around $0.05 threshold
  - Integrity: expiry timing (4h ± 5s), no writes on denial
- Added `stigmer.billing.execution.*` properties to `application.yaml` with env-var overrides

### Key Design Decisions (Phase 2.2)
- Default $1.00 reservation (research: OpenAI/Anthropic/Replicate "small upfront reserve" pattern)
- $0.05 minimum start threshold (not enough for even one cheap LLM call → deny)
- Partial reservation is UX-optimal: per-call debit system (Phase 2.3) handles graceful degradation
- Reservation is an escrow optimization, NOT a hard gate — Phase 2.3 must handle "no active reservation" gracefully
- 4-hour expiry is safety net only; normal finalization happens via Temporal finally block

### HITL + Reservation Expiry — RESOLVED
- **Scenario**: HITL approval takes 2 days; reservation expires after 4 hours; credits released; execution resumes
- **Decision (confirmed)**: Option A — `ReportLlmCallUsage` falls back to debiting from available balance when reservation is expired. Reservation is a budget optimization, not a hard dependency. Implemented and tested in Phase 2.3.

### Phase 2.3 Completed (ReportLlmCallUsage Handler + Service)
- Refactored `CreditLedgerService` to support reservation-aware debits:
  - Extracted burn-order algorithm into package-private `consumeGrants(orgId, amountMicros)` → `GrantConsumption`
  - Added `debitUsageCredits(orgId, totalDebit, reservedDebit, availableDebit, source, rating, key)` — unified debit with explicit reservation/available split
  - Existing `debitCredits()` preserved unchanged (uses `atomicBalanceUpdate` as before)
  - Added execution-aware `determineSignal(account, reservationHeadroom)` overload
- Added `atomicUsageDebit()` to `BillingAccountRepo`:
  - Single atomic `findAndModify` with 5 `$inc` operations (reserved, available, total, promotional, purchased)
  - Handles all three debit paths: full-reserved, full-available, split
  - Precondition: `reservedDebit + availableDebit > 0`
- Created `ExecutionBillingService.reportLlmCallUsage()`:
  - Full algorithm: idempotency → account status gate → rate → zero-cost short circuit → resolve reservation → compute debit split → @Transactional debit → execution-aware signal
  - Debit routing: 4 paths based on reservation state (active with headroom, partial headroom, exhausted headroom, expired/missing)
  - Expired reservation fallback: debits from available balance, no reservation tracking (HITL edge case)
  - Zero-cost calls: skip debit entirely, return CONTINUE (fully cached responses)
  - `@Transactional` on `executeUsageDebit()`: `debitUsageCredits` + `atomicIncrementConsumed` (reservation path only)
  - Execution-aware signal: `effectiveBalance = available + reservationHeadroom`
- Created `ReportLlmCallUsageHandler` in `ai.stigmer.domain.billing.request.handler`:
  - `@RequestRoute(controller = BillingCommandControllerGrpc.class, method = reportLlmCallUsage)`
  - Pipeline: validateFieldConstraints → ReportLlmCallUsageStep → sendResponse
  - No IAM steps (internal RPC, `is_skip_authorization = true`)
  - Error mapping: `BillingPolicyNotFoundException` → `FAILED_PRECONDITION`, `IllegalStateException` → `FAILED_PRECONDITION`, generic → `INTERNAL`
- Added 13 unit tests for `reportLlmCallUsage` in `ExecutionBillingServiceTest` (Mockito + JUnit 5):
  - Happy path: active reservation, full debit from reserved, CONTINUE
  - Partial reservation: headroom < billable, split debit verified
  - Reservation exhausted: zero headroom, full debit from available
  - Expired reservation (HITL fallback): debit from available, no reservation tracking
  - Zero-cost call: no debit, CONTINUE
  - Billing signals: LOW_BALANCE_WARNING, STOP
  - Idempotency: duplicate (execution_id, sequence) returns existing
  - Account suspended: immediate STOP, no debit
  - Account not found: STOP
  - Rating audit: full BillingUsageRating in response
  - Ledger source audit: execution_id, llm_call_sequence, reservation_id
  - No reservation error: IllegalStateException
- Added 6 unit tests for `debitUsageCredits` in `CreditLedgerServiceTest`:
  - Full reservation debit, full available debit, split debit
  - Split validation (mismatched amounts)
  - Idempotency dedup
  - Ledger entry audit fields
- Added 5 unit tests for `atomicUsageDebit` in `BillingAccountRepoTest`:
  - Full reserved, full available, split, zero debit rejection, account not found

### Key Design Decisions (Phase 2.3)
- **Unified `atomicUsageDebit`**: One repo method, one MongoDB `findAndModify`, zero branching at the persistence layer. Handles all three debit paths (full-reserved, full-available, split) via caller-provided split parameters.
- **CreditLedgerService refactor**: Burn-order algorithm extracted into `consumeGrants()` (DRY), `debitCredits()` untouched (backward compatible), `debitUsageCredits()` added for execution path. No test breakage on existing tests.
- **Execution-aware signal**: `effectiveBalance = available + reservationHeadroom`. When debiting from reserved, available doesn't change, so the old `determineSignal(account)` would give stale signals. The new overload gives the runner an accurate "can I keep going?" answer.
- **Zero-cost short circuit**: Fully cached responses (provider_cost=0) produce billable_amount=0. No debit, no ledger entry, immediate CONTINUE. Prevents cluttering the ledger with $0 entries.
- **Org resolution from reservation**: `ReportLlmCallUsageInput` has no `org_id` field. The org is resolved from the execution's reservation document. If no reservation exists, it's a programming error (authorize was never called) → `IllegalStateException` → `FAILED_PRECONDITION`.

## Next Steps (Phase 2 — Execution Enforcement MVP, continued)

1. ~~Create `execution_reservation` collection + migration~~ ✅
2. ~~Implement AuthorizeExecutionHandler — check balance, create reservation~~ ✅
3. ~~Implement ReportLlmCallUsageHandler — rate usage, debit via burn order, return billing signal~~ ✅
4. Implement FinalizeExecutionHandler — release unused reservation, produce billing record
5. Integrate with agent-runner UsageTracker (Python) — billing reporting hook
6. Integrate with Temporal workflow — authorize before dispatch, finalize after completion
7. ~~Add MongoTransactionManager for atomic multi-document debit path~~ ✅

## Context for Resume
- Proto contracts are stable — all downstream code can build against them
- All Phase 1 domain services, repos, and handlers are implemented and unit-tested
- `BillingMicros` handles all micro-USD arithmetic
- Phase 1+2 infrastructure work is entirely in stigmer-cloud (Java domain handlers + MongoDB)
- Repos use proto-JSON (JsonFormat) with int64 post-processing for BSON numeric types
- Billing repos use MongoTemplate directly (non-API-resource pattern)
- BillingAccount balance is the source of truth, maintained via atomic $inc
- CreditLedgerService has two debit paths: `debitCredits()` (available-only, existing callers), `debitUsageCredits()` (reservation-aware, execution billing)
- Both debit paths share `consumeGrants()` for burn-order grant consumption (DRY)
- MongoTransactionManager is consumed by both `executeReservation()` and `executeUsageDebit()` in ExecutionBillingService
- ExecutionReservationRepo supports `atomicIncrementConsumed()` for per-call reservation tracking
- Balance model: reserve moves available→reserved, per-call debit reduces reserved+total (or available+total for fallback), finalize releases reserved→available
- 7 gRPC RPCs are now handler-wired: getOrCreateBillingAccount, adjustCredits, getBillingAccount, getCreditBalance, getCreditLedger, authorizeExecution, **reportLlmCallUsage**
- 3 RPCs deferred: finalizeExecution (Phase 2.4), getBillingUsageReport, getCustomerModelPricing (Phase 5)
- `BillingExecutionConfig` provides Spring-configurable reservation defaults ($1.00 reserve, $0.05 minimum, 4h expiry)
- HITL reservation expiry is handled: expired reservations fall back to available balance debit
- Zero-cost calls (cached responses) are handled: no debit, no ledger entry, immediate CONTINUE
- Execution-aware billing signal factors in reservation headroom for accurate runner guidance

## Quick Commands

After loading context:
- "Start Phase 2.4" - Begin FinalizeExecutionHandler implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
