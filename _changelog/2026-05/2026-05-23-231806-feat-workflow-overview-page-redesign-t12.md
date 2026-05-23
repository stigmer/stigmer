# Workflow Overview Page Redesign (T12)

**Date**: May 23, 2026

## Summary

Replaced the legacy custom SVG topology graph on the workflow detail Overview tab with a React Flow-based interactive graph using the unified node rendering system, added per-workflow execution summary statistics via a proto extension to `GetExecutionSummary`, and redesigned the overview layout with stat cards, click-to-inspect node popovers, and quick action links.

## Problem Statement

The workflow detail Overview tab rendered a minimal SVG graph (`WorkflowTopologyGraph`) using dagre layout — rectangular nodes with category colors, no semantic shapes, no interactivity beyond pan/zoom. Meanwhile, the visual editor and execution viewer both used React Flow with the full `WorkflowNode` + `NodeShell` rendering system (semantic shapes, ARIA labels, visual registry). This violated DD-001 ("One Graph, Three Modes") and created visual inconsistency between the overview and editor/execution views.

Additionally, the overview tab displayed no execution statistics — users had to switch to the Executions tab or the org-level dashboard to see how their workflow was performing.

### Pain Points

- Visual disconnect: overview showed plain rectangles while editor showed diamonds, octagons, bars
- No execution KPIs on the overview page (success rate, cost, duration)
- No way to inspect a node's configuration without switching to the editor
- No quick action to navigate to the editor or latest execution

## Solution

Extended the existing `GetExecutionSummary` RPC with an optional `workflow_id` filter (additive, non-breaking proto change) and built a React Flow-based `WorkflowOverviewGraph` component in `"overview"` mode, reusing the exact same node/edge rendering as design and execution modes.

## Implementation Details

### Proto + Backend

- Added `string workflow_id = 3` to `GetExecutionSummaryRequest` — scopes summary to a single workflow when set
- Added `int32 total_count = 7` and `double success_rate = 8` to `ExecutionSummary`
- Implemented `workflow_id` filtering in Go (`get_execution_summary.go`) by matching `exec.GetSpec().GetWorkflowId()`
- Implemented identical filtering in Java (`WorkflowExecutionGetExecutionSummaryHandler.java`)
- Ran `make codegen` (OSS) and `make protos` (Cloud) — stubs regenerated for Go, Java, Python, TypeScript, Dart

### SDK Data Layer

- Extended `useWorkflowDashboardSummary` with optional `workflowId` parameter — single hook serves both org dashboard and per-workflow overview

### SDK Components (4 new files)

- `useWorkflowOverviewGraph` — behavior hook: `Workflow` -> `serializeWorkflowYaml` -> `yamlToGraph` -> `applyDagreLayout` -> `toReactFlowElements`, with selected-node state
- `WorkflowOverviewGraph` — styled component: React Flow in `"overview"` mode with `ReactFlowProvider`, `MiniMap`, `Controls`, `Background`, node click -> popover
- `WorkflowNodePopover` — positioned popover on node click showing task name, kind, category, config summary, "Open in editor" action
- `WorkflowOverviewSummary` — 4 stat cards (Total Executions, Success Rate, Avg Duration, Total Cost) with loading skeletons and empty state

### Overview Tab Redesign

- Replaced `OverviewTab` in `WorkflowDetailView` with new layout: summary cards -> interactive graph -> quick actions -> existing detail sections
- Added `onOpenInEditor` and `onViewLatestRun` callback props to `WorkflowDetailView`
- Switched both client apps to controlled tabs (`activeTab`/`onTabChange`) to support programmatic tab switching from the "Open in editor" quick action

### Cleanup

- Deleted `WorkflowTopologyPreview.tsx` (no remaining consumers after overview tab replacement)
- Kept `WorkflowTopologyGraph` (still used by `WorkflowEditorView` code-mode side-by-side preview)
- Removed barrel export for deleted component, added 4 new exports

### Client App Parity (DD-016)

- Both web and desktop `WorkflowDetailPage` wire `activeTab`, `onTabChange`, `onOpenInEditor`, `onViewLatestRun` identically

## Benefits

- **Visual consistency**: Overview, editor, and execution graphs now share the same semantic node shapes (diamonds for switch, bars for fork, octagons for human input)
- **At-a-glance KPIs**: Success rate, cost, and duration visible without leaving the overview tab
- **Click-to-inspect**: Node popover shows task type and key config snippet without switching to editor
- **Quick navigation**: "Edit workflow" and "View latest run" buttons reduce clicks to common actions
- **DD-001 compliance**: The `"overview"` graph mode type (defined in T04) is now fully wired

## Impact

- **Workflow SDK**: 4 new exported symbols (`WorkflowOverviewGraph`, `WorkflowNodePopover`, `WorkflowOverviewSummary`, `useWorkflowOverviewGraph`)
- **Proto**: 3 new fields (additive, backward compatible)
- **Backend**: Go + Java updated (core feature, both editions)
- **Client apps**: Both web and desktop updated with controlled tabs + new callbacks
- **Tests**: 30 new unit tests (3 files), 5 E2E test cases (1 file)

## Related Work

- DD-001: One Graph, Three Modes — this task completes the `"overview"` mode wiring
- T01-T04: Foundation that made this possible (visual registry, node shell, mode context, layout pipeline)
- T14: Dashboard integration — the `GetExecutionSummary` RPC extended here was originally built for the org dashboard

---

**Status**: Production Ready
**Timeline**: Single session (~30 min implementation)
