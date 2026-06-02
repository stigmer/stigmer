# Fix Workflow Execution Lifecycle Action Feedback

**Date**: May 24, 2026

## Summary

Workflow execution lifecycle buttons (Recover, Cancel, Pause, Resume) appeared non-functional because the React SDK layer had two gaps: API errors were captured in hook state but never rendered, and successful actions didn't trigger the data flow chain needed to update phase, switch the event stream mode, and re-render the button set. Fixed by adding `onSuccess` callback and `clearError` to the actions hook, wiring `refetchExecution()` on success in the viewer, and rendering a dismissable error banner.

## Problem Statement

Users clicking Recover, Cancel, or Pause on workflow executions saw nothing happen -- no error message, no state change, no visual feedback of any kind. The backends (both Go OSS and Java Cloud) were fully implemented with pipeline handlers, Temporal integration, and idempotent validation. The issue was entirely in the frontend SDK.

### Pain Points

- Clicking "Recover" on a failed execution did nothing visible -- even when the backend successfully reset the Temporal workflow
- Clicking "Cancel" or "Pause" on a running execution appeared broken -- even when the backend sent the signal to Temporal
- When the backend returned an error (e.g., `FAILED_PRECONDITION` because the Temporal workflow was already purged), the user saw zero feedback

## Solution

Two-pronged fix addressing both root causes, entirely within `@stigmer/react`:

1. **State refresh after success**: Added `onSuccess` callback to `useWorkflowExecutionActions`. The `WorkflowExecutionViewer` passes `refetchExecution` as the callback. After a successful action, the execution data refetches, the phase changes, and `useWorkflowExecutionEventStream` automatically switches from batch-load to live mode via its `executionPhase` effect dependency.

2. **Error visibility**: Added a dismissable error banner in `WorkflowExecutionViewer` (using the same visual pattern as the existing stream error banner) that renders `actions.error`. Added `clearError` to the hook to match the mutation hook convention.

## Implementation Details

### `useWorkflowExecutionActions.ts`

- Added `UseWorkflowExecutionActionsOptions` interface with optional `onSuccess` callback
- Added second parameter `options?: UseWorkflowExecutionActionsOptions` to the hook
- `onSuccess` stored in a ref (same pattern as existing `stigmerRef` and `executionIdRef`) to preserve referential stability of `wrap` and all downstream action callbacks
- `wrap()` accepts `fireOnSuccess` flag: lifecycle actions fire it, approval submissions do not (approvals are background operations whose effects arrive via the event stream)
- Added `clearError: () => void` to the return type and implementation
- New type exported from barrel (`sdk/react/src/workflow/index.ts`)

### `WorkflowExecutionViewer.tsx`

- Wired `onSuccess: refetchExecution` to the actions hook
- Added action error banner below the header, above content (before the stream error banner)
- Only `refetchExecution()` needed -- `reconnect()` is redundant because `executionPhase` is already in the stream hook's effect deps (`[executionId, stigmer, connectKey, executionPhase]`)

### Key design decisions

- **Error display in Viewer, not Header**: The Header is a presentational component. The Viewer owns the banner pattern (stream error banner at line 283). Keeping both error banners in the same component maintains consistency.
- **No auto-dismiss**: Errors auto-clear on retry (line 90 of `wrap()`). Timer-based auto-dismiss adds complexity for marginal UX benefit.
- **Store safety**: `WorkflowExecutionEventStore.appendEvents()` deduplicates by `sequenceNumber > currentMax`, so events from batch-load are not duplicated when the live stream replays from the same point. No store reset needed.

## Benefits

- Recover, Cancel, Pause, Resume buttons now work end-to-end with visible state changes
- Error feedback surfaces backend errors to the user with a dismiss button
- DD-016 parity: both web and desktop apps benefit automatically (fix is SDK-internal)
- 11 new unit tests covering onSuccess callback, error state, clearError, isSubmitting lifecycle, and null executionId no-op

## Impact

- **SDK surface**: 1 new type (`UseWorkflowExecutionActionsOptions`), 1 new method (`clearError`) on existing return type -- backward compatible
- **Files modified**: 3 (`useWorkflowExecutionActions.ts`, `WorkflowExecutionViewer.tsx`, `index.ts`)
- **Files created**: 1 test file (`useWorkflowExecutionActions.test.tsx`)
- **Zero breaking changes**: New `options` parameter is optional, `clearError` is additive

## Related Work

- `2026-05-24-134907-fix-workflow-session-recovery-idempotency.md` -- Fixed Temporal recovery for agent_call tasks (backend side)
- `2026-05-21-212736-execution-test-confidence-lifecycle-coverage.md` -- E2E integration tests for lifecycle actions
- `2026-05-13-092054-workflow-execution-viewer.md` -- Original viewer feature that introduced lifecycle buttons

---

**Status**: Production Ready
**Timeline**: Single session
