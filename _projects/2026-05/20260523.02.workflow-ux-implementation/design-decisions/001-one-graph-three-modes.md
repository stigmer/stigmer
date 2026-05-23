# Decision 001: One Graph, Three Modes

**Date**: 2026-05-23
**Status**: Proposed
**Source**: Deep research report

## Context

The current implementation has three separate rendering systems for the workflow graph:
1. **Visual editor**: React Flow with custom `CanvasTaskNode` / `CanvasTransitionEdge`
2. **Read-only preview**: Custom SVG with dagre (`WorkflowTopologyGraph`)
3. **Execution viewer**: Log-based timeline (no graph at all)

This creates a disconnect: users design visually but execute as logs.

## Decision

Build one unified `WorkflowGraph` component powered by `@xyflow/react` that supports three rendering modes via a `mode` prop:

```ts
type WorkflowGraphMode = "design" | "overview" | "execution";
```

| Mode | Behavior |
|------|----------|
| **Design** | Draggable, connectable, editable, plus buttons, inspector config |
| **Overview** | Pannable/zoomable, task summary popovers, recent health badges |
| **Execution** | Read-only, status overlays, branch highlighting, runtime inspector |

All three modes share the same `WorkflowSemanticModel`, `TaskTypeRegistry`, and `GraphViewModel`.

## Consequences

- Eliminates the custom SVG renderer (`WorkflowTopologyGraph`)
- Execution view uses the exact same layout as the editor
- Consistent visual grammar across all surfaces
- Single codebase to maintain for node/edge rendering
- Execution must render against workflow version snapshot (not latest draft)

## Alternatives Considered

- Keep separate renderers (rejected: causes semantic drift)
- Use a different library for execution view (rejected: unnecessary complexity)
