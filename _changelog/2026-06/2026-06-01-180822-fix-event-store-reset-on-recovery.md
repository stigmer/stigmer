# Fix Event Store Reset on Workflow Execution Recovery

**Date**: June 1, 2026

## Summary

Fixed the workflow execution event stream hook to reset its event store when an execution transitions from a terminal phase (FAILED, COMPLETED, etc.) back to an active phase (IN_PROGRESS) during recovery. Without this fix, recovering a failed execution left stale "failed" task badges in the UI while the header correctly showed "In Progress" — a contradictory state that confused users.

## Problem Statement

When a user clicked **Recover** on a failed workflow execution, the backend correctly restarted the execution (phase moved to IN_PROGRESS), but the React event store retained all events from the failed run. The `useWorkflowExecutionEventStream` hook re-subscribed for live events, but the store's derived task states still reflected the failed run's final state — tasks showed "failed" badges even though the execution was actively running.

### Pain Points

- Contradictory UI: header says "In Progress", task panel says "Failed"
- Timeline showed interleaved old and new events, making progress hard to follow
- Users had no confidence the recovery was actually working

## Solution

Detect the terminal-to-active phase transition inside `useWorkflowExecutionEventStream` and call `store.reset()` before re-subscribing. After reset, `getLatestSequence()` returns 0 and the subscription replays the full event history — including `task_skipped` events from the recovery engine (T02) that correctly represent the new run's state.

## Implementation Details

### Pure function extraction (DD-003)

Extracted `isRecoveryTransition(prevPhase, nextPhase)` as a co-located pure function in the hook file. It returns `true` when the phase transitions from any terminal phase to any non-terminal phase, and `false` when either phase is `undefined` (preventing false resets on initial load). Follows the `computeFollowCenter`/`computeFollowSelection` precedent — exported for test access, not barrel-exported.

### Phase tracking via useRef

Added `prevPhaseRef` to track the previous `executionPhase` across effect runs. The `useRef` pattern (not `useState`) was chosen because the transition drives an effect-time side effect (store mutation + gRPC subscription), not a rendered value. This is distinct from the `useState`-based "adjust state during render" pattern used in `useSessionInspector` and `ExecutionInspector` for synchronous tab switching.

### Intentional cleanup asymmetry

Unlike `useExecutionStream` (agent execution), this hook does NOT reset the store in its effect cleanup function. The reason: `connectKey` (reconnect counter) is in the effect's dependency array. Resetting on cleanup would destroy accumulated events when the user clicks "Reconnect" — incorrect for an append-only event store. The store is only reset in two cases: `executionId` becomes null, and recovery phase transition.

### Post-reset subscription semantics

After reset, `subscribeEvents(afterSequence: 0)` replays the full event history (old run + new run). The store's `deriveTaskStates` processes events in sequence order, so the last event per task wins: previously-completed tasks show "skipped" (from `task_skipped` events), and the previously-failed task shows "running" or "completed."

## Benefits

- Recovery UX is now correct: clean "connecting..." state immediately after clicking Recover, followed by the recovery run's events
- No contradictory UI states between execution header and task badges
- Platform builders embedding `<WorkflowExecutionViewer />` or using the hook directly get correct recovery behavior automatically (SDK-first, DD-001)
- 17 new tests covering the full phase transition matrix and hook integration scenarios

## Impact

- **SDK**: `@stigmer/react` — `useWorkflowExecutionEventStream` hook (behavior change, no API change)
- **Users**: Any user who clicks Recover on a failed workflow execution
- **Platform builders**: Correct recovery UX for free when using the hook or `WorkflowExecutionViewer`

## Related Work

- **T01** (Session 1): Event sequence continuation — runner continues numbering from high-water mark instead of resetting to 1
- **T02** (Session 2): Task-level resume in TS engine — emits `task_skipped` events for completed tasks during recovery
- **T03** (Session 3): Recovery flag propagation (Java + Go) — passes `recoveryMode: true` from RecoverHandler to TS child workflow

---

**Status**: Production Ready
**Timeline**: T05 of the fix-workflow-execution-recovery project (1 of 6 remaining tasks)
