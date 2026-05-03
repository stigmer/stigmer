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
**Current Task**: T01 — Phase 1 (Ledger MVP)
**Status**: Phase 1.2 + 1.3 Complete — Domain Services, Repos, Handlers Done

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

## Next Steps (Phase 2 — Execution Enforcement MVP)

1. Create `execution_reservation` collection + migration
2. Implement AuthorizeExecutionHandler — check balance, create reservation
3. Implement ReportLlmCallUsageHandler — rate usage, debit via burn order, return billing signal
4. Implement FinalizeExecutionHandler — release unused reservation, produce billing record
5. Integrate with agent-runner UsageTracker (Python) — billing reporting hook
6. Integrate with Temporal workflow — authorize before dispatch, finalize after completion
7. Add MongoTransactionManager for atomic multi-document debit path

## Context for Resume
- Proto contracts are stable — all downstream code can build against them
- All Phase 1 domain services, repos, and handlers are implemented and unit-tested
- `BillingMicros` handles all micro-USD arithmetic
- Phase 1 work is entirely in stigmer-cloud (Java domain handlers + MongoDB)
- Repos use proto-JSON (JsonFormat) with int64 post-processing for BSON numeric types
- Billing repos use MongoTemplate directly (non-API-resource pattern)
- BillingAccount balance is the source of truth, maintained via atomic $inc
- CreditLedgerService.debitCredits() is ready for Phase 2 wiring (burn order tested)
- No MongoDB transactions yet — Phase 2 will need MongoTransactionManager for the debit path
- 5 gRPC RPCs are handler-wired: getOrCreateBillingAccount, adjustCredits, getBillingAccount, getCreditBalance, getCreditLedger
- 5 RPCs deferred: authorizeExecution, reportLlmCallUsage, finalizeExecution (Phase 2), getBillingUsageReport, getCustomerModelPricing (Phase 5)

## Quick Commands

After loading context:
- "Start Phase 1" - Begin Ledger MVP implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
