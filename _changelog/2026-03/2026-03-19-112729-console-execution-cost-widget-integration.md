# Console Integration: ExecutionCostSummary Widget

**Date**: March 19, 2026

## Summary

Integrated the `ExecutionCostSummary` SDK component into the Console's session sidebar, completing the end-to-end execution cost widget feature. Real-time token usage, LLM call counts, and estimated USD cost now stream live alongside execution progress during agent runs.

## Problem Statement

The Console's session page displayed execution lifecycle progress (phases, tool calls, status) but provided no visibility into execution cost. Users had to wait until after completion and check separate usage endpoints to understand what an execution consumed.

### Pain Points

- No real-time cost visibility during active agent streaming
- Token consumption and model usage hidden from the primary monitoring surface
- Platform builders embedding the execution viewer had no cost widget to accompany it

## Solution

Consumed the `ExecutionCostSummary` component (built in `@stigmer/react` in Task 3) from the Console's `SessionPage.tsx`, placing it in the sidebar alongside the existing `ExecutionProgress` widget. The integration required only an import addition and JSX insertion — zero new data plumbing — because the component reuses the same `displayExecution` prop already computed for `ExecutionProgress`.

## Implementation Details

Single file changed: `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`

- Added `ExecutionCostSummary` to the `@stigmer/react` import block
- Added the component below `ExecutionProgress` in the sidebar, each in its own card wrapper (`rounded-lg border border-border bg-card p-3`)
- Updated sidebar `aria-label` from `"Execution progress"` to `"Execution details"` to reflect the expanded composite content
- Both widgets share the `displayExecution` guard — the cost summary handles its own null/loading state internally

Design decisions:
- **Separate cards**: Progress and cost are semantically distinct regions with independent `role="region"` + `aria-label` semantics
- **Progress above, cost below**: Progressive disclosure — "what is happening" before "how much is it costing"
- **Accepted brief empty card**: During the 1-2 seconds before usage data arrives from the agent runner, the cost card renders empty; alternatives (component-owned chrome, hook-in-page guard) add complexity not justified by the transient artifact

## Benefits

- Live cost streaming during agent execution — no more waiting until completion
- Token breakdown (prompt/completion), model identification, cache usage, and sub-agent aggregation visible at a glance
- Consistent with `ExecutionProgress` integration pattern — same prop, same card styling, same sidebar placement
- Platform builders get identical functionality by importing `ExecutionCostSummary` from `@stigmer/react`

## Impact

- **Direct users**: Real-time cost awareness during execution monitoring in the Console
- **Platform builders**: Can embed the same widget in their own dashboards via `@stigmer/react`
- **Architecture**: Validates the SDK-first pattern — the Console integration was a trivial consumer of a well-designed SDK component

## Related Work

This is Task 4 of 4 in the execution-cost-widget project:

- Task 1: Server-side usage merge fix (`_changelog/2026-03/2026-03-19-095715-fix-usage-merge-gap.md`)
- Task 2: `useExecutionUsage` hook (`_changelog/2026-03/2026-03-19-105749-use-execution-usage-hook.md`)
- Task 3: `ExecutionCostSummary` component (`_changelog/2026-03/2026-03-19-111754-execution-cost-summary-component.md`)
- Task 4: Console integration (this changelog)

---

**Status**: Production Ready
**Timeline**: ~15 minutes (integration of pre-built SDK component)
