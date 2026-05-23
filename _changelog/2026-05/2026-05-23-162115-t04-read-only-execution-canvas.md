# T04: Read-Only Execution Canvas

**Date**: May 23, 2026

## Summary

Replaced the log-centric workflow execution viewer with a graph-native execution cockpit. The execution page now renders a read-only React Flow canvas with live node status overlays, reusing the same `WorkflowNode` / `NodeShell` shape system from T02. This eliminates the primary UX disconnect where users design workflows visually but must debug executions through flat event logs.

## Problem Statement

The existing `WorkflowExecutionViewer` was a scrolling event timeline with a flat task-status sidebar. Users had no structural context — they couldn't see which branch was taken, which parallel paths were active, or where in the graph a failure occurred. Every best-in-class workflow tool (AWS Step Functions, Airflow, Inngest, Azure Logic Apps) provides a graph-native execution view. Stigmer's log-only approach was below the quality bar.

### Pain Points

- Users must mentally translate between the visual editor graph and the flat execution log
- No at-a-glance answer to "what is running right now?"
- Failed tasks buried in event streams rather than highlighted in context
- Task relationships (sequential, branching, parallel) invisible during execution
- Platform builders embedding Stigmer cannot show execution progress visually

## Solution

Introduced a unified graph mode architecture (`design` / `overview` / `execution`) via a React context. The execution graph component fetches the workflow definition, builds a layout-computed graph model, and overlays live execution state from the event stream onto each node.

## Implementation Details

### New Files (7)

| File | Purpose |
|------|---------|
| `layout/apply-dagre-layout.ts` | Shared synchronous dagre layout with visual-registry-aware per-node dimensions |
| `WorkflowGraphModeContext.tsx` | React context providing `"design" | "overview" | "execution"` mode |
| `node-shell/ExecutionBadge.tsx` | WCAG-compliant status badges (checkmark, X, spinner, etc.) |
| `useWorkflowExecutionGraph.ts` | Behavior hook: fetch workflow → serialize → parse → layout → merge execution state |
| `WorkflowExecutionGraph.tsx` | Read-only React Flow canvas with auto-fit, follow-execution, and minimap |
| `__tests__/execution-graph.test.ts` | Unit tests for layout utility and state merging |
| `workflow-execution-graph.spec.ts` | E2E tests for the execution graph |

### Modified Files (8)

- **`WorkflowNode.tsx`**: Mode-aware rendering — hides `NodeActions` in execution mode, shows `ExecutionBadge`
- **`NodeShell.tsx`**: Added `executionStatus` prop with status-driven border/opacity/stroke styling
- **`workflow-graph-conversions.ts`**: Added `NodeExecutionStatus`, `NodeExecutionState` types and `executionState` field
- **`CanvasTransitionEdge.tsx`**: Mode-aware — hides insert button in non-design modes
- **`WorkflowExecutionViewer.tsx`**: Restructured layout (graph primary, inspector stub right, timeline collapsible below)
- **`useWorkflowCanvas.ts`**: Replaced private `applyDagreLayout` with import from shared module
- **`layout/index.ts`**: Added `applyDagreLayout` export
- **`index.ts`**: Added all T04 public SDK exports

### Architecture Decisions

- **AD-T04-001**: Graph primary, timeline secondary — follows research report consensus
- **AD-T04-002**: Deterministic dagre re-compute (no layout persistence yet — dagre is deterministic, same graph = same positions)
- **AD-T04-003**: Fetch `Workflow` proto via `workflowId` → `serializeWorkflowYaml` → `yamlToGraph` (proven pipeline)
- **AD-T04-004**: Mode delivered via React context, not per-node data
- **AD-T04-005**: SDK-embeddable from day one — `<WorkflowExecutionGraph executionId="..." />` works standalone

### Data Pipeline

```
execution.spec.workflowId
  → stigmer.workflow.get(id)
  → serializeWorkflowYaml(workflow)
  → yamlToGraph(yaml)
  → applyDagreLayout(graph)
  → toReactFlowElements(graph)
  → merge DerivedTaskState from event stream
  → React Flow nodes with executionState
```

## Benefits

- Users see execution progress on the same graph structure they designed
- Failed nodes are auto-selected and visually highlighted — no log scrolling
- Running nodes show animated status — instant "what's happening?" answer
- Collapsible timeline preserves event-level detail when needed
- Platform builders get an embeddable `<WorkflowExecutionGraph />` component
- Shared layout utility advances T03 goal (visual-registry-aware dimensions)

## Impact

- **SDK consumers**: New public exports — `WorkflowExecutionGraph`, `useWorkflowExecutionGraph`, `WorkflowGraphModeProvider`, `useWorkflowGraphMode`
- **Console users**: Execution detail page now shows graph with status overlays as primary view
- **Existing editor**: Zero regressions — mode context defaults to `"design"`, all existing behavior preserved
- **Accessibility**: Status badges use text/icon differentiation (not color alone), `data-execution-status` attributes for testing, ARIA labels include execution state

## Related Work

- **T01** (Task Type Visual Registry): Provides per-kind dimensions used by `applyDagreLayout`
- **T02** (NodeShell): Shape rendering reused unchanged in execution mode
- **T03** (ELK Layout Pipeline): Layout module extended with shared `applyDagreLayout` export
- **T05** (Runtime Inspector): Inspector stub created — full implementation is next task
- **T06** (Branch Highlighting): Edge status rendering deferred — basic opacity only in T04

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
