# Workflow Overview Redesign: Remove Redundancy, Add Task Flow DAG

**Date**: May 19, 2026

## Summary

Redesigned the workflow detail Overview tab to eliminate information redundancy (duplicate description, duplicate task list via a separate Tasks tab) and replace the flat sequential task list with an interactive read-only DAG visualization. The graph supports zoom, pan, and visible control buttons so users can explore task flow structure at a glance.

## Problem Statement

The workflow detail page had multiple UX issues creating clutter and redundancy.

### Pain Points

- Description appeared twice: once in the `ResourceDetailShell` header and again in the Overview's Description section (when `editable=false`)
- Tasks appeared twice: a "Tasks" section in the Overview tab and a separate "Tasks" tab rendering the identical `WorkflowTaskList` component with the same data
- The flat numbered task list conveyed sequential order but could not communicate branching, parallelism, or switch-case routing -- all of which workflows support
- Long descriptions had no height constraint in read-only mode, pushing Budget, Env Vars, and Document sections below the fold

## Solution

1. **Removed the standalone Tasks tab** -- pure redundancy eliminated. Tab bar now shows: Overview | Instances | Executions | Editor.

2. **Replaced flat task list with interactive DAG** -- the Overview's Tasks section now renders `WorkflowTopologyPreview`, which builds a DAG topology directly from proto `WorkflowTask[]` objects (no YAML round-trip) and renders it via the existing `WorkflowTopologyGraph` SVG renderer.

3. **Added visible graph controls** -- `WorkflowTopologyGraph` now includes a floating toolbar with Zoom In, Zoom Out, and Fit to View buttons, plus a hint bar ("Scroll to zoom / Drag to pan") so users know the graph is interactive.

4. **Fixed duplicate description** -- `headerMeta.description` is now always `undefined` (matching the agent pattern), making the Overview Description section the single canonical location.

5. **Added expand/collapse for description** -- read-only descriptions use the same `DescriptionContent` pattern as agent instructions: 8rem collapsed height with gradient fade and "Show more" / "Show less" toggle.

## Implementation Details

### New SDK Files
- `sdk/react/src/workflow/topologyFromTasks.ts` -- Pure function that builds `TopologyNode[]`/`TopologyEdge[]` directly from proto `WorkflowTask[]`. Mirrors the `useWorkflowTopology` YAML-parsing logic but operates on typed proto objects with enum-based kind categorization.
- `sdk/react/src/workflow/WorkflowTopologyPreview.tsx` -- Overview-context wrapper around `WorkflowTopologyGraph`. Default height 24rem, expandable to 40rem via footer toggle. Includes interaction hints and empty-state handling.

### Modified SDK Files
- `sdk/react/src/workflow/WorkflowDetailView.tsx` -- Removed `TASKS_TAB` constant and `TasksTab` component. Replaced `WorkflowTaskList` in overview with `WorkflowTopologyPreview`. Added `DescriptionContent` expand/collapse component. Set `headerMeta.description` to always `undefined`.
- `sdk/react/src/workflow/WorkflowTopologyGraph.tsx` -- Wrapped SVG in a positioned `div` container. Added floating control toolbar (Zoom In, Zoom Out, Fit to View) with inline SVG icons. New `showControls` prop (default `true`).
- `sdk/react/src/workflow/index.ts` -- Exported `topologyFromTasks`, `WorkflowTopologyPreview`, and `WorkflowTopologyPreviewProps`.

### Modified Test Files
- `test/e2e/tests/functional/workflow-detail.spec.ts` -- Removed "Tasks" from expected tabs. Updated overview section assertion to "Task Flow". Updated tab-switching test to use Instances instead of removed Tasks tab.

## Benefits

- **Reduced cognitive load**: No more duplicate information competing for attention (Nielsen heuristic #8)
- **Visual task comprehension**: Users can see branching, parallelism, and routing at a glance instead of inferring flow from a flat numbered list
- **Interactive exploration**: Zoom, pan, and fit-to-view controls let users explore complex workflows without leaving the overview
- **Consistent patterns**: Description handling now matches the agent detail view pattern

## Impact

- **Direct users**: Cleaner overview with richer task visualization
- **Platform builders**: `WorkflowTopologyPreview` and `topologyFromTasks` are exported for standalone use in custom layouts
- **Desktop parity**: All changes in SDK components -- both web and desktop get the update automatically (DD-016)

---

**Status**: Production Ready
