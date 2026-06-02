# Billing account statement + usage report fix

**Date**: June 2, 2026

## Summary

Reframed the Billing tab's "Transaction History" into a clean, money-in/money-out **account statement** and fixed the Usage tab's empty/hanging org usage report. The classification of which ledger entry types are customer-facing is now owned by the server (a new `LedgerView` enum on the credit-ledger query), so every client surface stays consistent. The Usage report was re-architected from execution-first to usage-first, eliminating an N+1 query storm and a date-axis mismatch that made the report hang or return empty even when the credit ledger clearly had usage.

This changelog covers the OSS contract and SDK changes (proto + `@stigmer/react` / `@stigmer/sdk`). The server-side implementation (credit-ledger classification handler, usage-report refactor, Mongo index, tests) lives in the companion `stigmer-cloud` repository, since billing and usage metering are cloud-only.

## Problem Statement

The desktop/web Billing and Usage screens surfaced two distinct problems.

### Pain Points

- **Billing noise.** The Transaction History rendered the credit ledger at per-LLM-call granularity. A single agent run produced one `reservation_hold` (e.g. -$1.00), several sub-cent `usage_debit` rows, and one `reservation_release` (e.g. +$1.00). The hold/release pair is a net-zero internal escrow mechanic — surfacing it leaks the platform's accounting model into the customer's view (a "match between system and the real world" violation), and the per-call usage rows are redundant with the Usage analytics.
- **Where classification lived.** The natural quick fix — a hardcoded allow-list of "customer-facing" ledger types in a React component — would make the frontend the source of truth for a domain concept. Every surface (web, desktop, CLI, third-party SDK) would have to re-derive the same list, and a newly added ledger type would be silently misclassified everywhere except wherever someone remembered to update it.
- **Empty / hanging Usage tab.** The Usage screen showed a perpetual loading skeleton even for orgs with real spend in the credit ledger. The org usage report was *execution-first*: it scanned `agent_execution` by `status.startedAt`, then joined `llm_call_usage_record` per execution, per agent, and per day (an N+1 storm against an unindexed lookup). Billing and the ledger instead key off `observed_at` / `created_at`, so executions could be filtered out on a different date axis — and workflow-execution usage was never scanned at all.

## Solution

Two coordinated changes:

1. **Server-owned ledger classification.** A new `LedgerView` enum lets the client express *intent* ("give me the account statement") while the server resolves it to the concrete set of `LedgerEntryType` values. The Billing tab requests the statement view; the cloud handler owns the funding-vs-internal classification in exactly one place.

2. **Usage-first org report.** The report now loads `llm_call_usage_record` in a single indexed query on `(org_id, observed_at)` — the same axis billing uses — then enriches execution → agent attribution via batched `$in` lookups. This removes the N+1 fan-out, aligns the date axis with the ledger, and includes workflow-execution usage.

## Implementation Details

### Proto contract (OSS `apis/`, source of truth)

- `apis/ai/stigmer/billing/v1/enum.proto`: added `enum LedgerView { ledger_view_unspecified = 0; ledger_view_statement = 1; }`. `unspecified` keeps the full-ledger behavior for existing/administrative callers (back-compat).
- `apis/ai/stigmer/billing/v1/io.proto`: added `LedgerView view = 6;` to `GetCreditLedgerInput`. When `view = statement`, the server applies the funding set; an explicit `type_filter`, if also present, intersects within it.
- Regenerated Go / Java / Python / TypeScript stubs (`make codegen` in OSS, `make protos` in cloud).

**Statement set (funding / money-movement):** `purchase_credit`, `auto_recharge_credit`, `promotional_credit`, `refund_reversal`, `adjustment_credit`, `adjustment_debit`, `expiry_debit`, `dispute_hold`, `dispute_release`.
**Excluded by the statement view:** `usage_debit`, `reservation_hold`, `reservation_release`.

### SDK (`@stigmer/sdk`, `@stigmer/react`)

- `sdk/typescript/src/billing.ts`: `getCreditLedger` accepts an optional `view`, forwarded to `GetCreditLedgerInput`. The `page.num` contract is documented as 0-based (matching the backend).
- `sdk/react/src/billing/useCreditLedger.ts`: added a `view` option; converts the hook's 1-based `pageNum` to the backend's 0-based `page.num` (fixes a pre-existing off-by-one where "Page 1" returned the second page).
- `sdk/react/src/billing/CreditLedgerTable.tsx`: requests `view: LedgerView.statement` with **no** client-side type list, drops the per-row Balance column (the running available-balance no longer reconciles once usage debits are hidden; current balance is shown in `CreditBalanceCard`), and uses funding-oriented empty-state copy.
- Tests: `sdk/react/src/billing/__tests__/CreditLedgerTable.test.tsx` asserts the hook is called with `view: statement` (and no hand-rolled `typeFilter`), the Balance column is gone, and the empty state renders.

### Companion server work (in `stigmer-cloud`)

- `LedgerViewClassifier` owns the `LedgerView.statement → Set<LedgerEntryType>` mapping; `GetCreditLedgerHandler` resolves the view (short-circuiting an empty intersection to an empty page).
- `AgentExecutionGetOrgUsageReportHandler` + `UsageAggregationService` refactored to usage-first; orphaned execution-first aggregation helpers removed.
- New Mongock migration adds a `metadata.id` index to `agent_execution` (the batched enrichment lookup field, previously unindexed).
- JUnit tests: classifier behavior, plus the usage report's non-empty aggregation, observed_at-keyed daily buckets, workflow-execution usage counting, and a single-query / no-N+1 guard.

## Benefits

- **Billing reads like a bank statement.** Only meaningful money events appear: purchases, auto-recharges, promotional credits, refunds, admin adjustments, expirations, disputes. The escrow and sub-cent per-call noise is gone.
- **One source of truth for classification.** New ledger entry types are classified server-side, once. No client re-derivation, no drift across web/desktop/CLI/SDK.
- **Usage report works and is fast.** A single indexed query replaces the per-execution/per-agent/per-day fan-out; the report is aligned to the billing date axis and now includes workflow-execution usage.
- **Pagination fixed.** "Page 1" returns the first page.

## Impact

- **Billing consumers** (web console, desktop, any `@stigmer/react` integrator) get the statement view automatically through `CreditLedgerTable`. Integrators using `useCreditLedger` directly can opt into `view: LedgerView.statement` or omit it for the full ledger.
- **Behavior change to note:** the usage-first report counts `totalExecutions` / `totalSessions` / `totalAgents` from records that produced usage, so executions with zero LLM calls no longer count toward those totals. This is more accurate for a usage dashboard but differs from the previous execution-scan counts.

## Related Work

- `2026-06-02-160723-cursor-token-rate-usage-proto-fields.md` — recent `usage.proto` changes for Cursor Token Rate transparency (adjacent billing-metering surface).
- Companion `stigmer-cloud` changelog for the server-side classification handler, usage-report refactor, and index migration.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
