# Task T01: Prepaid Billing System — Full Implementation Plan

**Created**: 2026-05-03
**Status**: ✅ APPROVED
**Type**: Feature Development
**Timeline**: 2 months (7 phases)
**Research**: `_projects/2026-05/research.prepaid-billing-strategy-stripe-integration/04.report.gpt.md`
**Approved**: 2026-05-03

---

## Strategic Decisions (APPROVED)

| Decision | Approved Value |
|---|---|
| **Credit unit** | 1 Stigmer Credit = $0.01 USD. Internal storage in integer micro-USD (1 USD = 1,000,000 micros). |
| **Pricing source of truth** | Keep `model-registry.json` as provider cost. Apply customer pricing via a versioned billing policy at deduction time. Never overwrite `estimated_cost_usd`. |
| **Credit ledger** | Custom MongoDB ledger inside `stigmer-service`. Do NOT use Stripe Customer Balance or Stripe Billing Credits. |
| **Margin strategy** | Margin at billing layer, varying by harness and cost tier. Native: economy 1.35x, standard 1.25x, premium 1.15x. Cursor: 1.05–1.10x. |
| **Stripe products** | Stripe Checkout (one-time), saved PaymentMethods + off-session PaymentIntents (auto-recharge), Stripe Tax (checkout). No Subscriptions for recharge. |
| **Enforcement model** | Reservation + incremental settlement: reserve at execution start, debit per LLM call, release unused at end. Small managed overage for paid orgs. |
| **Billing bounded context** | Inside `stigmer-service` as a billing module (not a separate microservice). Extract later if needed. |
| **Free tier** | $5 promotional credits (500 credits), 30-day expiry, economy/standard models only, Cursor Harness gated behind payment method. |
| **Credit packs** | Simplified to 3 purchasable packs (Starter $10, Growth $50, Team $200) + auto-granted trial. No volume bonuses at launch. Larger amounts via Enterprise/Contact Sales. |
| **Repo workflow** | Protos in `stigmer` OSS repo → `make codegen`. Java stubs in `stigmer-cloud` → `make protos`. |
| **Phase ordering** | Sequential Phase 0→6 as planned. |

---

## Phase 0 — Pricing Policy & Schema Design

**Goal**: Define the billing data model, pricing policy structure, and proto contracts. No Stripe yet.

### 0.1 Model Registry Enhancement
- [ ] Add `providerCost` and `billingPolicy` sections to `model-registry.json` entries
- [ ] Keep existing `pricing` field as-is for backward compatibility during migration
- [ ] Add `effectiveAt` timestamp and `source` to provider cost entries
- [ ] Add `policyId`, `markupMultiplier`, `billablePriceMode`, `minimumChargeMicros` to billing policy

### 0.2 Proto Definitions (in `stigmer` OSS repo, `apis/`)
- [ ] Define `BillingUsage` message (pricing_policy_id, currency, provider_cost_micros, billable_amount_micros, credits_debited, markup_multiplier)
- [ ] Define billing RPC service in a new bounded context (`apis/ai/stigmer/billing/v1/`)
- [ ] Define request/response messages for: `GetBillingAccount`, `GetCreditBalance`, `GetCreditLedger`, `PurchaseCredits`, `AuthorizeExecution`, `ReportUsage`, `FinalizeExecution`
- [ ] Define enums: `LedgerEntryType`, `CreditGrantKind`, `BillingAccountStatus`, `ReservationStatus`
- [ ] Run `buf lint` and `buf breaking`

### 0.3 Integer Micros Library
- [ ] Create a shared micro-USD arithmetic library (Java) for billing calculations
- [ ] No floating-point in ledger operations — all amounts in `int64` micros
- [ ] Rounding rules: `NEAREST_MICRO` for billable amounts

### 0.4 Billing Policy v1
- [ ] Define `billing_policies` data model with versioning
- [ ] Create initial policy versions:
  - `native-economy-v1`: multiplier 1.35
  - `native-standard-v1`: multiplier 1.25
  - `native-premium-v1`: multiplier 1.15
  - `cursor-standard-v1`: multiplier 1.10
  - `cursor-max-v1`: multiplier 1.05
- [ ] Support model-specific and org-specific overrides

### 0.5 Credit Pack Definitions
- [ ] Define 3 self-serve credit packs (no volume bonuses at launch — clean 1 credit = $0.01):
  - Starter: $10 → 1,000 credits
  - Growth: $50 → 5,000 credits
  - Team: $200 → 20,000 credits
- [ ] Trial credits: 500 credits ($5) auto-granted on org creation, 30-day expiry, not a purchasable pack
- [ ] Larger amounts ($500+) handled via Enterprise / Contact Sales flow
- [ ] Define promotional vs. purchased credit properties (expiry, priority, burn order)

**Deliverables**: Updated model-registry.json schema, billing proto definitions, billing policy v1, micro-USD library.

---

## Phase 1 — Ledger MVP

**Goal**: Build the core credit ledger in MongoDB with manual credit management. No Stripe, no enforcement yet.

### 1.1 MongoDB Collections
- [ ] `billing_accounts` — one per org (orgId, stripeCustomerId, status, balanceMicros, availableBalanceMicros, reservedBalanceMicros, promotionalBalanceMicros, purchasedBalanceMicros, allowedNegativeBalanceMicros, lowBalanceThresholdMicros, autoRecharge config)
- [ ] `credit_ledger_entries` — append-only immutable ledger (entryId, orgId, type, amountMicros, balanceAfterMicros, idempotencyKey, source, rating, createdAt)
- [ ] `credit_grants` — track expiry and consumption buckets (orgId, kind, originalAmountMicros, remainingAmountMicros, expiresAt, priority, status)
- [ ] `credit_purchases` — payment-to-credit mapping (purchaseId, orgId, checkoutSessionId, paymentIntentId, amountPaid, creditsGrantedMicros, status)
- [ ] `billing_policies` — versioned pricing policies
- [ ] Indexes per the research data model specification

### 1.2 Billing Domain Services (Java, stigmer-service)
- [ ] `BillingAccountService` — create/get/update billing accounts
- [ ] `CreditLedgerService` — append ledger entries, compute balance, burn-order logic (promotional first, then purchased by expiry)
- [ ] `BillingPolicyService` — resolve active policy for harness + costTier + model
- [ ] `UsageRatingService` — apply billing policy to provider cost, produce billable amount

### 1.3 gRPC API Implementation
- [ ] `GetBillingAccount(orgId)` — return billing account with current balance
- [ ] `GetCreditLedger(orgId, pagination, filters)` — return ledger entries
- [ ] `AdjustCredits(orgId, amount, reason)` — admin manual credit adjustment (for testing and support)
- [ ] `GetOrgBillingUsage(orgId, dateRange)` — billing-enriched usage report

### 1.4 Mongock Migrations
- [ ] Migration scripts for all new collections
- [ ] Seed initial billing policies

**Deliverables**: Working credit ledger with manual admin credits, billing account per org, ledger query APIs.

---

## Phase 2 — Execution Enforcement MVP

**Goal**: Gate execution start on credit balance. Debit per LLM call. Stop execution when credits exhausted.

### 2.1 Execution Authorization
- [ ] `AuthorizeExecution(orgId, executionId, harness, expectedCap)` — check balance, create reservation
- [ ] `execution_reservations` collection (reservationId, orgId, executionId, reservedMicros, consumedMicros, status, expiresAt)
- [ ] Default reservation: $1.00, minimum start threshold: $0.05
- [ ] Free orgs: no overage allowed. Paid orgs: up to $2 negative balance. Enterprise: contract-specific.

### 2.2 Per-LLM-Call Usage Reporting
- [ ] `ReportLlmCallUsage(executionId, sequence, usageSnapshot)` — called from agent runner after each LLM call
- [ ] Dedupe by `(executionId, sequence)` unique index
- [ ] Read provider cost from usage snapshot, apply billing policy, compute billable amount
- [ ] Atomic debit: update `credit_ledger_entries` + `credit_grants` + `billing_accounts.balanceMicros` in single Mongo transaction
- [ ] Return: new balance, warning/stop signal

### 2.3 Execution Finalization
- [ ] `FinalizeExecutionUsage(executionId)` — release unused reservation, settle any overage
- [ ] `usage_billing_records` collection — final per-execution summary with provider cost, billable amount, policy IDs
- [ ] Mark reservation as FINALIZED

### 2.4 Agent Runner Integration (Python)
- [ ] Add billing reporting hook to `UsageTracker.record_llm_call()` — after computing provider cost, call billing service to report usage
- [ ] Handle billing response signals: CONTINUE, LOW_BALANCE_WARNING, STOP
- [ ] On STOP signal, integrate with existing `CostCapMiddleware` pattern to inject graceful stop SystemMessage
- [ ] New execution end reason: `BILLING_EXHAUSTED`

### 2.5 Temporal Workflow Integration
- [ ] Add `AuthorizeExecution` call before dispatching to runner
- [ ] Add `FinalizeExecution` call after runner completes
- [ ] Handle authorization denial (execution rejected, user notified)

### 2.6 `billable_usage_events` Collection
- [ ] Store deduped per-call debits with: orgId, executionId, sequence, agentId, sessionId, harness, model, providerCostMicros, customerCostMicros, pricingPolicyVersion, timestamp

**Deliverables**: Executions gated on credit balance, per-call debit pipeline, graceful billing exhaustion, runner integration.

---

## Phase 3 — Stripe Credit Purchases

**Goal**: Customers can buy credits via Stripe Checkout. Real money in, credits provisioned.

### 3.1 Stripe Customer Management
- [ ] Create Stripe Customer per org on first billing interaction
- [ ] Store mapping in `billing_accounts.stripeCustomerId`
- [ ] Sync billing email and tax ID

### 3.2 Stripe Checkout Integration
- [ ] `CreateCreditCheckoutSession(orgId, packId, successUrl, cancelUrl)` RPC
- [ ] Create Checkout Session with `mode=payment`, line item for credit pack, `automatic_tax[enabled]=true`, `payment_intent_data.setup_future_usage=off_session`
- [ ] Store `credit_purchases` record with status PENDING
- [ ] Metadata: orgId, purchaseIntentId, creditsGrantedMicros

### 3.3 Webhook Handler
- [ ] `stripe_webhook_events` collection — unique index on `stripeEventId` for idempotency
- [ ] Handle `checkout.session.completed` and `checkout.session.async_payment_succeeded` → idempotent credit provisioning
- [ ] Handle `checkout.session.async_payment_failed` → mark purchase failed
- [ ] Handle `charge.refunded` → reverse credits
- [ ] Handle `charge.dispute.created` → hold/freeze credits
- [ ] Handle `charge.dispute.closed` → release or remove credits
- [ ] Verify webhook signatures
- [ ] Acknowledge 200 fast, process asynchronously

### 3.4 Billing Page UI (React, web console)
- [ ] Replace "Coming Soon" placeholder with real billing page
- [ ] Show: current credit balance, credit pack purchase buttons, recent transactions
- [ ] Stripe Checkout redirect and return handling
- [ ] Low balance indicator

### 3.5 Reconciliation Job
- [ ] Background job to scan Stripe checkout sessions / payment intents that succeeded but may have missed webhook
- [ ] Detect and fix missed credit provisioning

**Deliverables**: Working Stripe Checkout purchase flow, webhook handling, billing page UI, reconciliation.

---

## Phase 4 — Auto-Recharge

**Goal**: Customers can save a payment method and auto-recharge when balance drops below threshold.

### 4.1 Payment Method Management
- [ ] Save payment method via Checkout `setup_future_usage=off_session` or explicit SetupIntent
- [ ] `billing_accounts.defaultPaymentMethodId` storage
- [ ] UI for managing saved payment methods

### 4.2 Auto-Recharge Configuration
- [ ] Config fields: enabled, thresholdMicros, targetMicros, amountMicros, monthlyCapMicros, currentMonthChargedMicros
- [ ] `SetAutoRechargeConfig(orgId, config)` RPC
- [ ] UI for configuring auto-recharge threshold and target

### 4.3 Recharge Trigger
- [ ] When balance drops below threshold during usage debit, trigger recharge
- [ ] Single in-flight recharge lock (prevent duplicate charges)
- [ ] Create off-session PaymentIntent with saved payment method
- [ ] Monthly cap enforcement
- [ ] Cooldown between attempts

### 4.4 Recharge Failure Handling
- [ ] Handle `payment_intent.payment_failed` → mark recharge failed, notify admins
- [ ] Disable auto-recharge after N consecutive failures
- [ ] Email notification to billing contacts
- [ ] Allow balance to run down to hard stop if recharge fails

### 4.5 Webhook Handling for Recharge
- [ ] Handle `payment_intent.succeeded` for recharge PaymentIntents → idempotent credit provisioning
- [ ] Recharge event log for audit

**Deliverables**: Auto-recharge with saved payment methods, failure handling, monthly caps.

---

## Phase 5 — Dashboard & Analytics

**Goal**: Rich usage dashboard with balance, spend, projections, and per-agent breakdown.

### 5.1 Balance & Spend Dashboard
- [ ] Real-time credit balance display
- [ ] Credits spent today / this week / this month
- [ ] Projected runway at current 7-day average ("credits will last X days")
- [ ] Auto-recharge status indicator
- [ ] Low balance warnings

### 5.2 Usage Breakdown
- [ ] Per-agent spend breakdown
- [ ] Per-model spend breakdown
- [ ] Harness split: Native vs. Cursor
- [ ] Daily cost trend chart
- [ ] Execution list with cost column

### 5.3 Alerts & Notifications
- [ ] Low balance email notifications (configurable threshold)
- [ ] Auto-recharge success/failure emails
- [ ] Budget exceeded notifications
- [ ] In-product warning banners

### 5.4 Cost Calculator
- [ ] Interactive calculator: inputs = executions/day, LLM calls/execution, avg tokens, model, harness
- [ ] Outputs = cost/execution, monthly estimate, recommended credit pack, runway by pack
- [ ] Publish on pricing page

### 5.5 CSV Export
- [ ] Export usage history for accounting/finance
- [ ] Export credit ledger for audit

**Deliverables**: Full usage dashboard, alerts, cost calculator, CSV export.

---

## Phase 6 — Enterprise Billing & Polish

**Goal**: Enterprise invoicing, contracted pricing, multi-environment budgets, legal/tax/compliance.

### 6.1 Enterprise Invoicing
- [ ] PO/invoice payment mode (Stripe Invoices)
- [ ] Contracted credit grants with custom terms (no expiry or contract-term expiry)
- [ ] Custom negative balance limits per enterprise contract
- [ ] Consolidated invoicing for multi-org enterprises

### 6.2 Committed-Use Discounts
- [ ] Custom pricing policy versions per enterprise org
- [ ] Volume discount multipliers
- [ ] Enterprise rate card management

### 6.3 Multi-Environment Budgets
- [ ] Optional per-agent budget caps
- [ ] Per-environment budget allocation (future)
- [ ] Admin controls: budget alerts, hard stops per agent

### 6.4 Pricing Page
- [ ] Public pricing page with: Free trial, PAYG packs, model pricing table (Stigmer prices, not raw provider), platform usage, Enterprise CTA
- [ ] Model pricing table showing input/output/cache rates per harness and model

### 6.5 Legal & Compliance
- [ ] ToS clauses: credits are not stored value/gift cards, non-refundable, 12-month expiry, price change notice, overage disclosure
- [ ] SOC2 controls: append-only ledger, immutable usage records, webhook archive, admin adjustment approvals, role-based billing permissions, audit log
- [ ] Revenue recognition: treat credit purchases as deferred revenue, recognize on usage consumption
- [ ] Stripe Tax integration review with tax counsel

### 6.6 Credit Expiry Job
- [ ] Background job to expire credits past their expiry date
- [ ] Debit expired credit amounts from grants and balance
- [ ] Ledger entry type: `EXPIRY_DEBIT`
- [ ] Notification before expiry (30 days, 7 days)

**Deliverables**: Enterprise invoicing, custom pricing, budgets, pricing page, legal/compliance, credit expiry.

---

## Risk Mitigations (built into implementation)

| Risk | Mitigation |
|---|---|
| Double-crediting on webhook retries | Unique `stripeEventId` index + idempotency keys |
| Double-debiting usage | Unique `(executionId, sequence)` index |
| Execution overrun | Reservation + per-call debit + small managed overage |
| Race conditions on balance | Atomic MongoDB conditional updates |
| Floating-point drift | Integer micros only, never float in ledger |
| Cursor cost attribution | Bill Cursor cost × low multiplier, mark attribution confidence |
| Provider price changes | Provider rates + policy version stamped at execution time |
| Refund/dispute | Reverse/hold credits on Stripe charge events |

---

## Success Criteria

- [ ] Orgs can purchase credit packs ($10–$200) via Stripe Checkout
- [ ] Credits are deducted in real-time per LLM call during agent execution
- [ ] Executions are blocked when credits are exhausted (graceful stop)
- [ ] Auto-recharge works with saved payment methods and monthly caps
- [ ] Billing dashboard shows balance, spend, per-agent/model/harness breakdown
- [ ] Enterprise orgs can use invoiced billing with contracted pricing
- [ ] All ledger operations are idempotent and auditable
- [ ] Pricing transparency: 1 credit = $0.01 USD, per-model rates published
- [ ] Margin applied per billing policy without corrupting provider cost data

---

## Review Log

**2026-05-03 — APPROVED** with the following decisions:
- Margins: approved as recommended (1.35x economy, 1.25x standard, 1.15x premium, 1.05–1.10x Cursor). Will revisit based on customer feedback.
- Credit denomination: approved as 1 credit = $0.01 USD. Will revisit based on customer feedback.
- Credit packs: simplified from 6 to 3 purchasable packs (Starter $10, Growth $50, Team $200) + auto-granted trial. No volume bonuses at launch. Rationale: reduce decision fatigue for an early product. Larger amounts via Enterprise/Contact Sales.
- Credit packs are NOT feature plans — they are one-time top-ups. Feature-gated plans (Free/Pro/Enterprise) are a separate future concern.
- Repo workflow: protos in `stigmer` OSS → `make codegen`; Java stubs in `stigmer-cloud` → `make protos`.
- Phase ordering: approved as-is (Phase 0→6 sequential).

**Next step**: Begin Phase 0 execution.
