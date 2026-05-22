# Workflow Human Input Approval UI — End-to-End Implementation

**Date**: May 22, 2026

## Summary

Implemented the complete pipeline for interactive human_input approval in workflow executions — from proto enrichment and event emission through the Go backend handler to the React SDK approval card. This closes the gap where workflow executions paused at human_input tasks showed a read-only "Approval requested" message with no way for users to respond.

## Problem Statement

The workflow execution viewer displayed human_input tasks as static text — users could see "Approval requested" with the prompt, approvers, and timeout, but there were no interactive buttons to approve, reject, or provide feedback. The backend gRPC contract (`submitWorkflowTaskApproval`) existed but had no OSS Go handler, no React hook, and no UI component.

### Pain Points

- Workflow executions paused at human_input tasks could only be resolved via CLI or direct gRPC calls
- The execution viewer timeline was empty for TS-runner workflows because the event emission pipeline was lost in the Go-to-TS runner migration
- The `ApprovalRequestedPayload` proto lacked `outcomes` and `form_schema`, so even when events existed, the UI couldn't render custom outcome buttons
- The Tiny Tactics demo workflows use 3-way outcomes ("Pause Active Campaigns", "Adjust Strategy", "Monitor Only") that cannot be represented by hardcoded Approve/Reject buttons

## Solution

A vertically integrated implementation across 5 layers: proto, TS runner, Go server, React SDK hook, and React SDK component.

## Implementation Details

### 1. Proto Enrichment (event.proto)

Added `HumanInputOutcomeInfo` message (lightweight subset of `HumanInputOutcome` — excludes `then` routing field) and extended `ApprovalRequestedPayload` with `outcomes[]` and `form_schema`. Regenerated stubs across both repos (Go, TS, Python, Java, Dart).

### 2. TS Runner Event Emission Pipeline (NEW INFRASTRUCTURE)

Restored the event emission capability lost in the Go-to-TS runner migration:

- **Event descriptor types** (`types.ts`): Plain-object `WorkflowEventDescriptor` union type for sandbox-safe event construction
- **Emission activity** (`workflow-event-activities.ts`): Temporal local activity that converts descriptors to proto objects and sends via `updateWorkflowExecutionStatus` gRPC
- **Engine wiring** (`engine-core.ts`): Emits `execution_started`, `execution_completed`, `execution_failed` events
- **Task loop wiring** (`do-executor.ts`): Emits `task_started`, `task_completed`, `task_failed`, `task_skipped` for every task
- **Human input wiring** (`tasks/human-input.ts`): Emits `approval_requested` (with outcomes + form_schema from task config) before blocking and `approval_resolved` after signal received
- **Loader extension** (`loader.ts`): Parses `form_schema`, `approvers`, `outcomes[].label` from human_input task config

### 3. OSS Go Backend Handler

Created `submit_workflow_task_approval.go` with a 5-step pipeline: ValidateInput, LoadExecution, ValidateSignalable, ValidateHumanInputTask, SendSignal. The signal delivery uses `relaySignal` wrapping — the signal is sent to the Go outer workflow's `relaySignal` channel as a `RelaySignalPayload{SignalName, Payload}`, which the outer workflow's relay handler forwards to the TS child workflow via `SignalExternalWorkflow`.

Also exported `RelaySignalPayload` (was unexported `relaySignalPayload`) from the workflows package so controllers can construct relay payloads.

### 4. React SDK Hook

Added `submitTaskApproval(taskName, outcome, formData?, comment?)` to `useWorkflowExecutionActions`. Uses the existing `wrap()` pattern with `useCallback` + `useRef` for referential stability.

### 5. React SDK Component + Wiring

Created `WorkflowTaskApprovalCard` — an interactive card rendered inline in the execution timeline when a human_input task is in `waiting_approval` state. Features:

- Dynamic outcome buttons from workflow configuration (label text, first=primary, reject=destructive, others=secondary)
- JSON Schema-driven form fields from `form_schema` (text properties render as textareas)
- Comment textarea
- Per-button loading spinner
- Fallback to default Approve/Reject when outcomes are empty
- Keyboard navigation, ARIA labels, theme token compliance

Wired through the component tree: `WorkflowExecutionViewer` passes `taskStates` + `actions.submitTaskApproval` to `WorkflowExecutionTimeline`, which passes to `WorkflowExecutionTimelineEvent`, which renders `WorkflowTaskApprovalCard` in the `approvalRequested` case when `isWaiting && isHumanInput`.

Card auto-dismissal is already handled by the event store — when `approvalResolved` arrives, `waiting_approval` clears and the card disappears.

## Benefits

- Workflow executions with human_input tasks are now fully interactive in the web app — no CLI or API required
- The execution viewer timeline lights up with task progress events for the first time on the TS runner
- Custom workflow outcomes (3-way decisions, domain-specific labels) render correctly
- Form fields enable structured data collection during approval
- DD-016 parity: both web and desktop apps get the feature automatically via the SDK component

## Impact

- **Users**: Can approve/reject workflow tasks directly in the execution viewer
- **Demo readiness**: Tiny Tactics workflows (daily-notification-plan, risk-escalation, weekly-strategy-review) can now be demonstrated end-to-end in the web app
- **Platform builders**: `WorkflowTaskApprovalCard` is exported from `@stigmer/react` as an embeddable component
- **Future features**: The event emission pipeline is foundational — budget monitoring, artifact display, and signal visualization will light up for free

## Related Work

- Proto contract: `SubmitWorkflowTaskApprovalInput` (T13b)
- Java cloud handler: `WorkflowExecutionSubmitWorkflowTaskApprovalHandler` (existed before this work)
- Event store: `workflow-execution-event-store.ts` (T06 — was ready, starved of data)
- Handoff doc: `_projects/2026-05/20260521.03.workflow-hitl-approval-ui/handoff.md`

---

**Status**: ✅ Production Ready (OSS Go handler + React UI complete; event pipeline wired)
**Timeline**: Single session
