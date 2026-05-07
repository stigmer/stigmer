# Phase 5: Usage Dashboard Enrichment (5.1 + 5.2 + 5.5)

**Date**: May 6, 2026

## Summary

Enriched the `OrgUsagePanel` with projected credit runway, per-agent cost breakdown, native/cursor harness split visualization, and CSV export — transforming the usage settings page from a basic cost summary into a comprehensive analytics dashboard. Added one proto message (`HarnessCostSummary`) and a backend aggregation method, with all other data sourced from existing RPC fields that were returned but never rendered.

## Problem Statement

The existing usage dashboard (`settings/usage`) showed only total cost, LLM call count, token count, a daily cost chart, and a per-model breakdown. Users had no visibility into:
- How long their credits would last at current spend rate
- Which agents were the most expensive
- Whether native or cursor harness was driving costs
- How to export data for accounting or external analysis

### Pain Points

- No runway projection — users had to mentally divide balance by spend to estimate remaining days
- `top_agents_by_cost` data was returned by the RPC but never rendered in the UI
- `total_executions`, `total_agents`, `total_sessions` counts were wasted — never shown
- No harness-level cost attribution (native vs cursor split)
- No data export capability for finance teams or auditing

## Solution

Extended the existing `OrgUsagePanel` with five new components (all in `sdk/react/src/usage/`) while preserving backward compatibility for platform builders already using the panel. Added one small proto extension for harness data and a backend aggregation method.

## Implementation Details

### Proto Extension (stigmer OSS)

- Added `HarnessCostSummary` message: `harness`, `billable_cost_micros`, `call_count`, `execution_count`
- Added `repeated HarnessCostSummary harness_breakdown = 9` to `GetOrgUsageReportOutput`
- Ran `make codegen` (OSS) + `make protos` (cloud)

### Backend (stigmer-cloud)

- `UsageAggregationService.buildHarnessBreakdown()` — groups records by harness, sums cost/calls, counts distinct executions
- Wired into `AgentExecutionGetOrgUsageReportHandler` response builder
- Added response-time INFO logging for future scale visibility
- 5 unit tests in `UsageAggregationServiceTest`

### React SDK Components (stigmer OSS)

| Component | Purpose |
|-----------|---------|
| `CreditRunwayIndicator` | Color-coded "~N days at this rate" from balance/spend rate |
| `AgentBreakdownList` | Ranked table with proportional cost bars (renders `top_agents_by_cost`) |
| `HarnessSplitCard` | Segmented bar showing native vs cursor cost distribution |
| `useExportCSV` + `ExportButton` | Client-side CSV download (daily summary or model breakdown) |
| Enhanced `SummaryCards` | 2-row layout: primary (cost+runway, calls, tokens) + secondary (executions, agents, sessions) |

### Panel Layout (overview → breakdown)

1. Date range selector + Export button (toolbar)
2. Summary cards (6 metrics, 2 rows, runway on cost card)
3. Daily cost chart (existing, unchanged)
4. Harness split card (new)
5. Agent breakdown list (new)
6. Model breakdown table (existing, unchanged)

## Benefits

- **Runway visibility**: Users see at a glance how many days of credits remain — color-coded by urgency (green/amber/red)
- **Agent-level accountability**: Teams can identify which agents drive cost and optimize accordingly
- **Harness transparency**: Clear native vs cursor split enables informed model selection
- **Export capability**: Finance teams can download CSV for expense tracking without engineering involvement
- **Zero new RPC calls**: Runway uses existing `useBillingAccount` + usage report; agent breakdown uses existing `top_agents_by_cost` field; CSV uses in-memory data

## Impact

- **Users**: Richer analytics dashboard with actionable insights, no extra page loads
- **Platform builders**: 5 new individually importable components + hooks for custom dashboards
- **Backend**: One additional DB query per report (harness breakdown), with timing logged for scale monitoring

## Related Work

- Parent project: `20260503.03.stripe-billing-integration` — Phase 5 of 6
- Sub-project: `20260504.01.sp.proxy-side-billing-metering` — provides the `harness` field on usage records
- Previous: Phase 4 (auto-recharge) completed all payment infrastructure

---

**Status**: Production Ready
**Timeline**: Single session (~30 min implementation after planning)
