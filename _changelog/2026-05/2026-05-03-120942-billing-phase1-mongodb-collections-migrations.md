# Billing Phase 1: MongoDB Collections & Mongock Migrations

**Date**: May 3, 2026

## Summary

Created the foundational MongoDB collections and Mongock migrations for the prepaid billing system's Ledger MVP (Phase 1). Four collections with optimized indexes now provide the data layer for credit ledger operations, billing account management, grant-based credit tracking, and versioned pricing policies.

## Problem Statement

The Stigmer billing system requires persistent storage for credit-based billing operations. Phase 0 established the proto contracts and `BillingMicros` arithmetic library, but no MongoDB collections existed to back the domain services.

### Pain Points

- No data layer existed for billing account state or credit balances
- No append-only ledger storage for auditable financial transactions
- No grant-based credit tracking with burn-order semantics
- No versioned pricing policy storage for markup resolution
- The T01 plan used plural collection names that violated platform convention

## Solution

Created 4 Mongock `@ChangeUnit` migrations in `stigmer-cloud` that establish the billing data model with:
- Collection naming corrected to singular snake_case (matching all ~30 existing platform collections)
- Carefully designed indexes optimized for the specific query patterns each collection serves
- Seed data for 5 initial billing policies covering Native and Cursor harnesses at launch markups
- Proper rollback implementations for all migrations

## Implementation Details

### Collections Created

| Collection | Purpose | Key Indexes |
|---|---|---|
| `billing_account` | One-per-org billing aggregate | `org_id` unique, `stripe_customer_id` sparse unique |
| `credit_ledger_entry` | Immutable append-only financial ledger | `idempotency_key` unique, `(org_id, created_at desc)`, `(org_id, type)` |
| `credit_grant` | Discrete credit buckets with expiry | `(org_id, priority, expires_at)` burn-order, `(org_id, remaining_amount_micros)` |
| `billing_policy` | Versioned markup rules | `policy_id` unique, `(harness, cost_tier, active)` resolution |

### Index Design Rationale

- **Burn-order index** on `credit_grant`: Supports the core consumption algorithm — promotional credits (priority=0) consumed before purchased (priority=100), earliest expiry first within same priority.
- **Idempotency index** on `credit_ledger_entry`: Prevents double-processing of webhook retries, usage reports, and admin adjustments — critical for financial correctness.
- **Sparse unique** on `billing_account.stripe_customer_id`: Enables reverse lookup from Stripe webhooks while allowing the field to be empty until first Stripe interaction.

### Seeded Billing Policies

| Policy ID | Harness | Cost Tier | Markup |
|---|---|---|---|
| `native-economy-v1` | native | economy | 1.35x |
| `native-standard-v1` | native | standard | 1.25x |
| `native-premium-v1` | native | premium | 1.15x |
| `cursor-standard-v1` | cursor | standard | 1.10x |
| `cursor-max-v1` | cursor | premium | 1.05x |

### Naming Convention Decision

Corrected the T01 plan's plural names (`billing_accounts`, `credit_ledger_entries`, etc.) to singular form (`billing_account`, `credit_ledger_entry`), consistent with all 30+ existing platform collections. Collection names match proto message names in snake_case.

### Scope Decisions

- **Deferred `credit_purchase`** to Phase 3 (no proto message exists; it's a Stripe checkout concern)
- **Deferred `execution_reservation`** to Phase 2 (proto exists but no Phase 1 code needs it)

## Benefits

- Domain services (Phase 1.2) can now be implemented immediately against stable collections
- Index design is query-pattern-driven, not speculative
- Seed policies enable end-to-end billing flow testing from day one
- All migrations are idempotent and rollback-safe

## Impact

- **stigmer-cloud**: 4 new migration files under `ai.stigmer.migrations`
- **stigmer (OSS)**: Updated `next-task.md` with Phase 1.1 + 1.4 completion status
- **Migration order**: 020–023 (following existing highest order 019)
- **Next phase**: Domain services (BillingAccountService, CreditLedgerService, BillingPolicyService, UsageRatingService)

## Related Work

- Phase 0: Proto definitions in `apis/ai/stigmer/billing/v1/` (7 files, 28 messages, 5 enums, 10 RPCs)
- Phase 0: `BillingMicros` utility class with integer-only micro-USD arithmetic
- Research: `_projects/2026-05/research.prepaid-billing-strategy-stripe-integration/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (Phase 1.1 + 1.4 of 7-phase billing project)
