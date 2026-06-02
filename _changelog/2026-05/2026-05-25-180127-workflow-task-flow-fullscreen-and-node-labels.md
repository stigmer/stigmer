# Workflow Task Flow Fullscreen and Node Label Cleanup

**Date**: May 25, 2026

## Summary

Added a near-full-viewport expand mode for the workflow overview Task Flow graph so users can pan, zoom, and drag nodes during discussions and demos. Fixed dark-theme button contrast across workflow components and simplified non-rectangular node labels so task names are readable without redundant kind badges competing for space.

## Problem Statement

The Task Flow diagram on the workflow overview page was fixed at `28rem` height, making complex workflows hard to read or present. Pan and zoom existed but were impractical in the cramped viewport, and node dragging did not work because the graph used controlled nodes without persisting position changes.

Separately, several workflow UI elements used hardcoded `text-white` on theme-variable backgrounds. In dark mode, `--stgm-primary` resolves to a light accent color, producing invisible button text (e.g. "Open in editor" in the node popover).

Non-rectangular shapes (circle, octagon, diamond) showed a kind badge inside the shape plus a truncated task name in a narrow caption below. The badge duplicated information already encoded by the shape outline and category color, while the task name remained hard to read.

### Pain Points

- Task Flow graph too small for presentation and walkthroughs
- No expand affordance on the overview graph section
- Node drag in fullscreen did not stick (controlled React Flow without `onNodesChange`)
- Desktop dev blank screen after cache clear — Vite tried to pre-bundle workspace `@stgm/*` packages
- Primary/destructive buttons invisible in dark theme due to `text-white` on light `--stgm-primary`
- Circle/octagon/diamond nodes showed overlapping badge + truncated name

## Solution

Introduce a native `<dialog>` fullscreen expand mode using the established `ArtifactPreviewModal` pattern, enable ephemeral node repositioning in fullscreen via local drag-position state, and fix theme token pairing for semantic button colors. For SVG shapes, show only the centered task name inside the shape — the shape itself communicates task type.

## Implementation Details

### Fullscreen Task Flow

- Added optional `headerActions` slot to `Section` for extensible section header controls
- New `WorkflowGraphFullscreenDialog` — near-full-viewport (`95vw × 90vh`) dialog mounting a fresh `WorkflowOverviewGraph`
- Expand button wired in `WorkflowDetailView` Overview tab Task Flow section
- `WorkflowOverviewGraph` gains optional `nodesDraggable` prop; fullscreen passes `nodesDraggable={true}`
- Controlled drag support via `onNodesChange` + `dragPositions` state (resets when workflow structure changes)

### Desktop dev fix

- `client-apps/desktop/vite.config.ts`: `optimizeDeps.exclude` for `@stgm/react`, `@stgm/sdk`, `@stgm/protos`, `@stgm/theme` so Vite serves workspace TypeScript source directly instead of failing pre-bundle after cache clear

### Theme contrast fixes

Replaced hardcoded `text-white` with paired foreground tokens:

- `text-[var(--stgm-primary-foreground,#fff)]`
- `text-[var(--stgm-destructive-foreground,#fff)]`
- `text-[var(--stgm-success-foreground,#fff)]`
- `text-[var(--stgm-warning-foreground,#fff)]`

Affected: `WorkflowNodePopover`, `ExecutionComparisonPicker`, `WorkflowEditorView`, `WorkflowNode`, `DiffBadge`, `ExecutionBadge`

### Non-rectangular node labels

- `NodeContent.tsx`: single SVG path renders centered task name only; removed `SvgShapeWithCaption`
- `task-type-visual-registry.ts`: set `captionHeight: 0` for `EVENT_CIRCLE`, `GATE_OCTAGON`, `DECISION_DIAMOND`
- Rectangular cards unchanged — still show task name + kind badge stacked

## Benefits

- Users can expand Task Flow for demos and discussions without leaving the overview page
- Draggable nodes in fullscreen help untangle clustered layouts during walkthroughs (ephemeral, not persisted)
- Dark theme buttons remain readable across workflow surfaces
- Circle/octagon/diamond nodes prioritize the task name — the primary identifier users need at a glance
- Desktop dev hot reload works reliably after `make desktop-dev` cache clear

## Impact

- **Direct users**: Workflow overview and fullscreen presentation experience improved
- **Platform builders** (`@stigmer/react`): New exports `WorkflowGraphFullscreenDialog`, `Section.headerActions`, `WorkflowOverviewGraph.nodesDraggable`
- **Desktop app**: Dev server startup no longer breaks on workspace SDK pre-bundling

## Related Work

- Builds on T12 workflow overview redesign (`2026-05-23-231806-feat-workflow-overview-page-redesign-t12.md`)
- Complements workflow execution graph centering fix (`2026-05-24-161956-fix-workflow-execution-graph-centering.md`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
