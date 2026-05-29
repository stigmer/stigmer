# Cursor Billing Trust Ladder & Settlement-State Contract

**Date**: May 29, 2026

## Summary

Authored the foundational design-decision record for Cursor harness billing
reconciliation. The document locks the trust ladder (5-tier model), settlement
state machine (`UsageSettlementStatus` enum), and hold-only billing model that
Phase 2 implementation will build against. This work also surfaced a
billing-correctness issue in the current code where runner-reported Cursor
estimates are irreversibly debited as `SERVER_OBSERVED`, contradicting the proto's
own semantics.

## Problem Statement

Cursor harness billing records are created from runner-reported `onDelta` token
counts — open-source code running on user-controlled machines. Despite the proto
documenting `StreamingUsageSummary` as `DISPLAY_ONLY` ("NOT billing-authoritative"),
the cloud billing handler stamps these records as `SERVER_OBSERVED` and immediately
debits customer credits with no reversal path.

### Pain Points

- Customers billed from unverified, runner-reported token counts
- No mechanism to replace the estimate with authoritative `chargedCents` from
  Cursor's Admin API
- `trust_level` enum semantics violated: `SERVER_OBSERVED` documented as "not
  billing" but used for billing
- No settlement lifecycle: records go from "estimated" to "debited" in one step
  with no intermediate states
- Phase 1 ingested authoritative Cursor Admin API events into `cursor_usage_event`
  but with no link to executions or billing records

## Solution

A design-decision document (`design.trust-ladder.md`) that locks the contract
before Phase 2 writes any settlement state. Three key decisions:

1. **Hold-only billing**: Stop debiting the runner estimate. Reservation hold at
   estimate time; capture from `chargedCents` at settlement only.
2. **Dedicated `UsageSettlementStatus` enum**: 8-state machine (ESTIMATED →
   RECONCILING → SETTLED / ADJUSTED / COLLISION_ABSORBED / DISPUTED → WRITTEN_OFF)
   as the single source of truth for settlement lifecycle.
3. **`PROVIDER_SETTLED` trust level**: New tier between BILLING_AUTHORITY and
   SERVER_OBSERVED for reconciled Cursor records. `ATTESTED_RUNNER` reserved for
   future confidential-VM/TEE-backed execution.

## Implementation Details

The design document (765 lines, 11 sections) covers:

- **Trust ladder**: 5-tier model with per-tier billing rules and explicit fix that
  pre-settlement Cursor is `DISPLAY_ONLY` (not billed)
- **Dimensional model**: How `metering_source` × `trust_level` ×
  `UsageSettlementStatus` × `debit_status` × `calculation_status` compose, with
  precedence rules that retire redundant `RECONCILED` duplication
- **Settlement state machine**: Full state diagram with transition rules,
  "be-gracious" collision handling, and workspace/day aggregate fallback
- **Hold-only billing model**: Reservation lifecycle, settlement debit path
  (`settlement_{usage_record_id}` idempotency), no-settlement write-off, and scoped
  impact on existing immediate-debit path
- **Proto proposal**: `UsageSettlementStatus` enum, `SettlementLink` message, new
  fields on `LlmCallUsageRecord`, BSON additions to `cursor_usage_event`
- **Phase 2 write/read contracts**: Exact field values at estimate and settlement
  time, UX label derivation from `settlement_status`, SDK-first placement
- **Test obligations**: 5 unit tests, 4 integration tests, 3 aggregation tests

### Key architectural grounding

- Proto enums: `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto`
- Cloud billing handler: `RecordLlmCallUsageHandler.java` (lines 170-264, 324-341)
- Cloud billing activities: `BillingActivitiesImpl.java` (lines 72-124)
- Reservation model: `ExecutionBillingService.java` (lines 74-193, 230-331)
- Aggregation: `UsageAggregationService.java` (lines 44-100)
- SDK display: `sdk/react/src/session/useSessionUsage.ts` (lines 200-239)
- Phase 1 ledger: `CursorUsageEventRepo.java` (lines 71-98)
- Tamper-resistance research: `04.report.gpt.md` (runner-usage-tamper-resistance)

## Benefits

- **Billing correctness**: Customers will no longer be billed from unverified
  runner estimates — credits are only captured from authoritative `chargedCents`
- **Auditability**: Every usage record carries explicit settlement provenance
  (original source preserved, confidence score, linked Admin API event)
- **Gracious defaults**: Ambiguous matches and collisions resolve in the customer's
  favor; unmatched records are written off as platform overhead
- **Clean contract**: Phase 2 implementation has an unambiguous target — no design
  decisions deferred to implementation time
- **Proto hygiene**: Trust-level semantics are restored to match their documented
  meaning

## Impact

- **Cloud billing domain** (stigmer-cloud): Phase 2 will change `recordCursorUsage`
  to hold-only, add `MatchAndSettle` activity, and wire settlement debit
- **Proto contract** (shared): New enum + fields require `make codegen` (OSS) and
  `make protos` (cloud)
- **SDK display** (`@stigmer/react`): `isEstimated` will be driven by
  `settlement_status` instead of token-count heuristic
- **OSS** (stigmer-server): Documented no-op — proto fields present but unused
- **No customer-facing behavior change yet**: This is a design document; behavior
  changes come in Phase 2

## Related Work

- Phase 1 (DONE): Cursor Admin API client + global event ledger + hourly ingestion
  workflow (see `_changelog/2026-05/2026-05-29-130028-cursor-usage-ingestion-phase-1.md`)
- Design doc: `_cursor/cursor-billing-reconciliation-workflow.md`
- Research: `_projects/2026-05/20260513.01.cursor-experience-parity/research.runner-usage-tamper-resistance/04.report.gpt.md`
- Billing fix: `_changelog/2026-05/2026-05-29-114311-fix-billing-display-remove-context-gauge.md`

---

**Status**: ✅ Design Complete — Phase 2 implementation next
**Timeline**: ~45 minutes (design sketch session)
