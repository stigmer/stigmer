# Payment Method Management — Phase 4.1

**Date**: May 3, 2026

## Summary

Implemented the payment method management foundation for the Stigmer billing system. Users' payment methods are captured automatically after their first credit purchase and can be managed via the Stripe Customer Portal. This phase establishes the infrastructure that Phase 4.2-4.5 (auto-recharge) builds on — without a saved payment method, off-session charging is impossible.

## Problem Statement

After Phase 3 (Stripe Credit Purchases), users could buy credits via Stripe Checkout, but there was no mechanism to:
- Persist the payment method used for future charges
- Display the saved card in the billing UI
- Allow users to manage (add/remove/update) their payment methods
- Enable off-session charges needed for auto-recharge (Phase 4.3)

### Pain Points

- Payment methods were attached to Stripe Customers via `setup_future_usage=off_session` during checkout, but never tracked on the BillingAccount
- No way for users to see or manage their saved cards
- No foundation for the auto-recharge trigger (Phase 4.3) to create off-session PaymentIntents
- Building custom card management UI would be a significant PCI compliance burden

## Solution

Adopted the **Stripe Customer Portal** approach (used by Vercel, Linear, Supabase) for payment method management, combined with automatic payment method capture after checkout. The approach minimizes code surface while maximizing security — Stripe handles all PCI-sensitive card entry and 3DS/SCA challenges.

### Design Decision: PaymentMethodSummary on BillingAccount

Added `PaymentMethodSummary` as a top-level field on `BillingAccount` (field 11), not inside `AutoRechargeConfig`. A saved payment method is an account-level concept that exists independently of auto-recharge configuration. The pre-existing `AutoRechargeConfig.default_payment_method_id` (field 6) defined in Phase 0 remains unused — auto-recharge (Phase 4.3) will reference `BillingAccount.default_payment_method.payment_method_id` instead.

## Implementation Details

### Proto Changes (stigmer OSS)

- **New message**: `PaymentMethodSummary` in `billing_account.proto` — stores card display metadata (payment_method_id, brand, last4, exp_month, exp_year) to avoid Stripe API calls on every page load
- **New field**: `BillingAccount.default_payment_method` (field 11) — top-level, account-scoped
- **New RPC**: `createBillingPortalSession` on `BillingCommandController` — authorized with `can_manage_billing`, returns Stripe-hosted Portal URL
- **New IO messages**: `CreateBillingPortalSessionInput` (org_id, return_url) and `CreateBillingPortalSessionResponse` (portal_url)
- Generated stubs across Go, Java, Python, TypeScript, Dart via `make codegen`

### Backend (stigmer-cloud)

**New service — `StripePortalService`**:
- Creates Stripe Billing Portal sessions with Stripe Customer existence guard
- Custom exceptions: `NoStripeCustomerException`, `StripePortalException`
- Follows `@Autowired(required = false) StripeClient` pattern for environments without Stripe

**New handler — `CreateBillingPortalSessionHandler`**:
- Full pipeline: validateFieldConstraints → extractResourceId → authorize → createPortalSession → sendResponse
- Error mapping: no customer → `FAILED_PRECONDITION`, Stripe failure → `INTERNAL`

**Enhanced `BillingAccountRepo`** — 2 new atomic methods:
- `atomicSetDefaultPaymentMethod(orgId, pmId, brand, last4, expMonth, expYear)` — MongoDB `findAndModify` setting the `default_payment_method` sub-document
- `atomicClearDefaultPaymentMethod(orgId)` — `$unset` for PM removal via Portal

**Enhanced `StripeWebhookService`** — 3 new capabilities:
- **PM capture on checkout**: After `checkout.session.completed`, retrieves PaymentIntent → expands PaymentMethod → extracts card details → stores on BillingAccount → sets as Stripe Customer default. Best-effort (non-fatal to credit provisioning).
- **`customer.updated` handler**: Syncs default PM changes from Stripe Customer Portal back to BillingAccount. Handles both PM change and PM removal.
- **`payment_method.attached` handler**: Auto-sets default PM when user adds first card via Portal (only if no existing default — prevents overwriting intentional defaults).
- Refactored `extractCheckoutSession()` → generic `extractEventData(event, Class<T>)` for type-safe event deserialization across all event types.

### SDK and UI (stigmer OSS)

**TypeScript SDK (`@stigmer/sdk`)**:
- `BillingClient.createBillingPortalSession(params)` — new method following existing `wrapError` pattern
- `CreateBillingPortalSessionParams` interface exported

**React SDK (`@stigmer/react`)**:
- `useCreateBillingPortalSession` hook — behavior hook matching `useCreateCheckoutSession` pattern; redirects to Portal URL on success
- `PaymentMethodCard` component — read-only card display (brand, last4, expiry) with "Manage" button for Portal redirect; empty state prompts first purchase; disabled on suspended/closed accounts
- `BillingSection` updated to insert `PaymentMethodCard` between balance card and credit pack grid
- Barrel exports updated in `sdk/react/src/billing/index.ts` and `sdk/react/src/index.ts`

### Testing

- `StripePortalServiceTest` — 5 tests: happy path, no customer, account not found, Stripe failure, Stripe not configured
- Existing `StripeWebhookServiceTest` (11 tests) — updated constructor for new dependencies, all pass
- Existing `BillingAccountRepoTest` (9 tests) and `StripeCheckoutServiceTest` (12 tests) — pass unchanged
- TypeScript compilation verified across `@stigmer/sdk`, `@stigmer/react`, `client-apps/web`

### Stripe Dashboard Configuration

- Webhook events `customer.updated` and `payment_method.attached` registered on existing endpoint
- Billing Portal configured: payment methods enabled, subscriptions disabled, invoice history disabled
- Branding applied: Stigmer logo (dark), black (#000000) brand and accent colors

## Benefits

- **Zero PCI scope increase**: All card entry handled by Stripe Portal — no card numbers touch Stigmer servers or UI
- **Automatic PM capture**: After first purchase, the card is saved without any user action
- **Portal for management**: Industry-standard approach used by Vercel, Linear, Supabase — users trust Stripe's UI
- **Foundation for auto-recharge**: `default_payment_method` on BillingAccount is exactly what Phase 4.3 needs to create off-session PaymentIntents
- **Best-effort resilience**: PM capture failure during checkout does not block credit provisioning

## Impact

- **Users**: See saved card in billing settings, can manage via Portal
- **Backend**: 6 webhook event types handled (was 4), 11 gRPC RPCs handler-wired (was 10)
- **SDK**: 1 new client method, 1 new hook, 1 new component, all exported
- **Ops**: 2 new webhook events registered, Portal configured in Stripe Dashboard

## Related Work

- **Phase 3 (Stripe Credit Purchases)**: Established `setup_future_usage=off_session` on Checkout Sessions — Phase 4.1 captures the resulting payment method
- **Phase 4.2 (Auto-Recharge Config)**: Will add `SetAutoRechargeConfig` RPC and UI
- **Phase 4.3 (Recharge Trigger)**: Will use `BillingAccount.default_payment_method` for off-session PaymentIntents

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes implementation)
