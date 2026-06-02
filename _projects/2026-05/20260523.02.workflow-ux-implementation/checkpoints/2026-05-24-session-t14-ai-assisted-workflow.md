# Session Notes: 2026-05-24 — T14 AI-Assisted Workflow Creation

## Accomplishments

All 5 phases of T14 implemented in a single session:

1. **Diff Engine + Visual Extensions** — Pure diff engine (`computeGraphDiff`, `buildDiffGraph`, `jsonEqual`), extended `WorkflowGraphMode` with `"diff"`, extended `NodeShell`/`CanvasTransitionEdge`/`WorkflowNode` with diff styling, created `DiffBadge`
2. **Diff Canvas Component** — `useWorkflowDiffGraph` hook, `WorkflowDiffGraph` component, `DiffSummaryBar`
3. **Integration** — Replaced text diffs with graph diffs in all 3 AI panels (`WorkflowRefinePanel`, `WorkflowArchitectDialog`, `WorkflowRepairCard`), with collapsible YAML diff fallback
4. **Validation Fix** — "Fix with AI" toolbar button auto-sends validation errors to Refine panel
5. **Explain Workflow** — `useExplainWorkflowFlow` hook + `WorkflowExplainDialog` + toolbar + overview page entry points

## Decisions Made

- **Edge matching by semantic triple**: `(source, target, sourceHandle)` not by edge ID — edge IDs (`e_0`, `e_1`) are synthetic and unstable across parses
- **Sentinel exclusion**: `__start__`/`__end__` nodes excluded from diff (they're structural, not user tasks)
- **Priority chain**: `diffStatus > executionStatus > errorCount > categoryColor` for visual styling
- **Collapsible text diff**: Preserved text YAML diff as a collapsible toggle rather than removing it entirely — power users still want it
- **Single-turn explain**: No multi-turn conversation for explain; it's a one-shot request
- **initialInstruction via microtask**: Auto-send uses `Promise.resolve().then()` instead of `useEffect` to avoid the extra render cycle

## Key Code Changes

- `diff/` module (6 files): Pure TypeScript diff engine with no React dependency (DD-003 headless-first)
- `NodeShell.tsx`: Added `diffStatus` prop with CSS + SVG dual-path handling matching the existing `executionStatus` pattern
- `WorkflowDiffGraph.tsx`: Read-only React Flow canvas following the `WorkflowExecutionGraph` outer/inner pattern
- `WorkflowRefinePanel.tsx`: `initialInstruction` prop enables "Fix with AI" auto-send
- `WorkflowEditorView.tsx`: Two new toolbar buttons ("Fix with AI" + "Explain") + `WorkflowExplainDialog`
- `WorkflowDetailView.tsx`: "What does this workflow do?" quick action in overview tab

## Deferred Items

From the plan:
- **DiffDetailPopover** — click a modified node to see field-level before/after. Add later based on user feedback.
- **Rename detection** — renamed tasks show as remove+add. Heuristic matching is fragile; defer.
- **Large change fallback** — if >60% nodes change, graph may be cluttered. Ship it; fix if reported.
- **Deep nested diff** — fork/try_catch inner task changes show as "container config changed." Per-nested-task diff is v2.

## Test Results

- 25 new unit tests (graph-diff: 19, build-diff-graph: 6)
- All passing, zero regressions on existing 652-test suite
- 5 pre-existing failures in unrelated files (useElkLayoutEngine env, ExecutionInspector tabs)

## Next Session Plan

- T14 is complete. Remaining work in the project is deferred items and polish.
- Consider running `make check` for full CI validation before merging.
