# T06: Branch and Parallel Execution Highlighting

**Date**: May 23, 2026

## Summary

Implemented per-edge execution state derivation and fork progress tracking for the workflow execution canvas. Edges now visually distinguish taken vs. untaken branches (switch_case, human_input) and active vs. not-reached paths. Fork nodes display branch completion progress (N/M) in their execution badge.

## Problem Statement

The execution canvas (T04) rendered all nodes with status overlays (border + opacity + badges) but treated all edges identically — a blanket 60% opacity in non-design modes. Users could not tell which `switch_case` branch was selected, which `human_input` outcome was chosen, how many `fork` branches had completed, or which edges represented the actual execution path.

### Pain Points

- No visual distinction between taken and untaken branches in switch_case workflows
- Fork nodes showed generic "Running" with no progress indication during parallel execution
- All edges looked identical in execution mode — no path tracing possible
- Untaken branch targets faded at 40% opacity but their incoming edges were visually identical to taken edges

## Solution

Pure frontend derivation of edge execution states and fork progress from the existing flat task status map + graph topology. No backend, proto, or runner changes. The derivation logic combines two signals: (1) graph model edge structure (which edges are branch edges via `sourceHandle`) and (2) task execution status (which tasks ran, which are absent/not_reached).

## Implementation Details

### New: Edge execution state derivation (`derive-execution-overlays.ts`)

Two pure functions in `sdk/react/src/workflow/execution/`:

- **`deriveEdgeExecutionStates()`** — maps each edge to `taken | not_taken | active | not_reached` based on source/target node statuses and branching topology. For branching nodes (switch_case, human_input), an edge to a `not_reached` target is marked `not_taken` only when a sibling branch edge has a non-`not_reached` target (confirming the branch executed and selected a different path).

- **`deriveForkProgress()`** — reads fork config `branches[].do[]` task names and counts how many branches have all inner tasks completed. Returns `{ completed, total, compete }`.

### Modified: Edge visual treatment (`CanvasTransitionEdge.tsx`)

Replaced the blanket `!opacity-60` with per-state styling:

| State | Stroke | Opacity | Dash | Animation |
|---|---|---|---|---|
| taken | `--stgm-success` (green) | 1.0 | solid | none |
| not_taken | `--stgm-muted-foreground` | 0.3 | dashed | none |
| active | `--stgm-primary` (indigo) | 1.0 | dashed | marching ants |
| not_reached | `--stgm-muted-foreground` | 0.25 | solid | none |

Branch label pills are dimmed for not_taken/not_reached edges. WCAG 1.4.1: all states distinguished by opacity + stroke style + text, never color alone.

### Modified: Fork progress badge (`ExecutionBadge.tsx`)

Fork nodes display `N/M` (e.g. "1/3") in the execution badge while running, with a `⚡` indicator for compete/race mode. ARIA label: "Fork running, N of M branches completed."

### Modified: Hook wiring (`useWorkflowExecutionGraph.ts`)

The hook now preserves the `WorkflowGraphModel` reference (not just React Flow elements) so the derivation functions can access graph topology. Edge states and fork progress are computed in `useMemo` alongside the existing node merge, maintaining reference stability (DD-010).

### New: CSS animation (`styles.css`)

Marching-ants `@keyframes stgm-marching-ants` in `@layer stgm` with `prefers-reduced-motion` support (DD-015).

## Key Design Decisions

- **DD-T06-001**: Derive edge states from graph topology + task statuses — no new proto fields needed
- **DD-T06-002**: Four-state taxonomy: `taken | not_taken | active | not_reached`
- **DD-T06-003**: Fallthrough handling — when multiple switch targets complete (poorly authored workflows), all are marked `taken` (accurate, gracefully degrades)
- **DD-T06-004**: Fork progress from config parsing + flat status map — no runner metadata changes
- **DD-T06-005**: Visual treatment uses opacity + stroke + text, never color alone (WCAG)
- **DD-T06-006**: No NodeShell changes — existing opacity map already handles untaken branch nodes correctly

## Testing

- 21 new unit tests in `derive-execution-overlays.test.ts` covering: linear chains, switch branching (one taken, fallthrough, not yet executed, all targets not_reached), human_input outcomes, sentinel edges, failed downstream, waiting_approval, fork progress (partial, complete, compete mode, multi-task branches, missing config)
- 3 new E2E specs in `workflow-branch-highlighting.spec.ts`: switch taken/not_taken, linear edge completion, fork node completion
- All 84 workflow unit tests pass (21 new + 63 existing), zero regressions

## Files Changed

| File | Change |
|---|---|
| `sdk/react/src/workflow/execution/derive-execution-overlays.ts` | **NEW** — pure derivation functions |
| `sdk/react/src/workflow/execution/index.ts` | **NEW** — barrel export |
| `sdk/react/src/workflow/__tests__/derive-execution-overlays.test.ts` | **NEW** — 21 unit tests |
| `test/e2e/tests/interactive/workflow-branch-highlighting.spec.ts` | **NEW** — 3 E2E specs |
| `sdk/react/src/workflow/workflow-graph-conversions.ts` | Extended data types |
| `sdk/react/src/workflow/useWorkflowExecutionGraph.ts` | Wired edge state + fork progress derivation |
| `sdk/react/src/workflow/CanvasTransitionEdge.tsx` | Per-state edge visual treatment |
| `sdk/react/src/workflow/node-shell/ExecutionBadge.tsx` | Fork progress badge |
| `sdk/react/src/workflow/WorkflowNode.tsx` | Pass forkProgress to badge |
| `sdk/react/src/workflow/index.ts` | SDK exports |
| `sdk/react/src/styles.css` | Marching-ants animation |

## Benefits

- Users can instantly see which branch was taken in switch_case and human_input workflows
- Fork progress is visible during execution without inspecting individual branch tasks
- Active edges (marching ants) provide clear "execution is here" signal
- Untaken branches fade into background, reducing cognitive load
- No backend coupling — works with existing runner output

## Impact

- All consumers of `WorkflowExecutionGraph` (web console, desktop app, platform builder embeds) automatically get branch highlighting
- Zero breaking changes — all new fields are optional, existing edge data contracts unchanged
- SDK exports extended with `EdgeExecutionState`, `ForkProgress`, `deriveEdgeExecutionStates`, `deriveForkProgress`

## Deferred Work

Three runner enrichments tracked for future improvement:
1. Switch `selected_case` metadata (authoritative branch selection data)
2. Fork progress metadata (N/M without config parsing)
3. Emit `task_skipped` for switch-bypassed tasks (explicit skip signals)

## Related Work

- T04: Read-Only Execution Canvas (foundation this builds on)
- T05: Runtime Inspector Panel (uses same task state pipeline)
- Runner Task Status Enrichment (populated the data this feature consumes)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
