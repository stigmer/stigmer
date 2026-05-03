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
**Current Task**: T01 — Phase 3 Complete + Ops Setup Done
**Status**: Phase 3 Fully Complete — Ready for Phase 4 (Auto-Recharge)

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

### Phase 3.1 Completed (Stripe Customer Management)
- Added Stripe Java SDK v32.1.0 to stigmer-cloud (MODULE.bazel + BUILD.bazel)
- Created `StripeConfig` (@ConfigurationProperties) and `StripeClientProvider` (@Configuration):
  - Conditional bean: service boots without Stripe credentials (dev/test)
  - Modern StripeClient pattern (no global Stripe.apiKey, thread-safe, mockable)
- Created `StripeCustomerService.ensureStripeCustomer(orgId, billingEmail)`:
  - Lazy provisioning: Stripe Customer created on first payment interaction, not during getOrCreate
  - Fast path: returns existing stripe_customer_id without Stripe API call
  - CAS write: atomicSetStripeCustomerId prevents race conditions
  - Race recovery: CAS loser reads back winner's customer ID
  - Metadata: sets `stigmer_org_id` on Stripe Customer for dashboard search
  - Email: uses requesting user's email (from IdentityAccount)
- Added `atomicSetStripeCustomerId(orgId, stripeCustomerId)` to `BillingAccountRepo`:
  - MongoDB findAndModify with guard (stripe_customer_id is null/empty/absent)
  - Returns Optional.empty() if another request already set the field
- Added `getByStripeCustomerId(stripeCustomerId)` to `BillingAccountService`:
  - Reverse lookup for Phase 3.3 webhook handling
- Added `application.yaml` configuration: `stigmer.stripe.secret-key`, `stigmer.stripe.webhook-secret`
- Unit tests: 8 tests (StripeCustomerServiceTest) + 3 tests (BillingAccountRepoTest CAS)
- Registered 2 new Bazel test targets

### Phase 3.2 Completed (Stripe Checkout Integration)
- Added `CreditPurchaseStatus` enum (PENDING, COMPLETED, FAILED, EXPIRED) to enum.proto
- Added `CreditPurchase` message to credit.proto (purchase lifecycle tracking)
- Added `CreateCreditCheckoutSessionInput/Response` to io.proto
- Added `createCreditCheckoutSession` RPC to BillingCommandController (can_manage_billing authorization)
- Ran `make codegen` (OSS) + `make protos` (cloud) to propagate proto changes
- Created `CreditPackCatalog` in `ai.stigmer.domain.billing.catalog`:
  - Java constants class with 3 static packs (Starter $10, Growth $50, Team $200)
  - `getPack(packId)` returns `Optional<CreditPack>`, `getActivePacks()` for listing
  - No DB dependency — packs are static product catalog entries
- Created `credit_purchase` collection via Mongock migration (order 025):
  - `purchase_id` unique, `checkout_session_id` unique sparse
  - `(org_id, created_at desc)` for history, `(org_id, status)` for pending lookups
- Created `CreditPurchaseRepo` in `ai.stigmer.domain.billing.repo`:
  - Proto-JSON pattern with `ensureNumericFields` for int64 fields
  - `insert`, `findByPurchaseId`, `findByCheckoutSessionId`
  - `atomicSetCheckoutSessionId` (CAS guard), `atomicSetPaymentIntentId`, `updateStatus`
- Created `StripeCheckoutService` in `ai.stigmer.domain.billing.stripe`:
  - `createCheckoutSession(orgId, packId, callerEmail, successUrl, cancelUrl)` → `CheckoutSessionResult`
  - Algorithm: validate pack → verify account active → ensure Stripe Customer → insert PENDING purchase → create Stripe Checkout Session → link checkout_session_id
  - PENDING record inserted BEFORE Stripe call (safer: orphan vs untracked payment)
  - Stripe Checkout Session: mode=payment, PriceData (not pre-created Price), automatic_tax, setup_future_usage=off_session
  - Metadata on session: stigmer_org_id, stigmer_purchase_id, stigmer_pack_id, stigmer_credits_micros
  - Custom exceptions: InvalidPackException, StripeCheckoutException
- Created `CreateCreditCheckoutSessionHandler` in `ai.stigmer.domain.billing.request.handler`:
  - Pipeline: validateFieldConstraints → extractResourceId → authorize → CreateCheckoutSessionStep → sendResponse
  - Resolves caller email from IdentityAccount (server-side, not in RPC input)
  - Error mapping: InvalidPackException→INVALID_ARGUMENT, BillingAccountNotFoundException→NOT_FOUND, suspended/closed→FAILED_PRECONDITION, Stripe failure→INTERNAL
- Unit tests: CreditPackCatalogTest (8 tests) + CreditPurchaseRepoTest (9 tests) + StripeCheckoutServiceTest (12 tests)
- Registered 3 new Bazel test targets
- Fixed pre-existing build issue: GetCreditLedgerHandler.java (PageInfo field name mismatch: getNum/getSize)
- Fixed pre-existing build issue: StripeCustomerServiceTest (Stripe SDK getMetadata() type cast)

### Phase 3.3 Completed (Stripe Webhook Handler)
- Added `/webhook/stripe` to `permitAll()` in `HttpSecurityConfig` — Stripe webhooks use signature verification, not Bearer auth
- Created `stripe_webhook_event` collection via Mongock migration (order 026):
  - `event_id` unique index (Stripe event ID dedup)
  - `(event_type, created_at desc)` compound index
- Created `StripeWebhookEventRepo` in `ai.stigmer.domain.billing.repo`:
  - `insertIfAbsent(eventId, eventType)` — returns true if new, false if duplicate (unique index guard)
  - `markProcessed(eventId)`, `markFailed(eventId, error)` — lifecycle tracking
- Created `StripeWebhookController` in `ai.stigmer.domain.billing.stripe`:
  - Spring `@RestController` with `@PostMapping("/webhook/stripe")`
  - Accepts raw `String` body + `Stripe-Signature` header
  - Verifies signature via `Webhook.constructEvent()` with webhook secret from `StripeConfig`
  - Returns 200 fast, 400 on bad signature, 500 on processing failure
- Created `StripeWebhookService` in `ai.stigmer.domain.billing.stripe`:
  - `handleEvent(event)` — routes by event type via switch expression
  - `checkout.session.completed` + `async_payment_succeeded` → dedup → resolve purchase → guard → set payment_intent_id → provision credits via `CreditLedgerService.adjustCredits()` → transition to COMPLETED
  - `checkout.session.async_payment_failed` → transition PENDING to FAILED
  - `checkout.session.expired` → transition PENDING to EXPIRED
  - Double idempotency: event_id dedup (stripe_webhook_event) + purchase status guard
- Unit tests: StripeWebhookServiceTest (11 tests), StripeWebhookControllerTest (4 tests), StripeWebhookEventRepoTest (5 tests)
- Registered 3 new Bazel test targets — all pass
- Build verified: `./bazelw build //backend/services/stigmer-service/...` and `./bazelw test` — clean

### Key Design Decisions (Phase 3.3)
- **Webhook in stigmer-service**: No separate service or Cloudflare Worker — webhook endpoint lives on the existing HTTP server (port 8081) alongside proxy controllers. Same process, same MongoDB, same domain services.
- **Synchronous processing**: Credit provisioning is 2 MongoDB writes — no async queue needed. Return 200 after processing. If latency becomes an issue, extract to `@Async`.
- **Double idempotency**: Event-level dedup (stripe_webhook_event unique index on event_id) AND business-level guard (purchase status check). Protects against duplicate events AND manual replays.
- **Stripe-Signature verification replaces Spring Security auth**: The `/webhook/stripe` path is `permitAll()` in the security config. Authenticity is verified cryptographically via Stripe's HMAC-SHA256 signing secret — more secure than IP allowlisting.
- **Dashboard registration, not API**: Webhook endpoint URL is registered manually in Stripe Dashboard per environment. One-time setup yields the `whsec_...` signing secret stored as `STIGMER_STRIPE_WEBHOOK_SECRET`.
- **4 event types handled**: `checkout.session.completed`, `async_payment_succeeded` (ACH), `async_payment_failed`, `expired`. Future phases add `payment_intent.succeeded/failed` (auto-recharge) and `charge.refunded/dispute.*` (reversals).

### Key Design Decisions (Phase 3.2)
- CreditPack catalog as Java constants (not DB-seeded): packs are static, never user-editable, no DB round-trip on checkout. Move to DB-backed later if admin pack management needed.
- Caller email resolved server-side from IdentityAccount: simpler client API, avoids consistency risk, matches existing pattern (adjustedBy from caller context).
- PENDING-before-Stripe ordering: safer failure mode — orphaned PENDING records are cleaned by Phase 3.5 reconciliation. The alternative (Stripe succeeds, DB fails) leaves a paid session with no tracking.
- setup_future_usage=off_session: saves payment method for auto-recharge (Phase 4), customer informed on Stripe checkout page.
- Micro-USD to Stripe cents conversion: price_micros / 10,000 = Stripe amount (1 USD = 100 cents = 1,000,000 micros).

### Key Design Decisions (Phase 3.1)
- Lazy creation: Stripe Customer NOT provisioned during getOrCreateBillingAccount — avoids external I/O, Stripe dashboard clutter, and Stripe availability dependency on account lifecycle
- CAS over save(): atomicSetStripeCustomerId uses findAndModify with $set on a single field — avoids overwriting concurrent balance changes that save() (full document replace) would cause
- @Autowired(required=false) for StripeClient: StripeCustomerService handles missing bean gracefully with StripeNotConfiguredException
- Package: `ai.stigmer.domain.billing.stripe` sub-package clearly signals external service integration

### Phase 2.5+2.6 Completed (Runner + Workflow Billing Integration)
- Added `orgId` to `InvokeAgentExecutionWorkflowInput` (populated from `execution.metadata.org`)
- Created `BillingActivities` interface + `BillingActivitiesImpl` in stigmer-cloud:
  - `authorizeExecution(orgId, executionId, harness, costCapMicros)` — called before runner dispatch
  - `finalizeExecution(executionId)` — called in detached finally scope (always runs)
- Wired billing authorization gate into `InvokeAgentExecutionWorkflowImpl`:
  - If denied: EXECUTION_FAILED with denial reason, no runner resources consumed
  - If billing service unreachable: fail-safe (deny execution)
  - Finalization runs on all paths (success, failure, cancellation)
- Created `BillingReporter` gRPC client in Python agent-runner:
  - Wraps `reportLlmCallUsage` RPC, async-safe, graceful degradation on failure
  - Integrated into `StatusBuilder.process_event()` after `on_chat_model_end`
  - Global sequence counter across all scopes (main + sub-agents)
- Created `BillingStopMiddleware` in graphton library:
  - Always injected into every agent graph (inert until activated)
  - On STOP signal: blocks all tools + injects "summarize" SystemMessage
  - Sub-agent view shares activation state with parent
- Created `BillingClient` (Connect-RPC) in TypeScript cursor-runner:
  - Reports per-turn usage in the streaming loop (after `turn-ended` events)
  - On STOP: breaks stream loop early, marks execution as billing-exhausted
- Added `costTier` field to cursor model pricing data (read from model-registry.json)
- Unit tests: Java (5 tests), Python (12 tests), TypeScript (5 tests)

### Phase 2.4 Completed (FinalizeExecution Handler + Service)
- Added `findByOrgIdAndExecutionId(orgId, executionId, type)` to `CreditLedgerEntryRepo`:
  - Queries by `(org_id, type, source.execution_id)` using existing compound index
  - Used at finalization time to aggregate usage across an execution
- Created `ExecutionBillingService.finalizeExecution()`:
  - Full algorithm: find reservation → idempotency (FINALIZED → return summary) → status routing (CANCELLED/EXPIRED → summary only) → ACTIVE → @Transactional finalization → aggregate from ledger
  - No account status gate: finalization always proceeds (execution already ran, credits must be released)
  - `expires_at` irrelevant: only `status` field matters (consistent with `reportLlmCallUsage`)
  - `@Transactional` on `executeFinalization()`: `atomicReservationTransfer` (reserved→available) + `reservation_release` ledger entry + `updateStatus(FINALIZED)`
  - When unused == 0 (fully consumed): only status transition, no balance transfer or ledger entry
  - Aggregation via `aggregateExecutionUsage()`: queries `usage_debit` entries for totals, checks for `reservation_release` entry for released amount
- Created `FinalizeExecutionHandler` in `ai.stigmer.domain.billing.request.handler`:
  - `@RequestRoute(controller = BillingCommandControllerGrpc.class, method = finalizeExecution)`
  - Pipeline: validateFieldConstraints → FinalizeExecutionStep → sendResponse
  - No IAM steps (internal RPC, `is_skip_authorization = true`)
  - Error mapping: `IllegalStateException` → `FAILED_PRECONDITION`, generic → `INTERNAL`
- Added 9 unit tests for `finalizeExecution` in `ExecutionBillingServiceTest` (Mockito + JUnit 5):
  - Happy path: active reservation, releases unused credits, correct summary
  - Fully consumed: zero release, marks FINALIZED, correct call count
  - Zero-cost execution: releases full reservation
  - Idempotent: already FINALIZED, returns summary without writes
  - Cancelled reservation: returns zero summary
  - Expired reservation: returns ledger summary, no release
  - No reservation: IllegalStateException
  - Release ledger entry audit: type, positive amount, source, idempotency key
  - No release entry when fully consumed

### Key Design Decisions (Phase 2.4)
- **Skip `usage_billing_records` collection**: Aggregating from immutable ledger entries at finalization time is clean, consistent, and avoids duplicate data. A materialized summary collection can be introduced in Phase 5 if dashboard query performance demands it.
- **No account status gate on finalization**: Unlike authorize/report, the execution already ran. Holding credits in the reserved bucket indefinitely for a suspended account would be incorrect. The reservation lifecycle is about the execution, not the account.
- **Ledger-based aggregation**: `total_provider_cost` and `total_billable_amount` are computed from `usage_debit` entries with `source.execution_id`. `released_reservation_micros` comes from the `reservation_release` entry (if any). Both paths use the immutable ledger as the single source of truth.
- **Zero-release optimization**: When `consumed == reserved`, no balance transfer or ledger entry is written — only the status transition to FINALIZED. Avoids cluttering the ledger with $0 release entries.

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
4. ~~Implement FinalizeExecutionHandler — release unused reservation, produce billing record~~ ✅
5. ~~Integrate with agent-runner UsageTracker (Python) — billing reporting hook~~ ✅
6. ~~Integrate with Temporal workflow — authorize before dispatch, finalize after completion~~ ✅
7. ~~Add MongoTransactionManager for atomic multi-document debit path~~ ✅

## Next Steps (Phase 3 — Stripe Credit Purchases) ✅ COMPLETE

1. ~~Create Stripe Customer per org on first billing interaction~~ ✅
2. ~~Implement Stripe Checkout integration (CreateCreditCheckoutSession RPC)~~ ✅
3. ~~Webhook handler for checkout.session.completed → credit provisioning~~ ✅
4. ~~Billing page UI (React, replace "Coming Soon" placeholder)~~ ✅
5. ~~Reconciliation job for missed webhooks~~ ✅

## Next Steps (Phase 4 — Auto-Recharge)

1. Payment method management (saved via `setup_future_usage=off_session`)
2. Auto-recharge configuration (SetAutoRechargeConfig RPC, threshold/target/cap)
3. Recharge trigger (off-session PaymentIntent on balance drop)
4. Recharge failure handling (retry, disable, notify)
5. Webhook handling for recharge PaymentIntents

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
- MongoTransactionManager is consumed by `executeReservation()`, `executeUsageDebit()`, and `executeFinalization()` in ExecutionBillingService
- ExecutionReservationRepo supports `atomicIncrementConsumed()` for per-call reservation tracking and `updateStatus()` for lifecycle transitions
- Balance model: reserve moves available→reserved, per-call debit reduces reserved+total (or available+total for fallback), finalize releases reserved→available
- 8 gRPC RPCs are now handler-wired: getOrCreateBillingAccount, adjustCredits, getBillingAccount, getCreditBalance, getCreditLedger, authorizeExecution, reportLlmCallUsage, **finalizeExecution**
- 2 RPCs deferred: getBillingUsageReport, getCustomerModelPricing (Phase 5)
- `BillingExecutionConfig` provides Spring-configurable reservation defaults ($1.00 reserve, $0.05 minimum, 4h expiry)
- HITL reservation expiry is handled: expired reservations fall back to available balance debit
- Zero-cost calls (cached responses) are handled: no debit, no ledger entry, immediate CONTINUE
- Execution-aware billing signal factors in reservation headroom for accurate runner guidance
- FinalizeExecution aggregates billing summary from ledger entries (no separate `usage_billing_records` collection — deferred to Phase 5 if dashboard query performance needs it)
- Finalization has no account status gate — the execution already ran, credits must be released regardless of account state
- `CreditLedgerEntryRepo.findByOrgIdAndExecutionId()` enables per-execution ledger aggregation using existing `(org_id, type)` index
- **Phase 3.1**: Stripe Java SDK v32.1.0 added to stigmer-cloud, StripeClient bean is conditional on `stigmer.stripe.secret-key`
- `StripeCustomerService.ensureStripeCustomer(orgId, billingEmail)` is the entry point for lazy Stripe Customer provisioning
- `BillingAccountRepo.atomicSetStripeCustomerId()` provides CAS for concurrent-safe stripe_customer_id writes
- `BillingAccountService.getByStripeCustomerId()` enables webhook reverse-lookup (Phase 3.3)
- Stripe config: `stigmer.stripe.secret-key` (env: STIGMER_STRIPE_SECRET_KEY), `stigmer.stripe.webhook-secret` (env: STIGMER_STRIPE_WEBHOOK_SECRET)
- New package: `ai.stigmer.domain.billing.stripe` — StripeConfig, StripeClientProvider, StripeCustomerService
- **Phase 3.2**: `CreditPackCatalog` in `ai.stigmer.domain.billing.catalog` — 3 static packs (starter/growth/team), Java constants, no DB
- `CreditPurchaseRepo` in `ai.stigmer.domain.billing.repo` — proto-JSON, CAS for checkout_session_id, lifecycle status transitions
- `StripeCheckoutService.createCheckoutSession()` is the entry point for Stripe Checkout purchases
- `CreateCreditCheckoutSessionHandler` wired to `BillingCommandController.createCreditCheckoutSession` RPC
- `credit_purchase` collection (Mongock order 025) with 4 indexes: purchase_id unique, checkout_session_id unique sparse, (org_id, created_at desc), (org_id, status)
- CreditPurchase lifecycle: PENDING (checkout created) → COMPLETED (webhook, Phase 3.3) or FAILED/EXPIRED
- Stripe Checkout Session metadata carries `stigmer_org_id`, `stigmer_purchase_id`, `stigmer_pack_id`, `stigmer_credits_micros` for webhook reverse-lookup
- Credits are NOT provisioned by Phase 3.2 — provisioning happens in Phase 3.3 webhook handler
- 9 gRPC RPCs now handler-wired: getOrCreateBillingAccount, adjustCredits, getBillingAccount, getCreditBalance, getCreditLedger, authorizeExecution, reportLlmCallUsage, finalizeExecution, createCreditCheckoutSession
- **Phase 3.3**: `StripeWebhookController` at `/webhook/stripe` on port 8081 — signature-verified, 4 event types, double-idempotent
- `StripeWebhookService` provisions credits via `CreditLedgerService.adjustCredits()` on `checkout.session.completed`
- `StripeWebhookEventRepo` provides event-level dedup via unique `event_id` index on `stripe_webhook_event` collection
- Webhook path is `permitAll()` in `HttpSecurityConfig` — uses Stripe signature verification, not JWT
- Credit purchase lifecycle is now end-to-end: PENDING (checkout created) → COMPLETED (webhook, credits provisioned) or FAILED/EXPIRED
- Stripe config: `stigmer.stripe.webhook-secret` (env: `STIGMER_STRIPE_WEBHOOK_SECRET`) — set from Stripe Dashboard webhook endpoint registration
- Manual ops required: Register webhook endpoint URL in Stripe Dashboard (test + live) and store `whsec_...` secret

### Phase 3.4 Completed (Billing Page UI)
- Created `BillingClient` in `@stigmer/sdk` (hand-written, `GitHubClient` pattern):
  - 5 methods: `getOrCreateBillingAccount`, `getBillingAccount`, `getCreditBalance`, `getCreditLedger`, `createCreditCheckoutSession`
  - Wired into `Stigmer` class as `readonly billing: BillingClient`
  - Exported from SDK public API with `CreateCheckoutSessionParams` and `GetCreditLedgerParams` types
- Created `sdk/react/src/billing/` domain folder with 12 files:
  - **Data hooks**: `useBillingAccount(orgId)` — full account with balance; `useCreditLedger(orgId, options?)` — paginated ledger
  - **Behavior hook**: `useCreateCheckoutSession()` — mutation hook, redirects to Stripe Checkout URL on success
  - **Styled components**: `CreditBalanceCard`, `CreditPackGrid`, `CreditLedgerTable`, `LowBalanceBanner`, `BillingSection`
  - **Utilities**: `format.ts` (6 formatters: `formatCreditBalance`, `formatLedgerAmount`, `ledgerEntryLabel`, `isCredit`, `isHold`, `formatLedgerDate`)
  - **Catalog**: `credit-packs.ts` (`CREDIT_PACKS` constant, `formatPackPrice`, `formatCreditCount`)
- Created `sdk/react/src/settings/BillingSection.tsx` — re-export wrapper (follows `UsageSection` pattern)
- Updated `sdk/react/src/index.ts` — added billing barrel exports (3 hooks, 5 components, 8 utilities, 11 types)
- Updated `sdk/react/src/settings/index.ts` — added `BillingSection` export
- Updated `sdk/react/src/settings/settings-nav.ts` — changed description to "Credit management and usage metrics"
- Replaced `client-apps/web/src/app/settings/billing/page.tsx` — `ComingSoon` → `BillingSection` with checkout return handling (`?checkout=success` query param → optimistic banner)
- All three packages pass `tsc --noEmit`: `@stigmer/sdk`, `@stigmer/react`, `client-apps/web`
- BigInt literal (`0n`) not available at current target — used `BigInt(0)` pattern instead

### Key Design Decisions (Phase 3.4)
- **SDK-first**: All components in `@stigmer/react`, zero Console dependencies. Platform builders can embed `<CreditBalanceCard>`, `<CreditPackGrid>`, or use hooks directly.
- **Hand-written BillingClient**: Billing is not a standard API resource — no apply/create/update/delete pattern. Follows `GitHubClient`/`SearchClient` precedent for manual clients.
- **Checkout redirect, not embedded**: Stripe Checkout is a redirect flow. `useCreateCheckoutSession` sets `window.location.href` — no embedded Stripe Elements complexity.
- **Optimistic checkout return**: `?checkout=success` shows "Payment received — credits will appear shortly" banner. No polling. Webhook may not have processed yet — honest and simple.
- **Static credit pack catalog**: `CREDIT_PACKS` array mirrors backend `CreditPackCatalog.java`. No RPC call needed to render pack cards.
- **`BigInt(0)` over `0n`**: Web console's tsconfig targets below ES2020. Used `BigInt(0)` constructor for zero-comparisons in balance/format code.
- **Nav description update**: "Subscription management" → "Credit management" — accurate to the credit-based model, no subscriptions.

- **Phase 3.4**: `BillingClient` in `@stigmer/sdk` — hand-written, 5 methods, wired into `Stigmer` class
- New domain folder `sdk/react/src/billing/` — 3 hooks, 5 components, 8 utilities
- `BillingSection` is a settings section component (follows `UsageSection` pattern) with deployment mode gate, checkout success banner
- `CreditBalanceCard` uses semantic colors: green (healthy), amber (low), red (zero/negative) — driven by `lowBalanceThresholdMicros`
- `CreditPackGrid` renders 3 static packs, disables on suspended/closed accounts, shows loading during checkout
- `CreditLedgerTable` is self-contained: fetches its own data via `useCreditLedger`, handles pagination internally
- Checkout flow: `useCreateCheckoutSession` → RPC → `window.location.href = checkoutUrl` → Stripe → redirect back with `?checkout=success`
- Console page (`settings/billing/page.tsx`) reads `?checkout=success` from `useSearchParams()` and passes to `BillingSection`
- Format utilities handle `bigint` micro-USD → display string conversion (used across all billing components)
- Settings nav description updated to "Credit management and usage metrics"
- 10 gRPC RPCs now handler-wired (9 server + 1 query): getOrCreateBillingAccount, adjustCredits, getBillingAccount, getCreditBalance, getCreditLedger, authorizeExecution, reportLlmCallUsage, finalizeExecution, createCreditCheckoutSession + getBillingAccount (query)

### Phase 3.5 Completed (Billing Reconciliation Cron Workflow)
- Created the **first Temporal cron workflow** in the codebase — establishes the pattern for future scheduled jobs
- Created `BillingReconciliationWorkflow` — `@WorkflowInterface` with cron schedule (every 5 min configurable)
- Created `ReconciliationActivities` interface + impl with two activities:
  - `findStalePendingPurchases()` — queries PENDING purchases older than stale threshold (10 min default)
  - `reconcilePurchase(StalePurchaseRef)` — retrieves Stripe session, routes by status, provisions or marks terminal
- Created `BillingReconciliationWorkerConfig` — dedicated `billing_reconciliation` task queue (isolated from agent execution)
- Created `BillingReconciliationStarter` (`ApplicationRunner`) — starts cron workflow on boot, idempotent via `WorkflowExecutionAlreadyStarted`
- Created `BillingReconciliationConfig` + `BillingReconciliationTemporalConfig` — Spring config properties with env-var overrides
- Added `findPendingOlderThan(Instant)` to `CreditPurchaseRepo` — ordered by created_at ASC
- Added `io.temporal:temporal-testing:1.31.0` to MODULE.bazel for workflow integration testing
- Unit tests: `ReconciliationActivitiesImplTest` (11 tests) + `BillingReconciliationWorkflowTest` (4 Temporal integration tests) — all pass
- Build verified: `./bazelw build` + `./bazelw test` — clean

### Key Design Decisions (Phase 3.5)
- **Temporal cron workflow (not @Scheduled)**: Guarantees exactly-one execution globally via fixed workflow ID. No distributed lock needed. Full visibility in Temporal UI.
- **Dedicated task queue (`billing_reconciliation`)**: Isolates reconciliation Stripe API calls from agent execution path. Rate limiting in one cannot starve the other.
- **Activity-per-purchase granularity**: Each Stripe API call is an independent activity. Temporal retries individual failures without blocking others.
- **Same idempotency key (`purchase_{id}`)**: Reconciliation and webhook handler use identical key — CreditLedgerService's unique index prevents double-crediting regardless of race order.
- **`adjustedBy = "stripe_reconciliation"`**: Distinguishes reconciliation-provisioned credits from webhook-provisioned in audit trail.
- **Feature-flagged (`enabled`)**: Disable reconciliation without redeployment (for environments without Stripe or during maintenance).
- **Orphan handling**: PENDING purchases without checkout_session_id older than 60 min are marked FAILED (Stripe API call never returned).
- **Concrete test activity impl (not Mockito mock)**: Temporal SDK rejects `@ActivityMethod` annotations on mock proxy classes. Used static inner class in workflow test.

- **Phase 3.5**: First Temporal cron workflow in the codebase
- New package: `ai.stigmer.domain.billing.temporal.reconciliation` — 9 source files
- Workflow ID: `billing/reconciliation` (global singleton, cron)
- Task queue: `billing_reconciliation` (env: `TEMPORAL_BILLING_RECONCILIATION_TASK_QUEUE`)
- Config: `stigmer.billing.reconciliation.enabled/cron-schedule/stale-threshold-minutes/orphan-threshold-minutes`
- Reconciliation logic: DB scan → per-purchase Stripe session retrieve → route by session status → provision/expire/fail/skip
- Double-idempotent: purchase status guard + CreditLedgerService idempotency_key dedup
- All Phase 3 (Stripe Credit Purchases) is now complete — 5/5 sub-phases done

### Stripe Ops Setup Completed (Session 2)
- Created Stripe account "Stigmer, Inc." in Stripe Dashboard (Live mode)
- Configured Stripe Tax: head office US (Indiana), product category "Digital products > Business and web services", automatic tax determination
- Created webhook endpoint in Stripe Dashboard for `checkout.session.completed`, `async_payment_succeeded`, `async_payment_failed`, `checkout.session.expired`
- Created `stripe` secrets group in Planton (`secgrp_01kqpvrhxr1y0dw04pzwbr3n2z`) with `prod.secret-key` and `prod.webhook-secret`
- Added `STIGMER_STRIPE_SECRET_KEY` and `STIGMER_STRIPE_WEBHOOK_SECRET` to kustomize base service.yaml for pod injection
- Committed to stigmer-cloud: `443a2f4d chore(billing): add Stripe secrets group and wire env vars to deployment`
- **Manual ops for Phase 3 are now fully complete** — next deployment will have Stripe credentials

### Key Ops Decisions
- Single Stripe account "Stigmer, Inc." covers all future products (shared API keys, Stripe Customers, tax config)
- Separate Products/Prices per product line, but same account
- Webhook signing secret per endpoint (one endpoint per service/environment)
- Secrets stored in Planton secrets group, injected via kustomize as K8s secrets

## Quick Commands

After loading context:
- "Start Phase 4" - Begin auto-recharge implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
