# Next Task: 20260503.03.stripe-billing-integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260503.03.stripe-billing-integration

**Description**: Implement a prepaid credit-based billing system for Stigmer Cloud with Stripe integration. Customers purchase credits upfront via Stripe Checkout and consume them as their AI agents execute. Includes a custom MongoDB credit ledger, versioned pricing policies with per-harness/per-tier margins, execution reservation and per-LLM-call debit enforcement, auto-recharge via saved payment methods, usage dashboards, and enterprise invoicing.
**Goal**: Ship a production-ready, cloud-only prepaid billing system that enables Stigmer to monetize AI agent execution usage with transparent pricing, real-time credit enforcement, and Stripe-powered payment processing.
**Tech Stack**: Java 21/Spring Boot (stigmer-service), MongoDB, Stripe API, gRPC/Connect, Temporal, Python (agent-runner integration), TypeScript/React (billing UI)
**Components**: stigmer-cloud billing bounded context (new), stigmer-service domain handlers, MongoDB collections, Stripe webhook integration, agent-runner UsageTracker billing hooks, web console billing pages, proto definitions (apis/), model-registry.json pricing policy

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.03.stripe-billing-integration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-03 09:55
**Current Task**: T01 — Phase 1 (Ledger MVP)
**Status**: Phase 0 Complete — Ready for Phase 1

## Session Progress (2026-05-03)

### Phase 0 Completed
- Defined 7 billing proto files in `apis/ai/stigmer/billing/v1/`
- 5 enums, 20+ messages, 2 services (10 RPCs total)
- Added `can_view_billing` / `can_manage_billing` to IamPermission
- Enhanced model-registry.json with provider cost source metadata (48 models)
- Generated stubs in both repos (Go, Java, Python, TS, Dart)
- Created `BillingMicros` Java utility class with 30 unit tests in stigmer-cloud

### Key Design Decisions
- BillingAccount is NOT a standard API Resource (authorizes via organization)
- Single `billing/v1/` package (not per-resource sub-packages)
- Markup as int32 basis points (10000 = 1.0x), not doubles
- Billing domain does NOT import from agentic domain
- Credit packs simplified to 3 (Starter $10, Growth $50, Team $200) + auto-granted trial

## Next Steps (Phase 1 — Ledger MVP)

1. Create MongoDB collections in stigmer-cloud (billing_accounts, credit_ledger_entries, credit_grants, credit_purchases, billing_policies)
2. Implement Java domain services (BillingAccountService, CreditLedgerService, BillingPolicyService, UsageRatingService)
3. Implement gRPC handlers for getOrCreateBillingAccount, adjustCredits, getCreditLedger, getBillingAccount
4. Create Mongock migrations to seed initial billing policies and collections
5. Write unit tests for ledger operations (append-only invariant, burn order, balance computation)

## Context for Resume
- Proto contracts are stable — all downstream code can build against them
- The model catalog migration to a proper API service is deferred (separate future task)
- `BillingMicros` is ready to use for all micro-USD arithmetic in domain services
- Phase 1 work is entirely in stigmer-cloud (Java domain handlers + MongoDB)

## Quick Commands

After loading context:
- "Start Phase 1" - Begin Ledger MVP implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
