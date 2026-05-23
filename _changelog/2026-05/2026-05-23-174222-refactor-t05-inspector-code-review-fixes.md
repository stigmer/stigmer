# T05 Inspector Code Review Fixes

**Date**: May 23, 2026

## Summary

Applied code review findings to the T05 Runtime Inspector implementation: fixed a status-transition tab auto-selection race, added component-level tests, eliminated remaining inline formatter copies, added `displayName` to the `TaskDetail` interface, and introduced `formatDurationSec` for seconds-based duration formatting.

## Problem Statement

The T05 implementation was solid but had subtle gaps identified during code review:
- Auto-tab-selection for Error only fired on task name changes, not status transitions
- No component-level tests for the inspector's tab visibility and selection logic
- One inline duration formatter remained in `ErrorTab.tsx`
- Two additional files (`WorkflowDetailView`, `ExecutionSummaryWidget`) had seconds-based `formatDuration` copies
- `TaskDetail.displayName` was specified in the plan but not implemented

### Pain Points

- If a task transitioned from "running" to "failed" while selected, the Error tab wouldn't activate
- Tab visibility logic was only tested through E2E, making refactoring fragile
- Formatting inconsistency violated the single-source-of-truth principle established in T05

## Solution

Five targeted fixes, each addressing a specific review finding without disturbing the solid existing architecture.

## Implementation Details

### 1. Split `useEffect` for tab auto-selection

Separated task-change detection from status-transition detection. Added `prevStatusRef` and `userPickedTabRef` to track state transitions and respect manual tab choices.

### 2. Component tests (`execution-inspector.test.tsx`)

14 tests covering: empty states, default tab selection, Error auto-select on failure, task-change reset, status-transition auto-select, conditional tab visibility for all 5 contextual tabs, badges, header content, and ARIA tablist.

### 3. `ErrorTab.tsx` formatter fix

Replaced inline ternary with `formatDuration` import.

### 4. `displayName` on `TaskDetail`

Added the field to the interface, computed in `deriveTaskDetail` via `kindToDisplayName(taskKindToString(...))`. Simplified `ExecutionInspector.tsx` to use `detail.displayName` directly.

### 5. `formatDurationSec` utility

New canonical seconds-based formatter replacing inline copies in `WorkflowDetailView.tsx` and `ExecutionSummaryWidget.tsx`. Exported from barrel. 7 new test cases.

## Benefits

- Status-transition auto-select now works correctly (real UX bug fixed)
- 14 new component tests make tab logic safe to refactor
- Zero remaining inline duration formatters across the workflow module
- `TaskDetail` is now self-contained for display purposes

## Impact

| Area | Effect |
|------|--------|
| SDK (`@stigmer/react`) | `formatDurationSec` exported, `TaskDetail.displayName` added |
| Inspector UX | Error tab activates on status transition (not just task selection) |
| Test coverage | +14 component tests, +7 formatter tests |
| Code hygiene | 3 inline formatter copies eliminated |

## Related Work

- T05: Runtime Inspector Panel (parent implementation)
- `_changelog/2026-05/2026-05-23-171719-feat-workflow-runtime-execution-inspector-t05.md`

---

**Status**: Production Ready
**Timeline**: Single session (2026-05-23)
