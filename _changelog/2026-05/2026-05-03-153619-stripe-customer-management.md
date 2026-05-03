# Phase 3.1: Stripe Customer Management

**Date**: May 3, 2026

## Summary

Added Stripe Java SDK integration to stigmer-cloud and implemented lazy Stripe Customer provisioning per organization. This is the foundation for Phase 3.2 (Stripe Checkout) — every subsequent Stripe operation (credit purchases, auto-recharge, webhook handling) depends on having a linked Stripe Customer for the org.

## Problem Statement

The billing system (Phases 0–2) tracks credits, debits, and execution reservations entirely within Stigmer's MongoDB ledger. To accept real payments, Stigmer needs a Stripe Customer object linked to each organization so that Checkout Sessions, PaymentIntents, and webhook events can be correlated back to the org.

### Pain Points

- No Stripe SDK dependency existed in stigmer-cloud
- No mechanism to create or link a Stripe Customer to a billing account
- No configuration path for Stripe API credentials
- The existing `save()` method on BillingAccountRepo does a full document replace, which is unsafe for setting stripe_customer_id concurrently with balance mutations

## Solution

Lazy, idempotent Stripe Customer provisioning via `StripeCustomerService.ensureStripeCustomer()` — called as a prerequisite before any Stripe-requiring operation. Uses an atomic CAS (compare-and-swap) write on the `stripe_customer_id` field to handle concurrent requests safely.

## Implementation Details

### New Package: `ai.stigmer.domain.billing.stripe`

| Class | Role |
|-------|------|
| `StripeConfig` | `@ConfigurationProperties(prefix = "stigmer.stripe")` — binds `secret-key` and `webhook-secret` from env vars |
| `StripeClientProvider` | `@Configuration` producing a `StripeClient` bean, conditional on `stigmer.stripe.secret-key` being set |
| `StripeCustomerService` | Core service — `ensureStripeCustomer(orgId, billingEmail)` with fast-path, Stripe API creation, CAS write, and race recovery |

### ensureStripeCustomer Algorithm

1. Load BillingAccount (must already exist)
2. If `stripe_customer_id` populated → return immediately (fast path)
3. Create Stripe Customer via API with org metadata and billing email
4. CAS-write `stripe_customer_id` via `atomicSetStripeCustomerId`
5. If CAS fails (concurrent creation) → read back the winner's ID

### Atomic CAS on BillingAccountRepo

Added `atomicSetStripeCustomerId(orgId, stripeCustomerId)` using MongoDB `findAndModify` with guard: `org_id = X AND (stripe_customer_id IS NULL OR "" OR not exists)`. Only the first concurrent writer wins. Returns `Optional.empty()` on CAS failure.

### BillingAccountService Enhancement

Added `getByStripeCustomerId(stripeCustomerId)` — reverse lookup needed by Phase 3.3 webhook handler to resolve org from Stripe events.

### Build & Configuration

- Added `com.stripe:stripe-java:32.1.0` to `MODULE.bazel` (Maven) and `BUILD.bazel` (Bazel target deps)
- Added `stigmer.stripe.secret-key` and `stigmer.stripe.webhook-secret` to `application.yaml` with env-var placeholders
- Registered 2 new Bazel test targets (`billing_account_repo_test`, `stripe_customer_service_test`)

### Unit Tests (11 total)

**StripeCustomerServiceTest (8 tests):** happy path creation, fast-path return, CAS race recovery, Stripe API failure wrapping, account-not-found propagation, metadata/email verification, null email handling, Stripe-not-configured.

**BillingAccountRepoTest (3 new tests):** CAS success, CAS failure (already set), query guard verification.

## Benefits

- **Zero-impact on existing flows**: Stripe Customer creation is lazy — `getOrCreateBillingAccount` remains fast, idempotent, and free of external I/O
- **Concurrent-safe**: CAS prevents duplicate Stripe Customers from race conditions without requiring MongoDB transactions
- **Graceful degradation**: Service boots cleanly without Stripe credentials; missing config produces a clear StripeNotConfiguredException
- **Testable**: Modern StripeClient pattern (no global state) enables straightforward Mockito-based unit testing

## Impact

- **Billing domain**: 3 new files in `stripe/` sub-package, 2 modified service/repo files
- **Build system**: Stripe SDK added as a project-wide Maven dependency
- **Configuration**: 2 new env vars required for production (STIGMER_STRIPE_SECRET_KEY, STIGMER_STRIPE_WEBHOOK_SECRET)
- **Phase 3.2 unblocked**: `ensureStripeCustomer()` is the prerequisite for Stripe Checkout Session creation

## Related Work

- Phase 0: Proto definitions including `stripe_customer_id` on BillingAccount (already existed)
- Phase 1: MongoDB `billing_account` collection with sparse unique index on `stripe_customer_id` (already existed)
- Phase 3.2 (next): Stripe Checkout integration — will call `ensureStripeCustomer()` before creating Checkout Sessions

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes implementation)
**Files Changed**: 6 modified + 3 new in stigmer-cloud (143 lines added to existing files, ~350 lines in new files)
