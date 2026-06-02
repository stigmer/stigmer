# T14: AI-Assisted Workflow Creation — Visual Graph Diff, Validation Fix, and Explain Workflow

**Date**: May 24, 2026

## Summary

Upgraded the three existing AI workflow features (Generate, Refine, Diagnose) with a visual graph diff layer that shows changes as annotated nodes and edges on a canvas, replacing the text-only YAML diff. Added two new entry points: "Fix with AI" for auto-sending validation errors to the Refine agent, and "Explain" for generating a human-readable workflow walkthrough.

## Problem Statement

The existing AI-assisted workflow features (Workflow Architect's Generate, Refine, and Diagnose modes) showed proposed changes as raw YAML text diffs. This required users to mentally parse YAML to understand structural changes — which tasks were added, removed, or modified, and how the DAG topology changed.

### Pain Points

- Text-based YAML diffs are hard to parse visually, especially for complex workflows with many tasks
- Users couldn't see the structural impact of AI-proposed changes at a glance
- No visual confirmation of what a newly generated workflow looks like before creating it
- Validation errors required manual copy-paste into the Refine panel
- No quick way to get a plain-language explanation of what a workflow does

## Solution

Built a five-phase feature set, all within the SDK (DD-001), reusing the existing `WorkflowNode`/`NodeShell`/`CanvasTransitionEdge` component system extended with a new `"diff"` graph mode:

1. **Visual graph diff engine** — pure TypeScript diff functions + visual extensions for nodes/edges
2. **Diff canvas component** — reusable React Flow canvas showing before/after with color-coded annotations
3. **Integration** — replaced text diffs in all three AI panels with the graph diff canvas
4. **"Fix with AI" button** — one-click validation error resolution via the Refine agent
5. **"Explain" feature** — streaming workflow explanation via the Workflow Architect agent

## Implementation Details

### Phase 1: Diff Engine + Visual Extensions (6 files)

- `diff/types.ts` — `NodeDiffStatus`, `EdgeDiffStatus`, `NodeDiffEntry`, `EdgeDiffEntry`, `GraphDiff` types
- `diff/graph-diff.ts` — `computeGraphDiff()` matches nodes by ID (task name), edges by semantic triple `(source, target, sourceHandle)` not by unstable edge IDs. Detects kind changes, deep config equality, and export.as differences. `changedFields` lists top-level config keys that differ.
- `diff/build-diff-graph.ts` — `buildDiffGraph()` creates a merged graph with after nodes + removed nodes from before, for unified layout via `applyDagreLayout()`
- Extended `WorkflowGraphMode` with `"diff"` (fourth mode after design/overview/execution)
- Extended `NodeShell` with `diffStatus` prop: `DIFF_STATUS_CSS` map (green border for added, dashed red + 50% opacity for removed, amber for modified) + `svgStrokeForDiffStatus()` for SVG shapes
- Extended `CanvasTransitionEdge` with `EDGE_DIFF_STYLES` map (green stroke for added edges, red dashed for removed, dimmed for unchanged)
- Created `DiffBadge` component mirroring `ExecutionBadge` positioning pattern: "+" green, "−" red, "~N" amber badges with WCAG 1.4.1 compliance (icon + text, never color alone)

### Phase 2: Diff Canvas Component (3 files)

- `useWorkflowDiffGraph` — behavior hook: YAML pair → parse → diff → merge → layout → React Flow elements with diff overlays. All in `useMemo` for referential stability (DD-010).
- `WorkflowDiffGraph` — read-only React Flow canvas with `mode="diff"`, auto-fit, dot background, controls. Same outer/inner `ReactFlowProvider` pattern as `WorkflowExecutionGraph`.
- `DiffSummaryBar` — compact bar showing "+N added  −N removed  ~N modified" with colored count badges

### Phase 3: Integration into AI Panels (3 files modified)

- **WorkflowRefinePanel**: Graph diff replaces text `DiffPreview` in result strip. Collapsible "View YAML diff" toggle preserves the text diff for users who want it.
- **WorkflowArchitectDialog**: Graph preview (all nodes green/added) replaces raw YAML `<pre>` block in result phase. Collapsible "View YAML" toggle.
- **WorkflowRepairCard**: Graph diff replaces text diff for fix_yaml results. Same collapsible pattern.

### Phase 4: Validation Fix — "Fix with AI" (2 files modified)

- Added "Fix with AI" button in editor toolbar, visible when `errorCount > 0`
- On click: serializes `editor.diagnostics` into a structured instruction, opens Refine panel with `initialInstruction` prop
- `WorkflowRefinePanel` gained `initialInstruction?: string` prop — auto-sends on mount via microtask scheduling

### Phase 5: Explain Workflow (2 new files, 2 files modified)

- `useExplainWorkflowFlow` — simplified single-turn flow (no multi-turn, no YAML extraction). Creates session with `workflow-architect`, sends fixed prompt asking for explanation only. Agent returns `action: "no_changes"` with explanation.
- `WorkflowExplainDialog` — native `<dialog>` + `showModal()` with streaming phase (MessageThread), complete phase (formatted explanation), and "Copy to clipboard" action
- Wired into editor toolbar as "Explain" button (right group)
- Wired into overview page as "What does this workflow do?" quick action

### Tests

- 25 new unit tests for the diff engine: `jsonEqual` (7 cases), `computeGraphDiff` (12 cases: identical, added, removed, modified, sentinels excluded, edge matching, branch handles, empty-before, deep equality, changedFields), `buildDiffGraph` (6 cases: merge counts, removed nodes/edges present, added nodes, metadata, empty-before)

## Benefits

- **Visual clarity**: Users see the structural impact of AI changes at a glance — green nodes are added, red are removed, amber are modified
- **Reduced cognitive load**: No need to mentally parse YAML diffs to understand what changed
- **One-click error resolution**: "Fix with AI" eliminates the manual step of describing validation errors to the Refine agent
- **Self-service documentation**: "Explain" generates on-demand workflow walkthroughs without leaving the editor
- **Consistent UX**: All three AI modes (Generate, Refine, Diagnose) now share the same visual diff pattern

## Impact

- **SDK-only change (DD-001)**: All 12 new files and 10 modified files are in `sdk/react/src/workflow/`. Zero client-app changes needed — both web and desktop consume `WorkflowEditorView` which handles everything.
- **Backward compatible**: `diffStatus` is an optional prop; `"diff"` mode is additive to the existing mode union; existing panel text diff is preserved as a collapsible fallback.
- **WCAG compliant**: DiffBadge uses icon + text + color (never color alone). All interactive elements have proper `aria-label` attributes.

## Files Changed

### New Files (12)
| File | Purpose |
|------|---------|
| `diff/types.ts` | GraphDiff, NodeDiffEntry, EdgeDiffEntry types |
| `diff/graph-diff.ts` | `computeGraphDiff()` + `jsonEqual()` |
| `diff/build-diff-graph.ts` | `buildDiffGraph()` merged model builder |
| `diff/index.ts` | Barrel export |
| `diff/DiffSummaryBar.tsx` | Summary counts bar |
| `diff/__tests__/graph-diff.test.ts` | 19 diff engine tests |
| `diff/__tests__/build-diff-graph.test.ts` | 6 merge builder tests |
| `node-shell/DiffBadge.tsx` | Badge component for diff status |
| `useWorkflowDiffGraph.ts` | Behavior hook for diff visualization |
| `WorkflowDiffGraph.tsx` | Read-only diff canvas component |
| `useExplainWorkflowFlow.ts` | Behavior hook for explain mode |
| `WorkflowExplainDialog.tsx` | Modal for streaming explanation |

### Modified Files (10)
| File | Change |
|------|--------|
| `WorkflowGraphModeContext.tsx` | Add `"diff"` to mode union |
| `node-shell/NodeShell.tsx` | Add `diffStatus` prop + CSS/SVG handling |
| `node-shell/index.ts` | Export DiffBadge |
| `CanvasTransitionEdge.tsx` | Add diff edge styling |
| `WorkflowNode.tsx` | Add DiffBadge in diff mode |
| `workflow-graph-conversions.ts` | Add `diffState` to node/edge data |
| `WorkflowRefinePanel.tsx` | Graph diff + initialInstruction |
| `WorkflowArchitectDialog.tsx` | Graph preview in result phase |
| `WorkflowRepairCard.tsx` | Graph diff for fix results |
| `WorkflowEditorView.tsx` | Fix with AI + Explain buttons |
| `WorkflowDetailView.tsx` | Explain quick action in overview |
| `index.ts` (barrel) | Export new public API |

## Related Work

- T04: Read-Only Execution Canvas — established the `WorkflowGraphMode` system and `ExecutionBadge` pattern that T14 extends
- T06: Branch Highlighting — established the `EDGE_EXECUTION_STYLES` pattern that `EDGE_DIFF_STYLES` mirrors
- Workflow Architect Agent — the system agent (`workflow-architect`) that powers all three AI modes

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
