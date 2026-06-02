# Fix Execution Graph Viewport Centering Regression

**Date**: June 1, 2026

## Summary

Fixed a regression in the workflow execution graph where the viewport failed to center on the active running task, leaving the user staring at an empty canvas. The bug was caused by a double-compensation of the inspector panel width after `ResizableSplit` was introduced, and was compounded by a fragile `setTimeout`-based initial fit that could race with container layout.

## Problem Statement

When viewing a running workflow execution, the graph viewport should automatically pan to follow the currently executing task. After the `ResizableSplit` component was introduced to make the inspector panel resizable, the viewport started rendering blank — the nodes were present (visible in the minimap) but the camera was pointing at empty space.

### Pain Points

- Users see a blank canvas with only background dots when a workflow execution is running
- The follow-execution camera pushes the active node out of the visible viewport
- The initial fit-to-all-nodes can miss its window due to a 50ms setTimeout racing with container layout

## Solution

Identified this as a regression of a previously fixed bug (`67887a131`). The `ResizableSplit` commit (`148146715`) re-wired `panelOffsetPx={panelWidth}` under the assumption the offset was needed for correct centering. However, `ResizableSplit` uses a flex-sibling layout — the ReactFlow container already has the correct reduced width, making the offset double-compensate by 192+ flow units.

## Implementation Details

### 1. Removed double-compensating panelOffsetPx wiring

In `WorkflowExecutionViewer.tsx`, removed the `panelWidth` state, the `onResize={setPanelWidth}` callback on `ResizableSplit`, and the `panelOffsetPx={panelWidth}` prop on `WorkflowExecutionGraph`. The prop defaults to 0, which is correct for flex-sibling layouts.

### 2. Replaced setTimeout with onInit callback

In `WorkflowExecutionGraph.tsx`, replaced the fragile 50ms `setTimeout` initial `fitView` with ReactFlow's `onInit` callback. The new approach tracks initialization state via a ref and handles both timing scenarios: nodes arriving before `onInit` and nodes arriving after (async data). This eliminates the race condition between the timer and ReactFlow's internal `ResizeObserver`.

### 3. Documented panelOffsetPx semantics

Updated the `panelOffsetPx` JSDoc on `WorkflowExecutionGraphProps` to clarify that it is only needed when the inspector **overlays** the canvas (e.g., `position: absolute`). When the inspector is a flex sibling (as with `ResizableSplit`), it must be 0 to avoid double-compensation.

### 4. Regression test

Added a regression test in `useFollowExecution.test.ts` that asserts `computeFollowCenter` returns an unshifted center at multiple zoom levels when `panelOffsetPx` is 0, with comments referencing the original fix and regression commits.

## Benefits

- Workflow execution graph correctly centers on the active task during execution
- Initial viewport fit is more reliable across different container layout timings
- The `panelOffsetPx` contract is documented to prevent future regressions
- Regression test guards against re-introducing the same double-compensation bug

## Impact

- **Users**: Workflow execution monitoring works correctly again — the camera follows the running task as intended
- **SDK consumers**: `WorkflowExecutionGraph` and `WorkflowExecutionViewer` viewport behavior is restored; the `panelOffsetPx` prop contract is now clearly documented for third-party integrators using overlay layouts

## Related Work

- Commit `67887a131`: Original fix for this exact bug (removed hardcoded `panelOffsetPx={384}`)
- Commit `148146715`: Introduced `ResizableSplit` and re-wired `panelOffsetPx`, causing the regression
- Commit `189297c0f`: Introduced the follow-execution state machine (`useFollowExecution`)

---

**Status**: Production Ready
**Timeline**: 1 session
