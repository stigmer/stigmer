# Fix: Workflow Execution Viewer Showed the Previous Run's Progress After Switching

**Date**: June 02, 2026

## Summary

Switching between two workflow executions in the desktop (and web) viewer left the second execution rendering the *first* one's progress — DAG node statuses, waterfall, events, and cost. The root cause was a long-lived, append-only event store that was never reset when the viewed `executionId` changed. We fixed it at two layers using conventions the codebase already establishes: a hook-level store reset on `executionId` identity change (mirroring `useFetch`), and a `key={executionId}` remount of the viewer in both client apps (the DD-014 pattern already used by the session viewer). This also closed a latent desktop/web parity gap.

## Problem Statement

The workflow execution detail route (`/executions/:id`) renders `WorkflowExecutionViewer`. React Router does not remount a route component when only the `:id` param changes — it re-renders the same instance with a new prop. The execution header updated correctly (it is backed by `useFetch`, which resets on identity change), but the live progress did not.

### Pain Points

- After viewing Workflow1, opening Workflow2 from the sidebar recents showed Workflow1's task states, waterfall, and cost — a confusing, incorrect view of a different run.
- Worse than a cosmetic glitch: the live subscription resumed from Workflow1's last `afterSequence`, so Workflow2's early events were skipped; the terminal (batch) path deduped Workflow2's events by sequence number and dropped them. Workflow2's real progress could fail to appear at all.
- The viewer's per-execution UI state (selected task, comparison target, graph fit/auto-select) also leaked across the switch.

## Solution

Two layers, each using the mechanism this codebase already blesses for switching the "subject" of a long-lived viewer — instead of inventing a new pattern:

1. **Hook-layer data reset on identity change.** `useWorkflowExecutionEventStream` now resets its append-only `WorkflowExecutionEventStore` when `executionId` changes to a different execution. This mirrors `useFetch`'s `prevIdentityDepsRef` behavior ("on identity dep change, reset data so stale data from a different identity is not shown"), keeping the headless hook correct on its own for any consumer (DD-003).

2. **`key={executionId}` remount at the client-app page.** Both `WorkflowExecutionDetailPage` components now key the viewer by execution id — the documented DD-014 pattern already used by the web session viewer (`SessionPageInner key={activeSessionId}`). The remount atomically resets every piece of per-execution view state, so future state additions cannot silently reintroduce the bug.

The hook fix and the remount are complementary, not redundant: the hook keeps the public streaming hook honest for embedders who use it without the viewer, while the remount gives the composed viewer a clean, future-proof reset.

## Implementation Details

- **`sdk/react/src/workflow/useWorkflowExecutionEventStream.ts`**
  - Added a `prevExecutionIdRef` and an execution-switch branch at the top of the subscription effect: when `executionId` differs from the previously-subscribed id, reset the store and clear `prevPhaseRef` before subscribing.
  - Resetting `prevPhaseRef` on the switch prevents the A→B phase delta (e.g. terminal A → running B) from being misread as a recovery transition.
  - The reset is deliberately **distinct from reconnect and recovery**: reconnect (`connectKey`) reruns the effect with the *same* id, so `prevExecutionIdRef.current === executionId` and events are preserved — the append-only store must not lose history on reconnect (unlike the snapshot-based `useExecutionStream`, which can safely reset on cleanup). Updated the hook doc comment to record this.

- **`client-apps/desktop/src/pages/workflow/WorkflowExecutionDetailPage.tsx`** and **`client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx`**
  - Added `key={id}` / `key={executionId}` to `<WorkflowExecutionViewer>` with an explanatory comment.
  - Both apps already wrap their router in `FetchCacheProvider`, and `useWorkflowExecution`/`useWorkflowExecutionArtifacts` use `cacheKey`, so the remount hydrates metadata instantly from cache on revisits — no skeleton flash.

- **`sdk/react/src/workflow/__tests__/useWorkflowExecutionEventStream.test.tsx`**
  - Added a terminal A → live B test: asserts a single store reset (not two — guarding against recovery mis-fire), cleared events, and that B's live subscription starts from `afterSequence === 0`.
  - Added a terminal A → terminal B test using shared sequence numbers and distinct task names: asserts B's events replace A's, directly catching the sequence-dedup drop bug.

## Benefits

- Switching workflow executions now shows the correct run's progress, in both desktop and web.
- Eliminates a class of silent event loss (skipped/deduped events on switch), not just the visible staleness.
- The fix is concentrated and discoverable: one canonical mechanism per layer, no scattered per-field resets that a future change could forget to extend.

## Impact

- **Users**: Desktop and web console operators monitoring workflow executions.
- **Platform builders**: The `useWorkflowExecutionEventStream` hook is now correct standalone when its `executionId` argument changes — consistent with `useFetch` and `useExecutionStream`.
- **Parity**: Closes a latent DD-016 gap where the web app keyed its session viewer but neither app keyed the workflow execution viewer.

## Related Work

- DD-009 (streaming data architecture), DD-014 (`key={id}` remounts for clean state reset), DD-016 (client-app parity) in `.cursor/rules/client-apps/sdk-console-architecture.mdc`.
- Sibling pattern: `useExecutionStream` (agent sessions) resets on cleanup because it is snapshot-based; this fix documents why the workflow event stream resets on identity change instead.

---

**Status**: ✅ Production Ready
**Timeline**: Single focused session (investigation, plan review, implementation, tests)
