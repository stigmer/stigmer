# `useExecutionUsage` Hook — Aggregated Usage Metrics for Execution Cost Widget

**Date**: March 19, 2026

## Summary

Added a pure derivation hook `useExecutionUsage` to `@stigmer/react` that aggregates `UsageMetrics` across the main agent and all sub-agents into a single memoized result. This is the data layer for the upcoming `ExecutionCostSummary` component (Task 3), enabling platform builders to display total token consumption, LLM call metrics, and estimated cost for an agent execution.

## Problem Statement

The proto model stores usage metrics at two scopes: `AgentExecutionStatus.usage` for the main agent's direct LLM calls, and `SubAgentExecution.usage` for each sub-agent's calls. To display total execution cost, consumers must manually sum these — including merging `modelBreakdown` entries by model+provider and sorting `llmCalls` chronologically across agents.

### Pain Points

- No SDK-level aggregation existed — every consumer would have to implement the summation logic independently
- `modelBreakdown` entries need merging by composite key (same model used by main agent and sub-agent should appear as one entry)
- `llmCalls` sequence numbers overlap across agents (both have call #1, #2, etc.), requiring timestamp-based sorting for a global view
- `toolResultCharsTruncated` is a `bigint` (`int64`), requiring careful arithmetic

## Solution

A single file (`useExecutionUsage.ts`) containing:
- `aggregateUsage()` — a pure function that performs the full aggregation, testable without React
- `useExecutionUsage()` — a thin `useMemo` hook wrapping the pure function
- `UseExecutionUsageReturn` — the only new interface, wrapping the proto `UsageMetrics` with aggregation metadata

## Implementation Details

### Aggregation Rules

| Field | Rule |
|-------|------|
| Token counts (`promptTokens`, `completionTokens`, etc.) | Sum across all agents |
| `estimatedCostUsd`, `llmCallCount` | Sum |
| Duration fields | Sum |
| `primaryModel`, `primaryProvider` | Main agent only |
| `modelBreakdown` | Merged by `model+provider` key — same model across agents combined into single `ModelUsage` |
| `llmCalls` | Concatenated, sorted by `timestamp` |
| `toolResultCharsTruncated` | Sum (as `bigint`) |

### Key Design Choices

- **Proto types directly**: The aggregated result is a `UsageMetrics` proto object via `create(UsageMetricsSchema)` — no custom data interfaces, consistent with every other hook in the SDK
- **Short-circuit optimization**: When no sub-agents have usage, the main agent's `UsageMetrics` is returned directly (zero allocation)
- **Exported pure function**: `aggregateUsage()` is exported for non-React consumers and independent testability

### Files Changed

- `sdk/react/src/execution/useExecutionUsage.ts` (new) — hook, pure function, return type
- `sdk/react/src/execution/__tests__/useExecutionUsage.test.tsx` (new) — 19 tests
- `sdk/react/src/execution/index.ts` — barrel exports
- `sdk/react/src/index.ts` — re-exports

## Benefits

- Platform builders get aggregated usage with a single hook call: `const { usage } = useExecutionUsage(execution)`
- Pure function is independently testable and reusable outside React
- Zero field duplication between proto and React layers
- Comprehensive test coverage: null handling, token summation, cost aggregation, model breakdown merging, LLM call sorting, bigint arithmetic

## Impact

- **SDK consumers**: New hook available for any UI that needs execution cost data
- **Execution Cost Widget**: Data layer complete — Task 3 (`ExecutionCostSummary` component) can now consume this hook
- **Architecture**: Establishes the pattern for future aggregation hooks — use proto types directly, extract pure functions

## Related Work

- [Fix Usage Merge Gap](2026-03-19-095715-fix-usage-merge-gap.md) — Task 1 of the same project, fixed server-side usage merge so this data actually flows

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (planning + implementation + tests)
