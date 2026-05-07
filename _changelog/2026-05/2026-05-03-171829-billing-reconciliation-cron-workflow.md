# Billing Reconciliation Cron Workflow (Phase 3.5)

**Date**: May 3, 2026

## Summary

Implemented a Temporal cron workflow that periodically scans for PENDING credit purchases whose Stripe webhooks may have been missed, reconciles their state by querying the Stripe API directly, and idempotently provisions credits for completed payments. This is the safety net that ensures customers always receive their credits even when webhook delivery fails.

## Problem Statement

After a successful Stripe Checkout payment, credits are provisioned via the `checkout.session.completed` webhook. If Stripe fails to deliver the webhook (network issues, deployment during delivery, webhook endpoint downtime), the customer has paid but credits are never provisioned. Without a reconciliation mechanism, customer trust erodes and manual intervention is required.

### Pain Points

- Webhook delivery is at-least-once but not guaranteed-exactly-once within a tight SLA
- Network outages or service restarts during webhook delivery leave customers without credits
- Orphaned PENDING records (from failed Stripe API calls) accumulate without cleanup
- Manual detection of missed webhooks requires operational overhead

## Solution

A Temporal cron workflow running every 5 minutes that:
1. Queries MongoDB for PENDING purchases older than a configurable threshold (10 min)
2. For each stale purchase, retrieves the corresponding Stripe Checkout Session
3. Routes by session state: complete+paid → provision credits, expired → mark expired, open → skip
4. Handles orphaned purchases (no checkout_session_id after 60 min) by marking them FAILED

The workflow uses the same `purchase_{id}` idempotency key as the webhook handler, making it impossible to double-credit regardless of race conditions.

## Implementation Details

### Architecture

- **First Temporal cron workflow** in the codebase — establishes the scheduling pattern for future periodic jobs (reservation expiry, IAM sync, etc.)
- **Dedicated `billing_reconciliation` task queue** — isolated from agent execution to prevent Stripe API latency from starving the execution path
- **Activity-per-purchase granularity** — each Stripe API call is an independent Temporal activity with its own retry policy (3 attempts, 10s/30s/60s backoff)

### New Components (stigmer-cloud)

| Component | Role |
|-----------|------|
| `BillingReconciliationWorkflow` | `@WorkflowInterface` — cron workflow contract |
| `BillingReconciliationWorkflowImpl` | Find-then-reconcile loop, summary logging |
| `ReconciliationActivities` | `@ActivityInterface` — find + reconcile methods |
| `ReconciliationActivitiesImpl` | Core logic: DB query, Stripe retrieval, credit provisioning |
| `BillingReconciliationWorkerConfig` | Registers workflow + activities on dedicated queue |
| `BillingReconciliationStarter` | `ApplicationRunner` — starts cron on boot (idempotent) |
| `BillingReconciliationConfig` | Configurable thresholds, schedule, feature flag |
| `BillingReconciliationTemporalConfig` | Task queue binding from application-temporal.yaml |
| `StalePurchaseRef` | Lean serializable record for Temporal history |
| `ReconciliationResult` | Activity outcome enum |

### Modified Components

- `CreditPurchaseRepo` — added `findPendingOlderThan(Instant)` ordered by created_at ASC
- `application.yaml` — reconciliation config section with env-var overrides
- `application-temporal.yaml` — new `billing-reconciliation.task-queue` entry
- `MODULE.bazel` — added `io.temporal:temporal-testing:1.31.0` for workflow tests
- `BUILD.bazel` — 2 new `java_junit5_test` targets

### Key Design Decisions

- **Temporal over @Scheduled**: Fixed workflow ID (`billing/reconciliation`) guarantees exactly-one cron instance globally across all service replicas. No distributed lock infrastructure needed.
- **Same idempotency key as webhook**: `purchase_{purchaseId}` means reconciliation and webhook are interchangeable — whichever arrives first provisions, the other is a no-op.
- **`adjustedBy = "stripe_reconciliation"`**: Audit trail distinguishes reconciliation-provisioned from webhook-provisioned credits while maintaining the same idempotency guarantee.
- **Feature flag**: `stigmer.billing.reconciliation.enabled` allows disabling without redeployment (environments without Stripe, maintenance windows).

## Benefits

- **Customer trust**: Credits are always provisioned within minutes of payment, regardless of webhook delivery
- **Zero manual intervention**: No operational overhead for missed webhooks
- **Audit clarity**: Ledger entries distinguish reconciliation-provisioned vs webhook-provisioned
- **Pattern establishment**: First Temporal cron workflow creates a reusable template for future periodic jobs
- **Isolation**: Dedicated task queue prevents cross-domain interference

## Impact

- **Billing domain** (stigmer-cloud): New reconciliation sub-package with full test coverage
- **Operations**: Reconciliation runs visible in Temporal UI for monitoring
- **Phase 3 complete**: All 5 sub-phases of Stripe Credit Purchases are now done
- **Phase 4 unblocked**: Auto-recharge can build on the same patterns

## Related Work

- Phase 3.3: Stripe webhook handler (the primary path this reconciles)
- Phase 3.2: Stripe Checkout integration (creates the PENDING records)
- Future: Reservation expiry cleanup job (will follow same Temporal cron pattern)

---

**Status**: Production Ready
**Timeline**: Single session implementation
**Tests**: 15 tests (11 unit + 4 Temporal integration), all passing
