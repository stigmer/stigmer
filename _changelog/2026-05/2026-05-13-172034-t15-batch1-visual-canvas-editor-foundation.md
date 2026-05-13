# T15 Batch 1: Visual Canvas Editor Foundation

**Date**: May 13, 2026

## Summary

Delivered the foundational infrastructure for the visual workflow canvas editor — the first batch of Phase 2 (Visual Builder). This adds React Flow integration with custom styled nodes/edges, a full YAML round-trip conversion pipeline, dagre auto-layout, and an orchestrator hook that renders existing workflows as interactive draggable canvases. All code lives in `@stigmer/react` following SDK-first architecture.

## Problem Statement

Users can currently edit workflows only through YAML with a read-only topology graph preview (T10). There is no visual authoring experience — no drag-and-drop construction, no interactive node manipulation, no visual feedback loop for workflow structure. The T15 plan calls for a full visual canvas editor, and Batch 1 establishes the core infrastructure that all subsequent batches (palette, inspector, specialized editors, integration) build upon.

### Pain Points

- YAML-only editing requires users to mentally model the workflow DAG
- No way to visually validate task transitions before saving
- The existing SVG topology graph is read-only (no interaction beyond pan/zoom)
- Platform builders embedding Stigmer have no visual workflow component to offer their users

## Solution

Built the complete data model and rendering infrastructure for a React Flow-based interactive canvas, loaded lazily (DD-013) so non-canvas consumers pay zero bundle cost. Established the conversion pipeline that enables bidirectional YAML ↔ graph model ↔ React Flow elements mapping.

## Implementation Details

### Graph Data Model (`workflow-graph-model.ts`)
- `WorkflowGraphModel` — top-level container with document metadata, env, budget, nodes, edges
- `WorkflowGraphNode` — task node with full config, export, flow, position, category
- `WorkflowGraphEdge` — directed edge with optional label and sourceHandle for multi-port nodes

### Conversion Pipeline (`workflow-graph-conversions.ts`)
- `yamlToGraph()` — Parses YAML, builds nodes for all 19 task kinds, infers edges from sequential ordering, explicit `flow.then`, `switch_case` branches, `human_input` outcomes
- `graphToYaml()` — Topological sort for task ordering, implicit vs explicit flow serialization
- `graphToWorkflowInput()` — Direct conversion to `WorkflowInput` for SDK save path
- `toReactFlowElements()` — Maps graph model to React Flow typed node/edge arrays

### React Flow Components
- `CanvasTaskNode` — Category-colored border, name, kind badge, multi-port handles for switch_case
- `CanvasTransitionEdge` — Smoothstep routing, arrowhead, optional label pill
- `WorkflowCanvasEditor` — Public component with React.lazy wrapper, toolbar, error states
- `WorkflowCanvasInner` — Code-split inner canvas (Controls, MiniMap, Background)

### Orchestrator Hook (`useWorkflowCanvas`)
- Manages graph state from YAML input
- Dagre auto-layout on mount and explicit button
- React Flow callbacks (position drag, node/edge click)
- Selection tracking and dirty state detection

### Shared Constants (`canvas-constants.ts`)
- `CATEGORY_COLORS` extracted from `WorkflowTopologyGraph` for consistency
- `DAGRE_CONFIG` shared between read-only graph and interactive canvas
- Node dimension constants for canvas and sentinel nodes

## Benefits

- **Foundation for Phase 2**: All subsequent T15 batches (palette, inspector, specialized editors) build directly on this infrastructure
- **Zero bundle impact**: React.lazy + optional peer dep means non-canvas consumers pay nothing
- **SDK-first**: Embeddable by platform builders, not coupled to Console routing
- **Consistent theming**: Same `--stgm-*` tokens and category colors as the existing topology graph
- **Full round-trip**: YAML → Graph → YAML preserves semantic equivalence

## Impact

- **SDK users**: New `WorkflowCanvasEditor` component available (not yet exported from barrel — Batch 5)
- **Internal**: `WorkflowTopologyGraph` unaffected — pure extraction of shared constants
- **Bundle**: @xyflow/react (~200KB) only loaded when canvas is rendered (React.lazy)

## Related Work

- T10 (YAML Editor with Graph Preview) — The read-only topology graph that T15 builds alongside
- T15 Plan (`tasks/T15_0_plan.md`) — Full 5-batch plan for the visual canvas editor
- DD-013 (React.lazy for optional heavy dependencies) — Pattern followed for @xyflow/react

---

**Status**: ✅ Production Ready (Batch 1 of 5)
**Timeline**: Single session delivery
