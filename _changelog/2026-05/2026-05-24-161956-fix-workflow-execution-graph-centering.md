# Fix Workflow Execution Graph Centering on Active Node

**Date**: May 24, 2026

## Summary

Fixed the workflow execution graph viewport centering so the currently executing node appears at the center of the visible canvas instead of being pushed to the rightmost edge. Also improved the timing of the follow-execution state machine transition by converting a ref-based flag to React state.

## Problem Statement

When a workflow execution loaded, the graph would zoom to the currently active (running) task node but position it near the right edge of the canvas rather than centering it. This made the execution feel off-balance and required manual panning to see the full graph context around the active node.

### Pain Points

- Active node appeared at the rightmost corner of the canvas, adjacent to the inspector panel border
- Users had to manually pan left to see the execution graph context
- The follow-execution state machine had a subtle timing delay: the `auto_fit → following` transition waited for an unrelated streaming re-render because the initial-fit flag was stored as a ref (not state)

## Solution

The root cause was a `panelOffsetPx={384}` prop on `WorkflowExecutionGraph` that compensated for an inspector panel that was assumed to be overlaying the React Flow canvas. In reality, the inspector is a **flex sibling** — the React Flow container already excludes it from its layout, so the offset double-compensated and pushed the centered point rightward.

The fix removed the incorrect offset value while preserving the `panelOffsetPx` API on the `useFollowExecution` hook for legitimate overlay scenarios (e.g., platform builders embedding the execution graph with a floating panel on top).

## Implementation Details

### 1. Removed incorrect `panelOffsetPx={384}` (`WorkflowExecutionViewer.tsx`)

The layout is a side-by-side flex container:
- `WorkflowExecutionGraph` with `className="flex-1"` (left, fills remaining space)
- `<aside>` with `className="w-80 lg:w-96"` (right, fixed 320-384px)

Since the React Flow canvas occupies only the `flex-1` region, `setCenter` already centers within the unoccluded area. The 384px offset shifted the target point 192px leftward in flow coordinates (at zoom 1.0), which made the node appear 192px right of screen center — near the inspector border.

Removing the prop lets the default `panelOffsetPx=0` apply, centering the node correctly.

### 2. Converted `didFitRef` to `useState` (`WorkflowExecutionGraph.tsx`)

The initial fitView completion flag was stored as a `useRef`. Setting `didFitRef.current = true` inside the fitView effect does not trigger a React re-render, so `useFollowExecution` received the stale `false` value until the next render was triggered by streaming task-state updates. This caused a brief delay in the `auto_fit → following` transition.

The fix uses a `useState` flag (`didInitialFit`) alongside a `useRef` guard (`didFitGuardRef`) to prevent double-execution. The `setDidInitialFit(true)` call inside the `setTimeout` callback triggers a re-render, delivering the updated value to the hook immediately after the initial fit completes.

### 3. Extracted `computeFollowCenter` pure function (`useFollowExecution.ts`)

Extracted the centering math from the hook's debounce callback into an exported pure function with a typed interface (`FollowCenterInput → FollowCenterResult`). This follows DD-003 (headless-first) — the logic is independently testable without requiring React Flow or DOM mocks.

The hook's internal debounce callback now calls `computeFollowCenter()` and passes the result to `setCenter`.

### 4. Unit tests (`useFollowExecution.test.ts`)

9 test cases covering:
- Exact centering at node midpoint with no offset (default)
- Leftward offset when `panelOffsetPx` is provided (overlay scenario)
- Inverse zoom scaling of offset
- Minimum zoom enforcement (clamps to 1.0)
- Edge cases: origin position, negative positions, high zoom, negative `panelOffsetPx`

## Benefits

- Active node now centers correctly in the visible canvas area during live execution
- Follow-execution transitions from `auto_fit` to `following` immediately after the initial fit, without waiting for a streaming re-render
- The `panelOffsetPx` API is preserved for platform builders who embed the execution graph with overlay panels
- The centering math is independently testable and documented with typed interfaces

## Impact

- **Direct users**: Execution monitoring UX improvement — the active node is centered, providing balanced visual context of the DAG
- **Platform builders**: No breaking changes — `panelOffsetPx` prop is still available for overlay panel scenarios
- **Codebase**: `computeFollowCenter` is now a testable, exported pure function in the SDK public surface

## Related Work

- Part of the Workflow UX Implementation project (20260523.02)
- T16: Accessibility and Visual Polish — introduced the `useFollowExecution` state machine
- T04: Read-Only Execution Canvas — created `WorkflowExecutionGraph`

---

**Status**: Production Ready
