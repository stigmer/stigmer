# Stripe Webhook Handler for Credit Provisioning (Phase 3.3)

**Date**: May 3, 2026

## Summary

Implemented the Stripe webhook handler that receives `checkout.session.completed` events and provisions credits to the customer's billing account. This completes the credit purchase lifecycle: users buy credits via Stripe Checkout, Stripe sends a webhook confirming payment, and the system automatically provisions credits with double-idempotency guarantees.

## Problem Statement

Phase 3.2 implemented Stripe Checkout integration — users can create checkout sessions and pay on Stripe's hosted page. However, after payment, credits were NOT provisioned. The `CreditPurchase` record stayed in `PENDING` status because no component existed to receive the payment confirmation from Stripe and complete the purchase.

### Pain Points

- Users could pay but never receive credits (PENDING forever without webhook handling)
- No mechanism to receive payment confirmation from Stripe's infrastructure
- No idempotency protection against Stripe's at-least-once delivery semantics
- No handling of async payment methods (ACH), failed payments, or expired sessions

## Solution

Added a Stripe webhook HTTP endpoint (`POST /webhook/stripe`) to the existing Spring Boot HTTP server (port 8081) in stigmer-service. The endpoint verifies Stripe's cryptographic signature, deduplicates events via a MongoDB collection, and provisions credits through the existing `CreditLedgerService.adjustCredits()` pipeline.

## Implementation Details

### New Files (stigmer-cloud)

**Migration:**
- `U20260503g_StripeWebhookEventCollection.java` — Mongock migration (order 026) creating `stripe_webhook_event` collection with unique `event_id` index for dedup and `(event_type, created_at desc)` compound index

**Repo:**
- `StripeWebhookEventRepo.java` — `insertIfAbsent(eventId, eventType)` returns true/false for atomic dedup via unique index; `markProcessed()` and `markFailed()` for lifecycle tracking

**Controller:**
- `StripeWebhookController.java` — Spring `@RestController` accepting raw body + `Stripe-Signature` header, verifying via `Webhook.constructEvent()`, routing to service

**Service:**
- `StripeWebhookService.java` — Handles 4 event types:
  - `checkout.session.completed` / `async_payment_succeeded` → provision credits
  - `checkout.session.async_payment_failed` → mark FAILED
  - `checkout.session.expired` → mark EXPIRED

**Tests (20 total):**
- `StripeWebhookServiceTest.java` — 11 tests (happy path, dedup, already-completed, not-found, null payment intent, async succeeded, failed/expired paths, unknown events)
- `StripeWebhookControllerTest.java` — 4 tests (valid webhook, invalid signature, missing secret, service exception)
- `StripeWebhookEventRepoTest.java` — 5 tests (new event, Spring/MongoDB duplicate, markProcessed, markFailed)

### Modified Files

- `HttpSecurityConfig.java` — Added `/webhook/stripe` to `permitAll()` (signature verification replaces JWT auth)
- `BUILD.bazel` — Added 3 new `java_junit5_test` targets

### Credit Provisioning Algorithm

1. Verify Stripe signature (reject bad signatures with 400)
2. Dedup by event_id (unique index on `stripe_webhook_event`)
3. Resolve `CreditPurchase` by `checkout_session_id`
4. Guard: skip if purchase already COMPLETED
5. Set `payment_intent_id` on purchase record
6. Provision credits via `CreditLedgerService.adjustCredits()`
7. Transition purchase status to COMPLETED
8. Mark webhook event as processed

### Security Model

Stripe webhooks don't use Bearer tokens or API keys. Every event is signed with an HMAC-SHA256 signature using a per-endpoint signing secret (`whsec_...`). The controller verifies this signature via `Webhook.constructEvent()` before processing. The `/webhook/stripe` path is `permitAll()` in Spring Security — the cryptographic verification is the auth mechanism.

## Benefits

- **End-to-end credit purchase flow**: Users buy → Stripe collects → webhook provisions credits → balance updated
- **Double idempotency**: Event-level dedup AND purchase status guard prevent double-crediting even under Stripe retries
- **Async payment support**: ACH and bank transfer payments handled via `async_payment_succeeded`
- **Failure handling**: Failed and expired sessions properly transition purchase records
- **No new infrastructure**: Webhook endpoint lives in the existing Spring Boot HTTP server — no workers, queues, or separate services

## Impact

- Billing team: Credit purchase lifecycle is now complete (PENDING → COMPLETED/FAILED/EXPIRED)
- Operations: Manual Stripe Dashboard setup required per environment (one-time)
- Security: New public endpoint — secured by Stripe signature verification, not network-level controls

## Related Work

- Phase 3.1: Stripe Customer Management (prerequisite)
- Phase 3.2: Stripe Checkout Integration (creates the PENDING purchases this webhook fulfills)
- Phase 3.4: Billing page UI (next — can now show real credit balances after purchase)
- Phase 3.5: Reconciliation job (safety net for missed webhooks)

---

**Status**: Production Ready
**Timeline**: Phase 3.3 of 7-phase billing implementation
