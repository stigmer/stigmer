# Auto-Recharge Trigger + Webhook Handling (Phase 4.3)

**Date**: May 6, 2026

## Summary

Implemented the auto-recharge trigger pipeline for the prepaid credit billing system. When a usage debit drops an org's available balance below their configured threshold, the system atomically claims a monthly cap slot, creates an off-session Stripe PaymentIntent asynchronously, and provisions credits when the payment webhook confirms success. This completes Phase 4 (Auto-Recharge) of the Stripe billing integration.

## Problem Statement

With Phases 4.1 (payment method management) and 4.2 (auto-recharge configuration) complete, users could save payment methods and configure recharge thresholds, but the system had no mechanism to actually trigger recharges. An active execution could exhaust credits and be forced to stop gracefully, requiring the user to manually purchase more credits before starting another execution.

### Pain Points

- Executions could be interrupted by credit exhaustion despite the user having a saved payment method and recharge config
- No automated credit replenishment path — manual checkout purchases were the only option
- Missing webhook infrastructure for Stripe PaymentIntent events (success/failure)
- No failure compensation for the monthly cap counter when Stripe charges fail

## Solution

A four-stage pipeline integrated into the existing billing lifecycle:

1. **Evaluate** (synchronous, in the debit path): After each usage debit that triggers a `low_balance_warning` or `stop_execution` signal, check the org's auto-recharge config with zero overhead on healthy-balance calls
2. **Claim** (atomic CAS): Prevent duplicate recharges across concurrent LLM calls via a MongoDB `findAndModify` with `$expr` guard on the monthly cap counter
3. **Execute** (async): Create a confirmed off-session Stripe PaymentIntent on a dedicated thread pool, isolated from the proxy hot path
4. **Provision** (webhook-driven): Credits appear only after `payment_intent.succeeded` fires — conservative, correct, no optimistic provisioning

## Implementation Details

### Proto Changes (stigmer OSS)
- `AutoRechargeEventStatus` enum: `pending`, `succeeded`, `failed`
- `AutoRechargeEvent` message: lifecycle tracking for recharge attempts (event_id, org_id, amount_micros, credits_micros, payment_intent_id, status, failure_reason, idempotency_key)

### MongoDB Infrastructure (stigmer-cloud)
- `auto_recharge_event` collection via Mongock migration (order 027)
- 4 indexes: event_id unique, payment_intent_id unique sparse, (org_id, status), (status, created_at)

### Domain Services
- **`AutoRechargeService`**: Core service with `evaluateAndTrigger()`, `executeRecharge()`, `provisionRechargeCredits()`, `compensateFailedRecharge()`
- **`AutoRechargeEventRepo`**: Proto-JSON MongoDB repo following the `CreditPurchaseRepo` pattern
- **3 atomic `BillingAccountRepo` methods**: `atomicResetRechargeMonthIfNeeded` (lazy month rollover), `atomicClaimRechargeSlot` ($expr CAS), `atomicReleaseRechargeSlot` (failure compensation)
- **`CreditLedgerService.provisionCredits()`**: Parameterized entry type — `adjustCredits()` refactored to delegate, enabling `auto_recharge_credit` ledger entries

### Trigger Integration
- Hooked into `ExecutionBillingService.reportLlmCallUsage()` after signal computation
- Wrapped in try-catch — auto-recharge evaluation failure never affects the billing response
- Fast-exit checks (all in-memory): disabled? above threshold? no PM? inactive account? no Stripe customer?

### Webhook Extension
- `payment_intent.succeeded`: metadata-routed provisioning via `stigmer_recharge_event_id`
- `payment_intent.payment_failed`: cap slot compensation + event FAILED
- No conflict with checkout — checkout uses `checkout.session.completed`

### Async Executor
- Dedicated `ThreadPoolTaskExecutor` (core=2, max=4, queue=100)
- `DiscardPolicy` — pool saturation silently drops the task; next balance check re-evaluates

### Incidental Fixes
- `ExecutionBillingService.reportLlmCallUsage()` return type: replaced deleted `ReportLlmCallUsageResponse` proto with domain record `UsageDebitResult`
- `ProxyScopeResult.UNSCOPED`: fixed package-private visibility to public

## Benefits

- **Zero-friction credit replenishment**: Executions on paid accounts with saved payment methods automatically recharge credits
- **No execution interruption on healthy accounts**: The 5-30 second webhook delay is acceptable — current execution may stop, but the next starts with new credits
- **Robust concurrency handling**: Atomic CAS prevents duplicate charges even under concurrent LLM calls
- **Monthly spend control**: Cap enforcement prevents runaway charges; lazy month reset avoids cron jobs
- **Failure resilience**: Immediate cap slot rollback on Stripe errors ensures failed attempts don't permanently consume the monthly cap

## Impact

- **Users**: Paid users with auto-recharge enabled get uninterrupted agent execution workflows
- **Revenue**: Reduces friction on the pay-as-you-go path — credits are replenished automatically
- **Operations**: `auto_recharge_event` collection provides audit trail and reconciliation foundation
- **Stripe Dashboard**: Requires registering `payment_intent.succeeded` and `payment_intent.payment_failed` events

## Related Work

- Phase 4.1: Payment Method Management (saved via `setup_future_usage=off_session`)
- Phase 4.2: Auto-Recharge Configuration (SetAutoRechargeConfig RPC)
- Phase 3.3: Stripe Webhook Handler (extended with 2 new event types)
- Phase 3.5: Reconciliation Cron Workflow (can be extended for stuck PENDING recharge events)
- Sub-project: Proxy-Side Billing Metering (provides the `reportLlmCallUsage` trigger point)

---

**Status**: Production Ready
**Timeline**: Phase 4 complete (5/5 sub-phases)
