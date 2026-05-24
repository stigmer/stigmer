# Fix ExecutionInspector Tab Auto-Selection and Badge Accessibility

**Date**: May 24, 2026

## Summary

Fixed 4 pre-existing test failures in the `ExecutionInspector` component by replacing post-render `useEffect` tab selection with synchronous render-time state derivation, and fixing badge accessible names in the shared `Tabs` component. This eliminates a visible flash of wrong content when selecting a failed task and brings the component into compliance with WAI-ARIA authoring practices.

## Problem Statement

The `ExecutionInspector` component's tab auto-selection logic ran in `useEffect`, which fires after the DOM commit. When a user selected a failed task node, the Summary tab would briefly flash before switching to the Error tab — a UX bug that also violated React's recommendation against using effects for prop-derived state.

### Pain Points

- **Flash of wrong content**: Summary tab appeared briefly before Error tab on failed task selection
- **Architectural violation**: Initial state derivable from props was computed in a post-render effect instead of synchronously (React docs: "Adjusting state when a prop changes")
- **Badge accessibility**: The `Tabs` component's badge text was included in the computed accessible name (`"Retries 2"` instead of `"Retries"`), violating WAI-ARIA authoring practices for supplementary content

## Solution

Two independent, focused changes in the SDK (`@stigmer/react`):

1. **Synchronous tab derivation** — Extracted a `deriveAutoTab()` pure function (DD-003 headless-first pattern) and replaced two `useEffect` blocks with synchronous render-time state derivation using React's recommended "adjusting state when a prop changes" pattern.

2. **Badge `aria-hidden`** — Added `aria-hidden="true"` to the badge `<span>` in the shared `Tabs` component so badge text is excluded from the tab button's computed accessible name.

## Implementation Details

### ExecutionInspector.tsx

- Extracted `deriveAutoTab(detail)` — a pure function that computes the system-suggested tab from the current task detail (failed → error, waiting_approval → approval, otherwise → summary)
- Replaced `useRef` + `useEffect` tracking with `useState`-based previous-value tracking and synchronous render-time `if` blocks
- `useState(() => deriveAutoTab(detail))` provides the correct initial tab on first mount
- Task-change block: synchronous reset with `deriveAutoTab` when `selectedTaskName` changes
- Status-transition block: synchronous auto-select to Error/Approval when status transitions on the same task
- `userPickedTabRef` remains a `useRef` — manual tab selection still overrides auto-selection
- Removed `useEffect` import (no longer needed in this file)

### Tabs.tsx

- Added `aria-hidden="true"` to the badge `<span>` element
- Tab accessible names are now consistently the label text only, regardless of badge presence
- Affects all tabs with badges (Retries, Approval, Events) uniformly

### Test Fix (execution-inspector.test.tsx)

- One test ("auto-selects Error tab when status transitions to failed on same task") needed a minimal fix: the `memo()` wrapper correctly skipped re-renders when no props changed, but the test only changed the mock return value without changing any props. Passing a new `taskStates` reference on rerender accurately simulates the production data flow where the event store updates the Map when a task fails.

## Benefits

- **Zero flash of wrong content** — Error tab is visible immediately when selecting a failed task
- **Correct React patterns** — Follows the official "adjusting state when a prop changes" pattern, not the discouraged useEffect-for-derived-state antipattern
- **WCAG compliance** — Tab accessible names are clean and consistent, following WAI-ARIA authoring practices
- **Test health** — 4 previously-failing tests now pass; full suite at 1294/1295 (1 unrelated pre-existing failure)

## Impact

- **SDK component**: `ExecutionInspector` — used by both the Stigmer Console and platform builders embedding workflow execution views
- **SDK component**: `Tabs` — shared primitive used across the entire SDK surface
- **Test suite**: React SDK workflow tests improved from 1290/1295 passing to 1294/1295

## Related Work

- Part of the Workflow UX Implementation project (T01-T16)
- `ExecutionInspector` was introduced in T05 (Runtime Inspector Panel)
- `Tabs` component is a shared SDK primitive used across agent and workflow features

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
