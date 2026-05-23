# Next Task: 20260523.02.workflow-ux-implementation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260523.02.workflow-ux-implementation

**Description**: Implement state-of-the-art workflow UX based on deep research findings: graph-native execution visualization, semantic node shapes, ELK layout engine, contextual task insertion, inspector panel refactor, and comprehensive E2E test coverage.
**Goal**: Rewrite the workflow UX layer to achieve parity with or exceed AWS Step Functions, n8n, and Retool Workflows — covering execution visualization, visual editor, overview page, and monitoring — with integrated E2E tests for every feature.
**Tech Stack**: React, TypeScript, @xyflow/react v12, elkjs, Next.js, Tailwind CSS, Playwright (E2E tests)
**Components**: sdk/react/src/workflow/ (all workflow components), client-apps/web workflow pages, client-apps/desktop workflow pages, test/e2e/tests/ (E2E test suite)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-23 14:12
**Current Task**: T04 Complete — Ready for T05 (Runtime Inspector) or T08–T11 (Editor Interactions)
**Status**: In Progress

## Session Progress (2026-05-23)

### T02: NodeShell Component — COMPLETED
- Replaced `CanvasTaskNode.tsx` (374 lines) with decomposed `WorkflowNode` architecture
- Created `node-shell/` sub-module: `NodeShell`, `NodeContent`, `NodeHandles`, `NodeActions`, `shape-paths`
- `NodeShell` dispatches hybrid rendering: CSS for rectangular shapes, SVG `<path>` for diamond/octagon/circle/bar
- `NodeContent` adapts layout per visual class (compact centered for SVG shapes, flex-column for cards)
- `NodeHandles` generalizes port rendering from the visual registry's `PortPattern`
- `NodeActions` extracts design-mode interaction affordances (toolbar, picker, hover buttons)
- Fixed `toReactFlowElements()` dimension gap: now uses `visualSpec.defaultWidth/Height` instead of hardcoded constants
- 30 new unit tests (shape path validity, content insets, SVG class set)
- 6 new E2E tests (SVG presence for non-rectangular, absence for cards, selection ring, dimensions)
- All 183 workflow unit tests pass, zero regressions
- Committed as `e9f2a1ef3`

### T03: ELK Layout Pipeline — COMPLETED (parallel session)
- Created full layout module at `sdk/react/src/workflow/layout/` (8 source files + 4 test files)
- `LayoutEngine` interface: pure TypeScript, no React dependency (AD-T03-004)
- `dagre-layout-engine.ts`: extracted existing dagre code into `LayoutEngine` adapter
- `port-assignment.ts`: deterministic port IDs for switch_case, human_input, fork
- `workflow-preprocessor.ts`: `WorkflowGraphModel` → ELK JSON with port-aware edges
- `layout-postprocessor.ts`: scope filtering (whole-graph, selected, downstream) via BFS
- `elk-layout-engine.ts`: dynamic `import()` of elkjs with optional Web Worker factory
- `use-workflow-layout.ts`: React behavior hook with generation counter, error fallback
- Refactored `useWorkflowCanvas.ts`: auto-layout now dispatches `MoveNodesCommand` (undoable)
- Removed 3 `rAF→dagre→history.reset()` calls that cleared undo stack
- Added elkjs as optional peer dependency (EPL-2.0, per AD-T03-001)
- 30 new unit tests + 4 E2E test specs
- All 183 workflow tests pass (30 new + 153 existing), zero regressions

### T01: Task Type Visual Registry — COMPLETED
- Created `kind-metadata.ts` — canonical `categorizeKind()` and `kindToDisplayName()`, aligned with proto sidecar values
- Created `task-type-visual-registry.ts` — 8 visual classes, port patterns, dimensions, ARIA shape labels for all 20 task kinds + sentinels
- Consolidated 3 duplicated `categorizeKind()` implementations into one module
- Fixed category drift: `validate` → `data` (was governance), `wait` → `control_flow` (was event)
- Wired `visualClass`, `displayName`, `ariaShapeLabel` into `CanvasTaskNodeData`
- Added `data-visual-class` and `data-task-kind` attributes to `CanvasTaskNode`
- Replaced `formatKindLabel()` (underscore-to-space) with proper registry display names
- Added 26 unit tests (kind-metadata + visual registry), multi-kind E2E fixture, canvas navigation helper, 9 E2E tests
- All 153 workflow unit tests pass, zero regressions
- Committed as `60ef67bd9`

### Key Design Decisions
- DD-1: Client-side visual registry (not proto extension) — avoids cross-cutting backend changes
- DD-2: 8 visual classes (not 10) — Hick's Law: category color already differentiates AI/service/data cards
- DD-3: Consolidate categorizeKind, don't add a third system
- DD-4: Category values align with proto sidecar, not client drift
- DD-5: Port patterns are type-level descriptions, not handle renderers

### Discoveries
- `eval` (kind #20) is missing from the embedded `task-kind-registry.json` — codegen `kindOrder()` stops at 19. Separate fix needed.
- `--stgm-chart-amber` token doesn't exist in `tokens.css` but is referenced by `BranchConditionBuilder.tsx`
- Canvas is completely untested surface area — T01 added the first data attributes and E2E infrastructure

### T04: Read-Only Execution Canvas — COMPLETED
- Introduced `WorkflowGraphModeContext` providing `"design" | "overview" | "execution"` mode
- Extracted `applyDagreLayout` from private function into shared `layout/apply-dagre-layout.ts` with visual-registry-aware per-node dimensions
- Extended `CanvasTaskNodeData` with `executionState?: NodeExecutionState` (7 statuses + "not_reached")
- Extended `NodeShell` with `executionStatus` prop: status-driven border/opacity/stroke for both CSS and SVG shells
- Created `ExecutionBadge` — WCAG-compliant status badge (text/icon, never color-only)
- Modified `WorkflowNode` for mode awareness: hides `NodeActions` in execution mode, shows `ExecutionBadge`
- Built `useWorkflowExecutionGraph` hook: full pipeline from execution → workflow fetch → serialize → yamlToGraph → layout → merge DerivedTaskState
- Created `WorkflowExecutionGraph` — read-only React Flow canvas with auto-fit, follow-execution, minimap, zoom controls
- Restructured `WorkflowExecutionViewer`: graph primary, inspector stub right, collapsible timeline bottom
- Modified `CanvasTransitionEdge` for mode awareness: hides insert button in non-design modes
- 7 new files, 8 modified files
- Unit tests for layout utility and state merging
- 6 E2E tests for execution graph rendering

## Next Steps

1. **T05: Runtime Inspector Panel** — Replace inspector stub with full tabbed inspector (Input/Output/Stream/Error/Retries/Logs/Raw)
2. **T06: Branch and Parallel Execution Highlighting** — Taken/untaken branch dimming, fork N/M progress
3. **T07: Execution Waterfall Timeline** — Bottom panel redesign with waterfall bars
4. Wire `getNodeDimensions` from T01 registry into `useWorkflowLayout` hook
5. Enable ELK in client-apps by providing `workerFactory` to `createElkLayoutEngine`
6. **T08–T11: Editor Interactions** — Contextual task picker, branch management, inspector refactor, context menus

## Context for Resume

- T04 introduced `WorkflowGraphModeContext` — defaults to `"design"` for backward compatibility
- `WorkflowNode` reads mode from context: design → NodeActions; execution → ExecutionBadge
- `NodeShellProps` now includes optional `executionStatus` — applies border/opacity per status
- `CanvasTaskNodeData.executionState` is optional — absent means design mode, present means execution
- `applyDagreLayout` is now exported from `layout/` barrel — used by both editor and execution graph
- `WorkflowExecutionGraph` is a standalone SDK component (`executionId` prop only)
- `WorkflowExecutionViewer` layout: graph (flex-1) | inspector stub (w-64) on top; collapsible timeline below
- `CanvasTransitionEdge` hides insert button unless `mode === "design"`
- Data path: `execution.spec.workflowId` → `stigmer.workflow.get()` → `serializeWorkflowYaml` → `yamlToGraph` → `applyDagreLayout` → `toReactFlowElements`
- Version mismatch detection compares `status.tasks[]` task names vs graph nodes
- E2E tests in `interactive` tier: `workflow-execution-graph.spec.ts`
- All exports added to `sdk/react/src/workflow/index.ts`

## Quick Commands

After loading context:
- "Start T05" - Begin runtime inspector panel
- "Start T06" - Begin branch highlighting
- "Start T08" - Begin contextual task picker fix
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
