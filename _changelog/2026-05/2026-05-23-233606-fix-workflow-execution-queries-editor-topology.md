# Fix Workflow Execution Queries & Replace Editor Topology Graph

**Date**: May 23, 2026

## Summary

Fixed two bugs in the workflow detail page: (1) the "Total Executions: undefined" display and empty Executions tab caused by a workflow ID vs instance ID mismatch in backend query handlers, and (2) replaced the legacy SVG topology graph in the Editor code-mode preview with the unified React Flow graph for DD-001 compliance.

## Problem Statement

After the T12 Overview Page Redesign shipped, the workflow detail page had two visible regressions:

1. The Overview tab displayed "Total Executions: undefined" and the Executions tab showed no results despite executions being visible in the sidebar navigation.
2. The Editor tab (code mode) still rendered the old `WorkflowTopologyGraph` — plain dagre-laid rectangles with category colors — while the Overview tab used the new semantic React Flow graph (diamonds for switch, bars for fork, octagons for human input).

### Pain Points

- Users see broken stats ("undefined") on the overview, eroding confidence in the dashboard
- Executions tab shows "No executions yet" despite having run many workflows
- Visual disconnect between Editor preview and Overview graph violates DD-001 ("One Graph, Three Modes")

## Solution

**Execution query fix**: Updated both Go (OSS) and Java (Cloud) backend handlers to match executions by either `spec.workflowId` OR `spec.workflowInstanceId`, honoring the proto contract that the `workflow_id` request field accepts both formats.

**UI guard**: Added defensive `typeof` guards in `WorkflowOverviewSummary` so that stale app builds that lack the `totalCount` proto field show "No executions yet" instead of "undefined".

**Editor topology replacement**: Created `WorkflowCodePreviewGraph` — a lightweight React Flow graph that accepts YAML directly and renders using the unified node/edge system in "overview" mode. Deleted the old `WorkflowTopologyGraph` component.

## Implementation Details

### Backend Fixes (Go OSS + Java Cloud)

- `get_execution_summary.go`: Changed filter from single-field check to OR check — skip execution only if neither `GetWorkflowId()` nor `GetWorkflowInstanceId()` matches
- `list_by_workflow.go`: Same OR logic — match execution where either spec field equals the requested ID
- `WorkflowExecutionRepo.java` (Cloud): Rewrote `findByIdsAndWorkflowInstanceId` to use `$or` clause in the MongoDB query matching both `spec.workflowInstanceId` and `spec.workflowId`
- `WorkflowExecutionGetExecutionSummaryHandler.java` (Cloud): Added `getWorkflowInstanceId()` check alongside existing `getWorkflowId()` check

### Frontend Fixes

- `WorkflowOverviewSummary.tsx`: Added `typeof` guards for `totalCount` and `successRate` to handle absent proto fields gracefully
- `WorkflowCodePreviewGraph.tsx` (new): Lightweight React Flow graph accepting YAML string, using `yamlToGraph` → `applyDagreLayout` → `toReactFlowElements` pipeline with `WorkflowNode` + `CanvasTransitionEdge` in "overview" mode
- `WorkflowEditorView.tsx`: Swapped `WorkflowTopologyGraph` import for `WorkflowCodePreviewGraph`
- Deleted `WorkflowTopologyGraph.tsx` (355 lines removed, no remaining consumers)
- Updated barrel exports in `index.ts` and root `src/index.ts`
- Updated SDK docs (`workflow.mdx`)

## Benefits

- **Correct execution data**: Both ListByWorkflow and GetExecutionSummary now properly resolve executions regardless of whether the frontend passes a Workflow ID or Instance ID
- **No more "undefined"**: Defensive guards prevent broken display on stale builds or when proto fields are absent
- **DD-001 compliance**: All three workflow graph surfaces (overview, editor preview, execution viewer) now use the unified React Flow rendering with semantic shapes
- **Reduced code**: Net -332 lines (deleted 355-line SVG component, added lightweight 120-line React Flow wrapper)

## Impact

- **Backend (Go OSS)**: 2 files modified — `get_execution_summary.go`, `list_by_workflow.go`
- **Backend (Java Cloud)**: 2 files modified — `WorkflowExecutionRepo.java`, `WorkflowExecutionGetExecutionSummaryHandler.java`
- **SDK**: 1 file deleted, 1 file created, 4 files modified
- **Docs**: 1 file updated

## Related Work

- T12: Overview Page Redesign — introduced `totalCount`/`successRate` fields and `WorkflowOverviewGraph`; this fix addresses regressions from that change
- DD-001: One Graph, Three Modes — this completes the rollout by retiring the last legacy graph consumer

---

**Status**: Production Ready
**Timeline**: Single session (~20 min implementation)
