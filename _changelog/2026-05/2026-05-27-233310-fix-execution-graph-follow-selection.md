# Execution Graph: Auto-Select Running Task While Following

**Date**: May 27, 2026

## Summary

Coupled node selection to the follow-execution state machine so that the currently running task is automatically selected in the graph and displayed in the inspector panel. Previously, the follow-execution system only controlled viewport panning — the inspector always showed "Click a node to view execution details" until the user manually clicked a node.

## Problem Statement

When a workflow execution starts and a task begins running, the execution graph pans the viewport to follow the active node but does not select it. The inspector panel remains in its empty state, requiring the user to manually click the running node to see its details.

### Pain Points

- The inspector panel shows "Click a node to view execution details" during active execution despite the graph knowing exactly which task is running
- Users must manually click each running node to see its I/O data, agent activity, or status details
- The follow-execution system was incomplete: it tracked the active task for viewport centering but not for selection/inspection
- The `onAutoSelectTask` mechanism only fired for failed tasks on terminal executions — no running-task auto-selection existed

## Solution

Extended the "Follow" concept to encompass selection alongside viewport tracking. When `isFollowing` is true, the active task is auto-selected (showing the selection ring on the node and populating the inspector). Manual user interactions (clicking a node or the canvas background) disable follow, pausing both viewport tracking and selection tracking. The user can re-enable via the existing "Follow" toggle.

## Implementation Details

**Pure function** (`useFollowExecution.ts`): Added `computeFollowSelection` — a testable pure function (following the `computeFollowCenter` pattern) that determines whether auto-selection should update. Returns the task name to select, or `null` when no change is needed.

**Follow-selection effect** (`WorkflowExecutionGraph.tsx`): Added a `useEffect` that calls `computeFollowSelection` and wires both `setSelectedTaskName` (graph visual ring) and `onTaskSelect` (parent inspector binding) when the result is non-null.

**Manual interaction disables follow** (`WorkflowExecutionGraph.tsx`): Both `handleNodeClick` and `handlePaneClick` now call `disableFollow()` when follow is active, transitioning the state machine to `user_control`. This prevents the auto-select effect from overriding the user's manual inspection.

**Tests** (`useFollowExecution.test.ts`): 8 new unit tests for `computeFollowSelection` covering: active task selection when following, already-selected no-op, not-following no-op, no active task, task transition selection, and combined edge cases.

## Benefits

- The inspector immediately shows task details when execution starts — no manual clicking required
- As tasks complete and new ones start, the selection follows automatically
- Manual interaction is respected: clicking any node pauses follow and lets the user inspect freely
- The "Follow" toggle re-enables both viewport tracking and selection tracking
- Zero behavioral change for non-follow mode (standalone graph usage, terminal executions)

## Impact

- **Direct users**: Every workflow execution now shows task details in the inspector automatically during live runs
- **SDK consumers**: No API changes — the behavior is internal to `WorkflowExecutionGraph` and activates when `followExecution` is true
- **Client app parity**: Changes are in `@stigmer/react` SDK — web and desktop get this automatically

## Related Work

- Follow-execution state machine in `useFollowExecution.ts` — the existing `auto_fit → following → user_control` transitions
- Failed-task auto-select in `useWorkflowExecutionGraph.ts` — the terminal-phase auto-select for failed tasks (unchanged)
- ResizableSplit inspector panel — the recent resize change that made the empty inspector state more noticeable

---

**Status**: Production Ready
**Timeline**: Single session
