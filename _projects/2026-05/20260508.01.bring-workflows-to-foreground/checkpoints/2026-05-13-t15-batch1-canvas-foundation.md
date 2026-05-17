# Checkpoint: T15 Batch 1 — Canvas Foundation

**Date**: 2026-05-13
**Status**: COMPLETE
**Phase**: Phase 2 — Visual Builder (first batch)

## Summary

Delivered the core infrastructure for the visual workflow canvas editor using
React Flow. This batch provides: graph data model, full YAML round-trip
conversion pipeline, React Flow integration with custom styled nodes/edges,
dagre auto-layout, and an orchestrator hook that renders existing workflows
as interactive draggable canvases.

## Files Created (8)

| File | Lines | Purpose |
|------|-------|---------|
| `sdk/react/src/workflow/workflow-graph-model.ts` | 82 | Pure types: WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge |
| `sdk/react/src/workflow/canvas-constants.ts` | 52 | Shared CATEGORY_COLORS, dagre config, dimensions |
| `sdk/react/src/workflow/workflow-graph-conversions.ts` | ~450 | yamlToGraph, graphToYaml, graphToWorkflowInput, toReactFlowElements |
| `sdk/react/src/workflow/CanvasTaskNode.tsx` | ~130 | Custom React Flow node component |
| `sdk/react/src/workflow/CanvasTransitionEdge.tsx` | ~60 | Custom React Flow edge component |
| `sdk/react/src/workflow/useWorkflowCanvas.ts` | ~140 | Orchestrator hook |
| `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` | ~130 | Public component with React.lazy wrapper |
| `sdk/react/src/workflow/WorkflowCanvasInner.tsx` | ~100 | Code-split inner React Flow canvas |

## Files Modified (2)

- `sdk/react/package.json` — @xyflow/react ^12.0.0 as optional peer dep, ^12.10.2 as dev dep
- `sdk/react/src/workflow/WorkflowTopologyGraph.tsx` — Extracted CATEGORY_COLORS + dagre config to shared canvas-constants.ts

## Key Decisions

- **Undo/redo deferred** to Batch 2 (no mutations in Batch 1 to undo)
- **File split**: types in `workflow-graph-model.ts`, conversions in `workflow-graph-conversions.ts`
- **Save path**: Batch 3 will extend `useWorkflowSave` to accept `WorkflowInput` directly
- **Data types extend `Record<string, unknown>`** for React Flow v12 generic constraints
- **Separate WorkflowCanvasInner.tsx** as the React.lazy code-splitting boundary
- **TaskKindRegistryContext gap**: not wired into StigmerProvider — addressed by using hardcoded category classification (same as existing topology graph) for Batch 1

## Architecture Compliance

- DD-001: SDK-first (all code in @stigmer/react)
- DD-004: Zero framework-specific imports
- DD-005: All styles via --stgm-* tokens
- DD-010: Hook return wrapped in useMemo for reference stability
- DD-013: @xyflow/react as optional peer dep, loaded via React.lazy

## Verification

- `tsc --noEmit` — zero errors for sdk/react
- No linter errors
- Existing WorkflowTopologyGraph behavior preserved

## What's Next

T15 Batch 2: Node Authoring — adds task palette (drag-to-create from categorized sidebar), connection drawing (drag from output handle to input handle), deletion (node + cascading edges), and multi-selection. This transforms the canvas from a viewer into an authoring tool.
