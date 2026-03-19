# ExecutionCostSummary Component — Real-Time Cost Widget for @stigmer/react

**Date**: March 19, 2026

## Summary

Added the `ExecutionCostSummary` styled component to `@stigmer/react` that renders live execution cost and token usage metrics during agent execution streaming. This is the presentation layer for the Execution Cost Widget feature, consuming the `useExecutionUsage` hook (delivered in session 2) and rendering a dense, themeable, accessible widget that works identically in the Stigmer Console and embedded in third-party dashboards.

## Problem Statement

The `useExecutionUsage` hook (session 2) and the server-side usage merge fix (session 1) established the data pipeline for real-time cost visibility. However, no UI component existed to display this data. Platform builders and Console users had no way to see token consumption, estimated cost, or model information during or after an agent execution.

### Pain Points

- Cost data flowed through the system but was invisible to users
- Platform builders who wanted to show cost in their own UIs had to build their own rendering from scratch
- No formatted cost or token display utilities existed in the SDK

## Solution

Created `ExecutionCostSummary` as a chromeless styled component in `@stigmer/react` following the established `ExecutionProgress` pattern. The component consumes `useExecutionUsage` internally, formats cost and token data, and renders a compact, dense layout suitable for sidebar placement.

## Implementation Details

### Component: `ExecutionCostSummary`

**File**: `sdk/react/src/execution/ExecutionCostSummary.tsx`

- **Props**: `{ execution: AgentExecution | null; className?: string }` — identical contract to `ExecutionProgress`
- **Renders nothing** when execution is null or usage data hasn't arrived
- **Headline cost**: `$0.0042` (4 decimal places for < $1) or `$1.23` (2 decimal places for >= $1)
- **Model info**: `claude-sonnet-4 · anthropic` for single model; per-model cost breakdown for multi-model executions
- **Token summary**: `1,234 tokens · 3 calls` with `tabular-nums` for stable digit widths
- **Token breakdown**: `prompt 1,000 · completion 234` as secondary detail
- **Cache line**: Conditional — only shown when cache read or write tokens > 0
- **Sub-agent annotation**: `Includes 2 sub-agents` when aggregated usage includes sub-agents

### Internal Sub-Components

- `ModelBreakdown`: Renders per-model cost table with `role="list"` accessibility when `modelBreakdown.length > 1`
- `CacheLine`: Conditional cache token display with read/write differentiation

### Formatting Utilities

- `formatCost(usd)`: Pure function. `$0.00` for zero, `$0.XXXX` for < $1, `$X.XX` for >= $1
- `formatTokenCount(count)`: Pure function. Comma-separated via `Intl.NumberFormat("en-US")` for deterministic output

### Tests

26 tests in `sdk/react/src/execution/__tests__/ExecutionCostSummary.test.tsx`:
- 10 pure formatting tests (formatCost + formatTokenCount edge cases)
- 16 component render tests (null states, basic metrics, token breakdown, singular/plural calls, cache conditions, sub-agent annotation, multi-model breakdown, accessibility attributes, className passthrough)

### Barrel Exports

- `ExecutionCostSummary` and `ExecutionCostSummaryProps` exported from `sdk/react/src/execution/index.ts` and re-exported from `sdk/react/src/index.ts`

## Benefits

- **Platform builders** can now drop `<ExecutionCostSummary execution={...} />` into their apps for instant cost visibility — zero configuration beyond passing an execution object
- **Data hook users** still import `useExecutionUsage` independently for full control over rendering
- **Console integration** (Task 4) becomes a single JSX line in `SessionPage.tsx`
- **Formatting is deterministic** — `Intl.NumberFormat("en-US")` and `toFixed()` produce consistent output across environments
- **Accessibility**: `role="region"`, `aria-label`, accessible list for model breakdown

## Impact

- **@stigmer/react public API**: +1 component export (`ExecutionCostSummary`), +1 type export (`ExecutionCostSummaryProps`)
- **Execution Cost Widget feature**: 3 of 4 tasks complete (server fix, hook, component). Only Console integration remains.
- **SDK completeness**: The execution monitoring surface now covers lifecycle progress (`ExecutionProgress`) and cost/resource consumption (`ExecutionCostSummary`) as separate, composable concerns

## Related Work

- [Fix Usage Merge Gap](2026-03-19-095715-fix-usage-merge-gap.md) — Session 1: Server-side prerequisite
- [useExecutionUsage Hook](2026-03-19-105749-use-execution-usage-hook.md) — Session 2: Data layer
- Task 4 (upcoming): Console integration in `SessionPage.tsx`

---

**Status**: Production Ready
**Timeline**: 1 session (~30 min)
