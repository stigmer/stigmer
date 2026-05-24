# T16: Workflow Execution Accessibility and Visual Polish

**Date**: May 24, 2026

## Summary

Implements T16 of the workflow UX overhaul: execution graph follow-execution state machine, active task indicator, SVG shape below-caption text legibility, and systematic WCAG accessibility across all workflow execution surfaces. Addresses three critical UX gaps: inability to see which task is running without manual zoom, unreadable text in non-rectangular nodes, and missing screen reader support.

## Problem Statement

From live usage of the `daily-notification-plan` execution viewer:

1. **Graph shows topology, not status** — The full workflow is zoomed-out on load with no way to tell which task is active without manually panning/zooming. The existing `followExecution` prop existed but was dead code (never passed, DD-010 violations).

2. **SVG shape text truncated beyond recognition** — The `human_input` octagon (160x160, 32px insets) gave only 96px of text width. Task names like `approve_lead_request` rendered as `_lead_r...`.

3. **No ambient status visibility** — Header showed "Running" but not WHICH task. No passive indicator of execution progress.

### Pain Points

- User must manually zoom and pan to find the active task in a 10+ node workflow
- Non-rectangular shapes (octagon, diamond, circle) have text areas too small for any real task name
- No keyboard navigation for screen reader users
- Running node border animation referenced a CSS class (`stgm-exec-running`) with no actual definition
- React Flow's JS-driven viewport animations ignored `prefers-reduced-motion`

## Solution

Three-part approach: (A) execution follow state machine + active task indicator, (B) below-shape caption architecture for SVG nodes, (C) systematic WCAG accessibility.

## Implementation Details

### Part A: Execution Follow and Active Task Visibility

- **`useFollowExecution`** — Proper state machine behavior hook (`auto_fit → following → user_control`) with:
  - User-interaction detection via React Flow v12's `onMoveStart(event)` where `event !== null` means user-initiated
  - Inspector-panel-offset centering (shifts center leftward to account for occluded viewport area)
  - Zoom preservation (never zooms OUT from user's current level, only ensures minimum 1.0)
  - Reduced-motion awareness via `getAnimationDuration()` utility
  - Debouncing for rapid task transitions (150ms)

- **`useActiveTaskName`** — Stable derivation from `taskStates` map (not nodes array — DD-010 compliant). Prioritizes `waiting_approval` over `running`. Reports concurrent count for fork branches.

- **`ExecutionActiveTaskIndicator`** — Floating overlay on graph canvas showing current task name + elapsed time. Pulsing status dot, click-to-jump, aria-live announcements. Handles approval state (amber) and concurrent fork tasks.

- **Wiring** — `WorkflowExecutionViewer` passes `followExecution={isRunning}` and `panelOffsetPx={384}` to the graph.

### Part B: SVG Shape Below-Caption Architecture

- **`captionHeight` field** added to `TaskTypeVisualSpec` — 0 for rectangular shapes, 20-24 for SVG shapes.
- **`registryNodeDimensions()`** returns `height + captionHeight` — dagre/ELK see the full bounding box, preventing overlap.
- **`NodeShell` SvgShell** renders SVG at `shapeHeight`, outer container at `shapeHeight + captionHeight`.
- **`NodeContent` `SvgShapeWithCaption`** renders kind badge centered inside shape, task name as caption below at full node width.

Shape adjustments:
| Shape | Old Dims | New (shape + caption) |
|-------|----------|----------------------|
| gate-octagon | 160×160 | 160×140 + 24 caption |
| decision-diamond | 140×140 | 140×120 + 24 caption |
| event-circle | 80×80 | 80×70 + 20 caption |

### Part C: WCAG Accessibility

- **React Flow config** — `nodesFocusable={true}`, `aria-label` on viewport container.
- **Focus rings** — `focus-visible:ring-2` on `WorkflowNode` outer div with `role="button"`.
- **`useExecutionAnnouncements`** — Diffs `taskStates` and announces via `aria-live="polite"` region: "Task X started/completed/failed/approval required".
- **`motion-preference.ts`** — `getAnimationDuration()` utility returns 0 when `prefers-reduced-motion: reduce` matches. Used in all `fitView`/`setCenter` calls.
- **Dead CSS cleanup** — Defined `stgm-exec-running` keyframe (pulse border animation with `motion-safe` guard). Removed dead `stgm-exec-badge-running` class references from `ExecutionBadge`.

## Benefits

- **Immediate visibility** — Users see which task is running at any zoom level via the floating indicator
- **Auto-follow** — Camera tracks active task during live execution without user intervention
- **Readable SVG nodes** — Task names fully visible below octagon/diamond/circle shapes (160px caption width vs 96px inscribed area)
- **Keyboard accessible** — Screen reader users can Tab through nodes and receive status announcements
- **Reduced-motion compliant** — All animations (CSS and JS-driven) respect user preference
- **SDK-embeddable** — All components work identically in the Console and third-party dashboards

## Impact

- **SDK public surface**: 5 new exports (`useFollowExecution`, `useActiveTaskName`, `ExecutionActiveTaskIndicator`, `useExecutionAnnouncements`, `getAnimationDuration`)
- **Layout engine**: All workflows will re-layout with new SVG shape dimensions (slightly taller due to caption)
- **12 modified files**, **9 new files**, **26 new unit tests** (all passing), **0 regressions** on 703 existing tests

## Related Work

- T01 (Visual Registry) — Extended with `captionHeight` field
- T02 (NodeShell) — Restructured SvgShell for caption area
- T04 (Execution Canvas) — Follow logic properly implemented
- Agent Call Live Experience — Active task indicator shows agent activity

---

**Status**: ✅ Production Ready
**Timeline**: Single session
