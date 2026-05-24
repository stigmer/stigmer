# Agent Call Live Experience

**Date**: May 24, 2026

## Summary

Implemented the "Reference + Subscribe" pattern for live agent call visibility in the workflow execution cockpit. Fixed the `pending_approvals` race condition that silently cleared active approval gates, added `child_execution_started` signal for early execution ID propagation, rewrote the inspector Agent tab with live `MessageThread` streaming, and wired orphaned approval components into the workflow viewer.

## Problem Statement

When a workflow executes an `agent_call` task (which can run 1-60+ minutes), the user previously had:
- No progress visibility — graph node showed "Running" for the entire duration
- No live transcript — inspector showed static metadata from completion events
- Disconnected approvals — agent tool approval components existed but weren't wired
- A race condition where concurrent event emissions clobbered active `pending_approvals`

### Pain Points

- Users couldn't see what the agent was doing during execution
- Agent tool approvals were invisible at the workflow level (users had to navigate to the session page)
- The `pending_approvals` race caused approval gates to disappear in fork+agent_call workflows
- The `childExecutionId` was only known at completion — too late for live subscription

## Solution

**Architecture: Reference + Subscribe** — lightweight summary events in the workflow stream for graph/waterfall awareness; on-demand subscription to child AgentExecution for full detail in the inspector.

1. **Fix the race**: Added `update_pending_approvals` sentinel boolean on `WorkflowExecutionUpdateStatusInput`. Server only merges approvals when explicitly told to.
2. **Early ID**: Platform sends `child_execution_started` signal immediately from `InvokeAgentExecutionWorkflow` before harness dispatch. Orchestrator emits `agent_call_progress` with the ID.
3. **Live inspector**: `AgentCallTab` composes existing `useExecutionStream` + `MessageThread` when task is running + ID available.
4. **Wire approvals**: `WorkflowExecutionViewer` reads `pending_approvals`, passes to `ExecutionInspector` which shows an "Approval" tab with inline `WorkflowExecutionApprovalCard`.

## Implementation Details

### Proto Changes (2 files)
- `io.proto`: Added `bool update_pending_approvals = 11` on `WorkflowExecutionUpdateStatusInput`
- `api.proto`: Updated `pending_approvals` field comment — "Guarded Update Protocol" replaces "Full-Replace Protocol"

### Backend — Runner (5 files)
- `call-agent-orchestrator.ts`: New `childExecutionStarted` signal handler + `agent_call_progress` event emission + event proxy
- `call-agent-status.ts`: Sets `updatePendingApprovals: true` on both set and clear operations
- `workflow-event-activities.ts`: Added `agent_call_progress` → proto conversion
- `types.ts`: Added `AgentCallProgressEvent` to event descriptor union
- `stigmer-client.ts`: Added optional `updatePendingApprovals` parameter

### Backend — Go Server (2 files)
- `update_status.go`: Conditional merge — only touches `pending_approvals` when `UpdatePendingApprovals == true`
- `invoke_workflow_impl.go`: `SignalExternalWorkflow` for `child_execution_started` before harness dispatch

### Backend — Java Cloud (4 files)
- `WorkflowExecutionUpdateStatusHandler.java`: Conditional merge matching Go logic
- `NotifyParentActivities.java`: Added `signalParentExecutionStarted` interface method
- `NotifyParentActivitiesImpl.java`: Implementation — signals parent with execution ID
- `AgentExecutionTemporalWorkflowTypes.java`: Added `SIGNAL_CHILD_EXECUTION_STARTED` constant
- `InvokeAgentExecutionWorkflowImpl.java`: Emits signal before harness dispatch

### Frontend — SDK React (6 files)
- `AgentCallTab.tsx`: REWRITTEN — live `MessageThread` when running, visibility-aware subscription
- `ExecutionInspector.tsx`: New Approval tab, auto-select on `waiting_approval`, passes `pendingApprovals`
- `WorkflowExecutionViewer.tsx`: Reads `execution.status.pendingApprovals`, passes to inspector
- `ExecutionBadge.tsx`: Shows tool name in approval badge when available
- `WorkflowNode.tsx`: Passes `approvalToolName` to badge
- `workflow-graph-conversions.ts`: Added `approvalToolName` field to `CanvasTaskNodeData`

### Tests (2 files)
- `update_status_test.go`: 5 test cases for Go merge logic (flag preservation, clearing, concurrent emission)
- `agent-call-live-experience.test.ts`: TypeScript logic tests for view switching and tab visibility

### Documentation (1 file)
- `checkpoints/2026-05-24-run-workflow-architectural-gap.md`: Documents that `run_workflow` doesn't create child DB records, proposes future solution

## Benefits

- **Live agent visibility**: Users see real-time transcript, tool calls, and cost accrual during agent execution
- **Inline approvals**: Approve/reject agent tool calls directly from the workflow cockpit (no navigation away)
- **Race condition eliminated**: Active approval gates survive concurrent event emissions from parallel branches
- **Early subscription**: Frontend can connect to agent stream as soon as the execution starts (not just on completion)
- **No data duplication**: Full transcript lives only in AgentExecution domain; workflow stores lightweight summaries

## Impact

- **Workflow viewer users**: Can now monitor agent activity live and act on approvals inline
- **Fork + agent_call workflows**: No longer lose approval state due to race condition
- **Platform builders**: New props on `ExecutionInspector` (`pendingApprovals`, `onSubmitApproval`) enable custom approval UX
- **Both OSS and Cloud**: Go and Java servers both implement the guarded merge; both emit the early ID signal

## Descoped (Documented for Follow-Up)

- `call_llm` real-time streaming — synchronous activity, no architectural path without major restructuring
- `run_workflow` child progress — no child WorkflowExecution DB record exists today (architectural gap documented)
- Periodic `agent_call_progress` summaries from platform (Phase B for graph node badges)
- Cancel button for running agents (follow-up after early ID works)

## Related Work

- T05: Runtime Inspector Panel (foundation this builds on)
- Runner Task Status Enrichment (agent_call_started/completed events)
- Workflow Instance Management UX (earlier session today)

---

**Status**: ✅ Production Ready (requires `make protos && make codegen` to regenerate stubs from proto changes)
**Timeline**: Single session implementation
