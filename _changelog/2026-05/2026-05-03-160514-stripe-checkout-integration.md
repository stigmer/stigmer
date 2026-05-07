# Stripe Checkout Integration (Phase 3.2)

**Date**: May 3, 2026

## Summary

Implemented the Stripe Checkout purchase flow for Stigmer's prepaid credit billing system. Customers can now purchase credit packs (Starter $10, Growth $50, Team $200) via Stripe's hosted checkout page. This phase builds on the Phase 3.1 Stripe Customer Management foundation and creates the infrastructure for credit provisioning (Phase 3.3 webhook handler).

## Problem Statement

Stigmer's billing system had credit ledger, execution enforcement, and Stripe Customer management in place, but no way for customers to actually purchase credits. The platform needed a self-serve purchase flow that creates Stripe Checkout Sessions, tracks purchase lifecycle, and prepares metadata for webhook-driven credit provisioning.

### Pain Points

- No self-serve credit purchase flow — credits could only be added via admin adjustment
- No purchase tracking infrastructure — no way to correlate Stripe payments to credit provisioning
- No credit pack catalog — pack definitions existed only in proto messages, not as a queryable catalog

## Solution

End-to-end Stripe Checkout integration spanning proto contracts, a static credit pack catalog, a purchase lifecycle collection, a checkout orchestration service, and an authorized gRPC handler. The design follows a PENDING-first pattern where the purchase record is persisted before calling Stripe, ensuring no payment goes untracked.

## Implementation Details

### Proto Contract (stigmer OSS)
- `CreditPurchaseStatus` enum: PENDING, COMPLETED, FAILED, EXPIRED
- `CreditPurchase` message: 11 fields tracking purchase lifecycle from checkout to credit provisioning
- `CreateCreditCheckoutSessionInput`: org_id, pack_id, success_url, cancel_url (all required)
- `CreateCreditCheckoutSessionResponse`: checkout_url, purchase_id, checkout_session_id
- `createCreditCheckoutSession` RPC on `BillingCommandController` with `can_manage_billing` authorization

### Credit Pack Catalog (stigmer-cloud)
- Java constants class (`CreditPackCatalog`) with 3 static packs
- No database dependency — packs are product catalog entries, not user-editable resources
- `getPack(packId)` and `getActivePacks()` for lookup and listing

### Purchase Tracking (stigmer-cloud)
- `credit_purchase` MongoDB collection via Mongock migration (order 025)
- Indexes: `purchase_id` (unique), `checkout_session_id` (unique sparse), `(org_id, created_at desc)`, `(org_id, status)`
- `CreditPurchaseRepo` with proto-JSON pattern, CAS for checkout_session_id, lifecycle status transitions

### Checkout Orchestration (stigmer-cloud)
- `StripeCheckoutService.createCheckoutSession()`: validates pack, verifies account status, ensures Stripe Customer, inserts PENDING purchase, creates Stripe Checkout Session, links session ID
- Stripe Checkout Session configured with: `mode=payment`, `PriceData` (dynamic pricing), `automatic_tax`, `setup_future_usage=off_session` (saves card for Phase 4 auto-recharge)
- Session metadata carries `stigmer_org_id`, `stigmer_purchase_id`, `stigmer_pack_id`, `stigmer_credits_micros` for webhook reverse-lookup

### gRPC Handler (stigmer-cloud)
- `CreateCreditCheckoutSessionHandler` with full authorization pipeline
- Resolves caller email from IdentityAccount (server-side, not in RPC input)
- Error mapping: InvalidPack → INVALID_ARGUMENT, AccountNotFound → NOT_FOUND, Suspended/Closed → FAILED_PRECONDITION, StripeFailure → INTERNAL

### Unit Tests
- `CreditPackCatalogTest`: 8 tests (pack resolution, pricing, active status)
- `CreditPurchaseRepoTest`: 9 tests (insert, find, CAS, status transitions, BSON long storage)
- `StripeCheckoutServiceTest`: 12 tests (happy path, error cases, Stripe params verification, metadata, setup_future_usage)

## Benefits

- Customers can self-serve purchase credits via Stripe's trusted checkout experience
- Purchase lifecycle is fully tracked from initiation through completion
- Payment method saved on first purchase enables future auto-recharge (Phase 4)
- Metadata on Stripe sessions enables reliable webhook-driven credit provisioning (Phase 3.3)
- All billing tests pass with no regressions

## Impact

- **Billing domain**: 9 gRPC RPCs now handler-wired (was 8)
- **New package**: `ai.stigmer.domain.billing.catalog` for credit pack management
- **New collection**: `credit_purchase` with 4 indexes
- **Test coverage**: 29 new unit tests across 3 test files

## Related Work

- Phase 3.1: Stripe Customer Management (prerequisite — `ensureStripeCustomer`)
- Phase 3.3: Webhook handler for `checkout.session.completed` → credit provisioning (next)
- Phase 3.4: Billing page UI (React, replace "Coming Soon" placeholder)
- Phase 4: Auto-recharge via saved payment methods (`setup_future_usage=off_session` prepared here)

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
