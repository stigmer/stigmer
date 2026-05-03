# Billing Proto Contracts and Pricing Foundation (Phase 0)

**Date**: May 3, 2026

## Summary

Defined the complete billing bounded context proto contracts for Stigmer's prepaid credit-based billing system. This Phase 0 lays the foundational schema layer — data model, RPC surface, pricing policy structure, and integer micro-USD arithmetic library — without any Stripe integration or money flowing. Every downstream phase (ledger, enforcement, Stripe checkout, auto-recharge, dashboards) builds on these contracts.

## Problem Statement

Stigmer had no billing system. Agent executions ran with no cost tracking, no credit enforcement, and no payment processing. To monetize AI agent usage, the platform needs a prepaid credit system where customers purchase credits upfront and consume them per-LLM-call during execution.

### Pain Points

- No way to charge customers for AI agent usage
- No credit balance tracking or enforcement
- No pricing model for converting provider cost to customer price
- No proto contracts for billing RPCs (account management, usage reporting, execution authorization)
- Existing model registry had no provider cost metadata for audit trail

## Solution

Defined the billing bounded context as a new `billing/v1/` proto package in the stigmer OSS repo, following Stigmer's DDD conventions. The billing domain is intentionally decoupled from the agentic domain — it references executions by ID, not by importing agentic protos. BillingAccount is modeled as a standalone domain aggregate (not a standard API Resource) since it's auto-provisioned per org and 1:1 with the organization.

## Implementation Details

### Proto Definitions (stigmer OSS — `apis/ai/stigmer/billing/v1/`)

**7 new proto files** establishing the complete billing vocabulary:

| File | Contents |
|------|----------|
| `enum.proto` | 5 enums: LedgerEntryType (12 values), CreditGrantKind, BillingAccountStatus, ReservationStatus, ExecutionBillingSignal |
| `billing_account.proto` | BillingAccount, CreditBalance, AutoRechargeConfig |
| `credit.proto` | CreditLedgerEntry, CreditLedgerSource, CreditGrant, CreditPack, ExecutionReservation |
| `policy.proto` | BillingPolicy, BillingUsageRating |
| `io.proto` | All RPC request/response messages including CustomerModelPricingEntry |
| `command.proto` | BillingCommandController service (5 RPCs) |
| `query.proto` | BillingQueryController service (5 RPCs) |

**Key design decisions:**

- **BillingAccount is NOT an API Resource** — authorized via `organization` resource kind with new `can_view_billing` / `can_manage_billing` permissions
- **Single `billing/v1/` package** — concepts are tightly coupled; splitting into sub-packages would create import cycles
- **Markup as int32 basis points** (10000 = 1.0x) — no floating-point in billing, standard financial practice
- **No cross-domain imports** — billing RPCs accept primitive inputs (execution_id, model, provider_cost_micros), not agentic proto types
- **Incremental RPC surface** — Phase 0-2 RPCs defined now; Stripe/auto-recharge/dashboard RPCs added in their phases

**Command RPCs (Phase 1-2):**
- `getOrCreateBillingAccount` — idempotent account provisioning
- `adjustCredits` — admin manual credit management
- `authorizeExecution` — credit reservation before execution start
- `reportLlmCallUsage` — per-LLM-call debit with deduplication
- `finalizeExecution` — release unused reservation, settle billing

**Query RPCs (Phase 0-2):**
- `getBillingAccount`, `getCreditBalance`, `getCreditLedger`
- `getBillingUsageReport` — aggregated spend data
- `getCustomerModelPricing` — customer-facing price list with markup applied

### IAM Permission Updates

Added `can_view_billing` (27) and `can_manage_billing` (28) to `IamPermission` enum in `iam/v1/enum.proto`. Billing RPCs authorize against the organization resource kind using these permissions.

### Model Registry Enhancement

Added `pricing.source` and `pricing.effectiveAt` to all 48 model entries in `model-registry.json`. Sources mapped per provider: `anthropic_api`, `openai_api`, `google_api`, `xai_api`, `moonshot_api`, `cursor_pricing_page`, `local` (Ollama).

### Stub Generation

Generated stubs across all target languages in both repos:
- **stigmer OSS**: Go, Java, Python, TypeScript stubs via `make codegen`
- **stigmer-cloud**: Java, Dart, Go, Python, TypeScript stubs via `make protos`

### Integer Micros Library (stigmer-cloud)

Created `BillingMicros` utility class in `ai.stigmer.domain.billing.micros`:
- Pure integer arithmetic: `applyMarkup`, `add`/`subtract` with overflow protection, `fromCredits`/`toCredits`, `tokenCost`, `pricePerMillionToMicros`
- Constants: `MICROS_PER_USD = 1,000,000`, `MICROS_PER_CREDIT = 10,000`, `BASIS_POINTS_IDENTITY = 10,000`
- 30 unit tests covering all five markup policies (13500, 12500, 11500, 11000, 10500), overflow/underflow, rounding, conversions, and a full end-to-end billing pipeline scenario

## Benefits

- **Clean proto contracts before any implementation** — all downstream phases (Java handlers, Python runner hooks, React billing pages) can code against stable interfaces
- **No floating-point in billing** — integer micro-USD and basis points eliminate rounding drift in the ledger
- **Decoupled bounded context** — billing can evolve independently without breaking agentic domain protos
- **Forward-compatible enums** — ledger entry types for disputes, refunds, and expiry are defined now but not implemented until needed, avoiding future proto breaking changes
- **Cross-language stubs ready** — billing types available in Go, Java, Python, TypeScript, and Dart immediately

## Impact

- **Proto API surface**: New `ai.stigmer.billing.v1` package with 2 services, 10 RPCs, 5 enums, and 20+ messages
- **IAM**: 2 new permissions added to the authorization framework
- **Model registry**: 48 models annotated with provider cost source and effective date
- **stigmer-cloud**: New billing domain package with tested micro-USD arithmetic library
- **Affected repos**: stigmer (OSS), stigmer-cloud

## Related Work

- Research: `_projects/2026-05/research.prepaid-billing-strategy-stripe-integration/04.report.gpt.md`
- Project plan: `_projects/2026-05/20260503.03.stripe-billing-integration/tasks/T01_0_plan.md`
- Next phase: Phase 1 — Ledger MVP (MongoDB collections, Java domain services, gRPC handler implementation)

---

**Status**: ✅ Production Ready (proto contracts and utility library)
**Timeline**: ~1 hour
