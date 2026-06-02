# Workflow HITL Approval Read-Only Summary

**Date**: June 2, 2026

## Summary

The workflow execution inspector's **Approval** tab now switches to a read-only "decision report" once a human_input gate is resolved, instead of indefinitely showing the interactive approve/reject form. The report presents the captured decision — chosen outcome, reviewer, time, comment, and submitted form answers — sourced from the canonical task-output record. This is a pure `@stigmer/react` change (no proto, runner, or codegen) and is inherited by both the web console and desktop app.

## Problem Statement

After a reviewer approved (or rejected) a workflow human_input gate and the execution moved on, returning to the **Approval** tab in the execution inspector still showed the live approve/reject buttons and input fields — as if no decision had been made. A settled gate could be presented for a second decision, and the decision that *was* made was never surfaced in that tab.

### Pain Points

- A resolved gate kept offering its interactive form forever — confusing and a latent double-submit affordance.
- The recorded decision (which outcome, who, when, any comment/feedback) was invisible on the Approval tab.
- The inspector disagreed with the Events timeline, which already gated correctly on `status === "waiting_approval"` — an inconsistency between two surfaces of the same data.

## Solution

Gate the inspector's approval content on task status, and add a read-only summary for the resolved state, sourced from the **canonical decision record**.

A human_input task's output *is* its decision: the runner persists the reviewer's full response (`{ outcome, reviewer, responded_at, comment, form_data, auto_resolved }`) as the task output — a `google.protobuf.Struct` that preserves every field. The read-only summary reads that record (already exposed as `detail.output`), so no new event surface or backend change was needed. The decision stays single-sourced.

## Implementation Details

### `derive-task-detail.ts`

`TaskDetailApprovalDecision` now carries `{ outcome, reviewer, respondedAt, comment, formData, waitDurationMs, autoResolved }`. `buildApproval(buckets, taskOutput)` builds it snapshot-first (from the task-output Struct), falling back to the lightweight `approval_resolved` event for fields the snapshot has not captured yet (the brief window after a decision is signalled but before the status snapshot refreshes). Internal keys such as `__flow_directive__` are ignored. The function remains pure and fully unit-tested.

### `WorkflowTaskApprovalSummary.tsx` (new)

Read-only decision report: prompt (markdown), the chosen outcome's human-readable label (resolved from the configured outcomes, with a tone-based affordance for approve/reject/neutral), reviewer + timing, the comment, and submitted form answers. When the decision record is not yet available it shows a "decision recorded — finalizing…" affordance that resolves to the full report on next load. All visual properties use `--stgm-*` tokens — including the dedicated `*-subtle` variants, so no opacity modifiers; `memo`'d; zero framework deps; exposes a labelled `group` region for accessibility. Exported from the workflow barrel beside `WorkflowTaskApprovalCard`.

### `ExecutionInspector.tsx`

The workflow human_input approval branch now renders the interactive `WorkflowTaskApprovalCard` only while `detail.status === "waiting_approval"`; otherwise it renders the read-only `WorkflowTaskApprovalSummary`. The Approval tab stays visible after resolution so the decision remains reviewable.

### Testing

- `derive-task-detail.test.ts`: decision sourced from the task-output snapshot; snapshot-over-event precedence; event-only "finalizing" window; `auto_resolved` read and internal keys ignored.
- `WorkflowTaskApprovalSummary.test.tsx` (new, 13 tests): outcome-label mapping and fallback, reviewer/timing/comment/form rendering, finalizing fallback, read-only (no buttons), a11y region.
- `ExecutionInspector.test.tsx` (new, 2 tests): `waiting_approval` renders interactive buttons; resolved renders the read-only summary with the captured outcome/comment and no buttons.
- `npm run test -w @stigmer/react` (65 tests across the three files pass), `npm run lint -w @stigmer/react` (0 errors; touched files add 0 warnings), `npm run typecheck -w @stigmer/react` (clean).

## Benefits

- A resolved gate is never offered for a second decision; the captured decision is now visible where the reviewer made it.
- One source of truth for the decision (the task output), no redundant event/proto surface, smallest possible footprint.
- The Approval tab and the Events timeline now agree on resolution state.
- The read-only view ships as a reusable, embeddable SDK component for platform builders.

## Impact

- **Surface**: workflow execution inspector Approval tab (web console + desktop, via the shared `WorkflowExecutionViewer`; DD-016 parity preserved — no client wiring change).
- **API**: new exported `WorkflowTaskApprovalSummary` component + props; `TaskDetailApprovalDecision` shape changed (outcome/formData/respondedAt/autoResolved replace the former enum-string `action`/`resolvedBy`).
- **No backend/proto/codegen impact.**

## Related Work

- Builds on the workflow HITL approval UI (`WorkflowTaskApprovalCard`, `submitWorkflowTaskApproval`) and the runtime inspector's `derive-task-detail` pipeline.

## Tracked Follow-Up (separate change)

The `approval_resolved` **event** remains impoverished and should be fixed on its own:

- `backend/services/runner/src/workflow-engine/tasks/human-input.ts` hardcodes `comment: ""` when emitting `approval_resolved`, dropping the reviewer's comment from the event even though the submit RPC relays it.
- `ApprovalResolvedPayload` (`apis/.../workflowexecution/v1/event.proto`) has no `outcome` string — only an `ApprovalAction` enum that cannot represent custom workflow outcomes (e.g. `pause_campaigns`), so `workflow-event-activities.ts` cannot map the chosen outcome.

Consequence: the **Events timeline** ("Approval resolved by …") cannot show the comment or chosen outcome. This does not affect the new Approval-tab summary (which reads the canonical task output). Closing it requires an additive proto field (`outcome`) plus runner emission fixes and codegen — intentionally out of scope here to keep the decision record single-sourced.

---

**Status**: ✅ Production Ready
**Scope**: `@stigmer/react` only (no proto / runner / codegen)
