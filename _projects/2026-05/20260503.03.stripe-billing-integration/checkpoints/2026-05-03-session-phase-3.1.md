# Session Notes: 2026-05-03 — Phase 3.1 (Stripe Customer Management)

## Accomplishments

- Added Stripe Java SDK (v32.1.0) to stigmer-cloud build system (MODULE.bazel + BUILD.bazel)
- Created StripeConfig and StripeClientProvider for conditional Stripe bean wiring
- Implemented StripeCustomerService.ensureStripeCustomer() with idempotent lazy provisioning
- Added atomicSetStripeCustomerId() CAS method to BillingAccountRepo
- Added getByStripeCustomerId() to BillingAccountService (Phase 3.3 prerequisite)
- Added application.yaml configuration for stigmer.stripe.secret-key and webhook-secret
- Wrote 8 unit tests for StripeCustomerService + 3 CAS tests for BillingAccountRepo
- Registered new Bazel test targets (billing_account_repo_test, stripe_customer_service_test)

## Decisions Made

1. **Lazy Stripe Customer creation**: Stripe Customer is created on first payment interaction (Phase 3.2 Checkout), NOT during getOrCreateBillingAccount. Rationale: avoids external I/O on account creation, keeps trial users off Stripe dashboard, no Stripe dependency for billing account lifecycle.
2. **Requesting user's email**: Stripe Customer email uses the IdentityAccount email of the user who triggers the first purchase. Can be updated later (Phase 6 billing contact management).
3. **CAS for stripe_customer_id**: Uses MongoDB findAndModify with guard condition (stripe_customer_id is null/empty/absent) instead of full document save(). Prevents race conditions without transactions and avoids overwriting concurrent balance changes.
4. **Package placement**: New Stripe code lives in `ai.stigmer.domain.billing.stripe` sub-package, clearly signaling external service integration within the billing bounded context.
5. **ConditionalOnProperty for StripeClient**: Service boots cleanly without Stripe credentials. StripeCustomerService handles missing StripeClient bean via @Autowired(required=false) and throws StripeNotConfiguredException.
6. **Modern StripeClient pattern**: Using StripeClient constructor injection (v32+) instead of global Stripe.apiKey. Thread-safe, fully mockable.

## Key Code Changes

### stigmer-cloud (Java)
- `MODULE.bazel`: Added `com.stripe:stripe-java:32.1.0` Maven artifact
- `BUILD.bazel`: Added `@maven//:com_stripe_stripe_java` dep + 2 new test targets
- `StripeConfig.java`: @ConfigurationProperties for stigmer.stripe (secret-key, webhook-secret)
- `StripeClientProvider.java`: @Configuration producing StripeClient bean conditionally
- `StripeCustomerService.java`: ensureStripeCustomer() — fast-path return, Stripe API create, CAS write, race recovery
- `BillingAccountRepo.java`: atomicSetStripeCustomerId() — findAndModify with $set + guard
- `BillingAccountService.java`: getByStripeCustomerId() — reverse lookup for webhook handling
- `application.yaml`: stigmer.stripe config section with env-var placeholders

## Open Questions for Next Session

1. **Phase 3.2 proto changes**: Need to add CreateCreditCheckoutSession RPC to command.proto + io.proto messages. This requires codegen in both repos.
2. **CreditPurchase collection**: Phase 3.2 will need a credit_purchase collection (Mongock migration order "025") to track payment-to-credit mapping.
3. **Stripe webhook endpoint**: Phase 3.3 needs a Spring MVC HTTP endpoint (not gRPC) for Stripe webhook delivery. Need to decide if it goes through the existing port 8081 HTTP server or a dedicated route.

## Next Session Plan

- Phase 3.2: Stripe Checkout Integration
  - Add CreateCreditCheckoutSession RPC to billing command.proto
  - Create credit_purchase MongoDB collection + migration
  - Implement CreditPurchaseRepo
  - Implement CreateCreditCheckoutSessionHandler
  - Wire Stripe Checkout Session creation with credit pack catalog
