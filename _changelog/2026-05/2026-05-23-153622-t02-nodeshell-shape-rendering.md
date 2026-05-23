# T02: NodeShell Component — Semantic Shape Rendering for Workflow Nodes

**Date**: May 23, 2026

## Summary

Replaced the monolithic `CanvasTaskNode` component with a decomposed `WorkflowNode` architecture that renders distinct SVG shapes (diamond, octagon, circle, bar) for non-rectangular task kinds, while preserving CSS-based rendering for the common rectangular case. This is the rendering foundation for the workflow UX overhaul — making task structure visible at a glance through semantic shape vocabulary.

## Problem Statement

All workflow canvas nodes rendered as identical rectangular cards regardless of their structural role. The only differentiation was a thin colored left border stripe and a text badge — violating WCAG 1.4.1 (color must not be the only means of conveying information) and making it impossible to scan workflow structure at a glance.

### Pain Points

- Switch Case nodes looked identical to Agent Call nodes
- Fork nodes looked identical to HTTP Call nodes
- Human Input gates were indistinguishable from data transforms
- Users had to read every badge to understand workflow topology
- `CanvasTaskNode` was a 374-line monolith mixing shape, content, handles, and interaction logic

## Solution

Implemented Decision 003 (Semantic Shape Vocabulary) by decomposing the node renderer into five single-responsibility components orchestrated by a new `WorkflowNode` entry point. Used a hybrid rendering strategy: CSS for rectangular shapes (majority case, 16 of 22 kinds) and SVG path backgrounds for non-rectangular shapes (diamond, octagon, circle, bar).

## Implementation Details

### New Component Architecture

```
WorkflowNode (React Flow entry, memo'd)
├── NodeShell (shape boundary — CSS or SVG dispatch)
├── NodeContent (task name + kind badge)
├── NodeHandles (port rendering from PortPattern)
└── NodeActions (toolbar, hover buttons, picker — design mode only)
```

### Files Created

- `sdk/react/src/workflow/WorkflowNode.tsx` — thin orchestrator
- `sdk/react/src/workflow/node-shell/shape-paths.ts` — pure SVG path functions + content insets
- `sdk/react/src/workflow/node-shell/NodeShell.tsx` — hybrid CSS/SVG renderer
- `sdk/react/src/workflow/node-shell/NodeContent.tsx` — shape-aware label layout
- `sdk/react/src/workflow/node-shell/NodeHandles.tsx` — generalized port rendering
- `sdk/react/src/workflow/node-shell/NodeActions.tsx` — extracted interaction layer
- `sdk/react/src/workflow/node-shell/index.ts` — barrel export

### Key Changes

- `WorkflowCanvasInner.tsx` nodeTypes now points to `WorkflowNode`
- `toReactFlowElements()` uses `visualSpec.defaultWidth/defaultHeight` instead of hardcoded constants (fixes dimension gap identified in T01)
- `CanvasTaskNode.tsx` deleted (internal, never exported)
- All `data-visual-class`, `data-task-kind`, ARIA labels preserved for backward compatibility

### Shape Rendering Strategy

| Visual Class | Rendering | Node Kinds |
|---|---|---|
| `task-card` | CSS div + border | agent_call, llm_call, http_call, grpc_call, etc. |
| `subworkflow-card` | CSS div + double border | run_workflow |
| `container` | CSS div + dashed border | for_each, try_catch |
| `terminal-pill` | CSS div + border-radius | __start__, __end__ |
| `decision-diamond` | SVG path | switch_case |
| `gate-octagon` | SVG path | human_input |
| `event-circle` | SVG path (arc) | wait, listen, emit_event, raise_error |
| `parallel-bar` | SVG path (rounded rect) | fork |

## Benefits

- Workflow structure visible at a glance without reading badges
- WCAG 1.4.1 compliance — shape + color + text badge (three channels)
- Single-responsibility decomposition enables independent testing and T04 execution overlay integration
- SVG paths ready for animated borders (running state), dashed borders (not-reached), progress rings (T04)
- Node dimensions now driven by visual registry (unblocks T03 ELK layout)
- 30 new unit tests, 6 new E2E assertions, zero regressions on existing 153 tests

## Impact

- **Direct**: Workflow visual editor renders semantically distinct shapes per task kind
- **Downstream**: Unblocks T03 (ELK layout uses correct dimensions), T04 (execution overlays slot into NodeShell), T12 (overview mode), T16 (accessibility)
- **SDK surface**: No public API changes — `WorkflowNode` is internal to the canvas

## Related Work

- **T01** (commit `60ef67bd9`): Created the visual registry metadata that T02 renders
- **T03**: ELK layout pipeline (parallelizable, uses T02's dimension fix)
- **DD-003**: Semantic Shape Vocabulary design decision

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
