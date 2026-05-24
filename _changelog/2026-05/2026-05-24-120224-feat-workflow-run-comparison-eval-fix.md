# Workflow Run Comparison View + Eval Kind Registry Fix

**Date**: May 24, 2026

## Summary

Added a Run Comparison View to the workflow execution viewer, enabling users to compare two executions side-by-side with delta metrics and per-task outcome differences. Also fixed the `eval` task kind (#20) being missing from the OSS task-kind-registry, restoring it to the task picker, inspector schema, and JSON Schema validation.

## Problem Statement

### Run Comparison

When a workflow execution fails, operators need to understand *what changed* compared to a successful run of the same workflow. Without a comparison view, debugging requires manually opening two executions in separate tabs and eyeballing differences across timing, cost, task outcomes, and errors.

### Eval Kind Registry Gap

The `eval` task kind (enum #20) was fully defined in proto and runtime code but missing from the OSS embedded `task-kind-registry.json`. This caused the task picker to omit "Evaluate (LLM Judge)" from the palette, and JSON Schema validation to reject `eval` task configs.

## Solution

### Run Comparison View

Built a context-based comparison feature within the existing `WorkflowExecutionViewer`:
- "Compare with..." button appears on terminal executions
- Picker dialog shows recent executions of the same workflow with smart pre-selection
- Comparison view shows 4 summary delta cards + per-task comparison table with filter chips
- Divergence point (first task where outcomes differ) is visually highlighted

### Eval Fix

Added `"eval": 20` to the codegen `kindOrder()` function and regenerated the task-kind-registry to include all 20 task kinds.

## Implementation Details

### New Module: `sdk/react/src/workflow/execution-comparison/`

| File | Purpose |
|------|---------|
| `types.ts` | `TaskComparison`, `ExecutionComparison` interfaces |
| `derive-execution-comparison.ts` | Pure derivation function (two executions → comparison result) |
| `useExecutionComparison.ts` | Behavior hook (fetches both, derives, stable return) |
| `ExecutionComparisonPicker.tsx` | Native `<dialog>` for selecting comparison target |
| `ComparisonSummaryCards.tsx` | 4 delta cards (duration, cost, tokens, task outcomes) |
| `TaskComparisonTable.tsx` | Per-task table with status/duration/cost columns and filter chips |
| `ExecutionComparisonView.tsx` | Top-level composed view |
| `index.ts` | Barrel exports |

### Modified Files

- `WorkflowExecutionHeader.tsx` — Added `onCompare` prop, "Compare with..." button for terminal phases
- `WorkflowExecutionViewer.tsx` — Integrated picker + comparison view state management
- `workflow/index.ts` — Added execution-comparison to SDK public surface
- `tools/codegen/generator/task_registry.go` — Added `"eval": 20` to `kindOrder()`
- `task-kind-registry.json` — Regenerated with 20 entries (both codegen output and embedded)

### Design Decisions

- **DD-RC-001**: Context-based entry (not table multi-select) — user is already in a failed run
- **DD-RC-002**: Metrics + task table (not graph overlay) — topology is identical between runs
- **DD-RC-003**: SDK-first, headless-first — pure derivation → behavior hook → styled component

## Benefits

- Operators can immediately identify which tasks diverged and where errors appeared
- Duration and cost deltas surface performance regressions
- Smart pre-selection (last successful run) reduces click-count for the most common use case
- Eval tasks are now selectable in the picker and validated by JSON Schema
- Zero backend changes required — client-side diff over existing `get()` API

## Impact

- **Users**: Any workflow operator debugging a failed execution can now compare with a reference run in 2 clicks
- **Platform builders**: `ExecutionComparisonView`, `useExecutionComparison`, and `deriveExecutionComparison` are exported from `@stigmer/react` for embedding
- **Eval users**: Task picker now shows "Evaluate (LLM Judge)" and inspector field schemas work

## Related Work

- T13 (Execution History and Operations Dashboard) — deferred run comparison
- T14 (AI-Assisted Workflow Creation) — graph diff engine (definition-level, not execution-level)
- Research report Section 10: "Execution history filters and run comparison"

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
