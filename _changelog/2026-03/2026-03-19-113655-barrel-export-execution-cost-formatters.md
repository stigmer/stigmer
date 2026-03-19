# Promote `formatCost` and `formatTokenCount` to Barrel Exports

**Date**: March 19, 2026

## Summary

Added `formatCost` and `formatTokenCount` to the `@stigmer/react` barrel exports, enabling platform builders to format execution cost and token values without importing from internal file paths. This completes the public API surface for the execution cost feature delivered earlier today.

## Problem Statement

`formatCost` and `formatTokenCount` were exported from `ExecutionCostSummary.tsx` but not re-exported through the barrel at `execution/index.ts`. Platform builders using `useExecutionUsage()` to render custom cost UIs had no clean way to import these formatters — they would need to reach into an internal path or reimplement the formatting logic.

### Pain Points

- Inconsistency: `formatDuration` was already barrel-exported from `ToolCallDetail`, but the cost formatters were not
- Platform builders who want headless usage (`useExecutionUsage` without `ExecutionCostSummary`) had no access to the domain-specific formatting rules (sub-$1 four-decimal precision, locale-aware comma grouping)

## Solution

Added `formatCost` and `formatTokenCount` to the existing `ExecutionCostSummary` re-export line in `sdk/react/src/execution/index.ts`, matching the established `formatDuration` co-export pattern.

## Implementation Details

Single line change in `sdk/react/src/execution/index.ts`:

```typescript
// Before
export { ExecutionCostSummary } from "./ExecutionCostSummary";

// After
export { ExecutionCostSummary, formatCost, formatTokenCount } from "./ExecutionCostSummary";
```

No new code, no refactoring, no test changes. The functions were already `export`ed from their source file and fully tested via the ExecutionCostSummary test suite (26 tests).

## Benefits

- Platform builders can now `import { formatCost, formatTokenCount } from '@stigmer/react'`
- Consistent with the existing `formatDuration` export pattern
- Completes the headless-first contract: data hook (`useExecutionUsage`) + formatters (`formatCost`, `formatTokenCount`) + styled component (`ExecutionCostSummary`) are all independently importable

## Impact

- **SDK surface**: Additive, non-breaking change to `@stigmer/react`
- **Platform builders**: Clean import path for execution cost formatting utilities
- **Internal**: Consistent barrel export conventions across the execution module

## Related Work

- Execution cost widget project (Tasks 1-4, completed earlier today)
- `useExecutionUsage` hook and `ExecutionCostSummary` component

---

**Status**: Production Ready
