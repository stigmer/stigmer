# Workflow Human Input Approval UI — Implementation Handoff

## Context

The Stigmer web app's workflow execution viewer shows live task progress and pauses at `human_input` tasks displaying "Approval requested" with the prompt text. But it's **read-only** — there are no interactive buttons for the user to approve/reject/provide feedback. The backend API (`submitWorkflowTaskApproval` gRPC) is fully functional and tested. This document specifies exactly what needs to be built in the frontend to close the gap.

## Goal

When a workflow execution is paused at a `human_input` task, render an interactive approval card inline in the execution timeline that shows outcome buttons (e.g., "Approve Plan", "Reject Plan") and optional form fields. Clicking a button submits the decision via `submitWorkflowTaskApproval`, the workflow resumes, and the card disappears.

---

## Architecture

### Signal Flow (already working end-to-end)

```
Web UI button click
  → useWorkflowExecutionActions.submitTaskApproval(taskName, outcome, formData, comment)
    → TypeScript SDK: stigmer.workflowExecution.submitWorkflowTaskApproval(input)
      → gRPC: SubmitWorkflowTaskApproval RPC
        → Java handler (stigmer-service) builds signal payload:
           { outcome, reviewer, responded_at, form_data }
        → Temporal signal: "human_input_{taskName}"
          → TS Runner: human-input-orchestrator receives signal
            → Workflow resumes with HumanInputResult
              → approvalResolved event emitted
                → Web UI: event store clears waiting_approval status
                  → Card disappears
```

### Two Distinct Approval Paths (Do NOT Conflate)

| | Agent Tool Approval | Workflow Human Input |
|---|---|---|
| **Trigger** | Agent encounters tool requiring approval | Workflow reaches `human_input` task |
| **Identifier** | `toolCallId` (non-empty) | `taskName` (toolCallId is empty) |
| **Decision values** | `ApprovalAction` enum: APPROVE=1, SKIP=2, REJECT=3 | Free-form outcome strings: "approve", "reject", "revise", etc. |
| **RPC** | `submitApproval` (SubmitWorkflowApprovalInput) | `submitWorkflowTaskApproval` (SubmitWorkflowTaskApprovalInput) |
| **Form data** | None | Optional JSON object from `form_schema` |
| **Existing UI** | Works in agent session page (ApprovalCard in MessageThread) | **MISSING — this is what you're building** |

---

## What Exists (Do NOT Rebuild)

### Backend (fully implemented, integration tested)

- **RPC**: `submitWorkflowTaskApproval` in `WorkflowExecutionCommandController`
- **Proto**: `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto` (lines 184-241)
- **Input type**: `SubmitWorkflowTaskApprovalInput`
- **Java handler**: `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java` in stigmer-cloud
- **Integration test**: `test/integration/workflow_hitl_test.go` — tests approve/reject with custom outcomes
- **CLI**: `stigmer execution approve wex_xxx --task daily_approval --outcome approve` (works today)

### TypeScript SDK (client method exists)

```typescript
// sdk/typescript/src/gen/workflowexecution.ts
async submitWorkflowTaskApproval(input: SubmitWorkflowTaskApprovalInput): Promise<WorkflowExecution>
```

### React SDK (partial — needs extension)

- `useWorkflowExecutionActions.ts` — has `submitApproval` (agent tool path) but NOT `submitTaskApproval` (human_input path)
- `WorkflowExecutionApprovalCard.tsx` — exists but is agent-tool-specific (uses `toolCallId` + `ApprovalAction`); do NOT reuse for human_input
- Event store (`workflow-execution-event-store.ts`) — already tracks `waiting_approval` status per task (line 300)
- `usePendingApprovals.ts` + `PendingApprovalsWidget.tsx` — dashboard list of pending approvals (discovery only, navigates to execution page)

### Event Stream (detection mechanism exists)

The `approvalRequested` event arrives via `subscribeEvents` when a `human_input` task activates. The timeline already renders it as read-only text. The event store marks the task as `waiting_approval`.

---

## What Needs to Be Built

### Step 1: Extend `ApprovalRequestedPayload` Proto

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto`

**Current definition** (line 566):
```protobuf
message ApprovalRequestedPayload {
  string prompt = 1;
  repeated string approvers = 2;
  int32 timeout_seconds = 3;
  string tool_call_id = 4;       // empty for human_input
  string child_execution_id = 5; // empty for human_input
}
```

**Add these fields:**
```protobuf
message ApprovalRequestedPayload {
  string prompt = 1;
  repeated string approvers = 2;
  int32 timeout_seconds = 3;
  string tool_call_id = 4;
  string child_execution_id = 5;

  // For workflow-level human_input tasks (when tool_call_id is empty):
  repeated HumanInputOutcomeInfo outcomes = 6;
  google.protobuf.Struct form_schema = 7;
}

// Lightweight outcome info for UI rendering (subset of HumanInputOutcome from workflow spec)
message HumanInputOutcomeInfo {
  string name = 1;   // outcome identifier submitted as the "outcome" string (e.g. "approve")
  string label = 2;  // human-readable button label (e.g. "Approve Plan")
}
```

**Why**: Without outcomes in the event payload, the UI has no way to know what buttons to render. The workflow task config defines outcomes but that config is not accessible from the execution event stream.

**Backend emit site**: The code that emits `approval_requested` events for `human_input` tasks needs to include the outcomes list and form_schema from the workflow task configuration. Look at where `ApprovalRequestedPayload` is constructed in:
- The TS runner's human-input task executor (emits the event via `ctx.emitEvent`)
- Or the Java service layer that translates runner state to events

### Step 2: Add `submitTaskApproval` to `useWorkflowExecutionActions`

**File**: `sdk/react/src/workflow/useWorkflowExecutionActions.ts`

Add alongside the existing `submitApproval` (which is for agent tools):

```typescript
const submitTaskApproval = useCallback(
  (taskName: string, outcome: string, formData?: Record<string, unknown>, comment?: string) =>
    wrap(() =>
      stigmerRef.current.workflowExecution.submitWorkflowTaskApproval(
        create(SubmitWorkflowTaskApprovalInputSchema, {
          executionId: executionIdRef.current!,
          taskName,
          outcome,
          formData: formData ? Struct.fromJson(formData) : undefined,
          reviewer: "", // server resolves from auth context
          comment: comment ?? "",
        }),
      ),
    ),
  [wrap],
);
```

Export it from the hook's return value alongside `submitApproval`, `pause`, `resume`, etc.

### Step 3: Create `WorkflowTaskApprovalCard` Component

**New file**: `sdk/react/src/workflow/WorkflowTaskApprovalCard.tsx`

**Props interface:**
```typescript
export interface WorkflowTaskApprovalCardProps {
  readonly taskName: string;
  readonly outcomes: ReadonlyArray<{ name: string; label: string }>;
  readonly formSchema?: Record<string, unknown>;
  readonly onSubmit: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  readonly isSubmitting: boolean;
  readonly className?: string;
}
```

**Renders:**
- A row of outcome buttons (one per configured outcome, using `label` as button text)
  - First outcome gets primary/accent styling (typically "Approve")
  - Others get secondary/outline styling
- If `formSchema` is provided: render form fields
  - Start with simple text inputs for `type: string` properties
  - Use property `description` as placeholder text
  - Collect values into a `formData` object keyed by property name
- An optional comment textarea (always shown, separate from form fields)
- On button click: call `onSubmit(taskName, outcome.name, formData, comment)`
- While `isSubmitting`: disable all buttons, show loading state

**Fallback**: If `outcomes` array is empty (proto extension not deployed yet), render default "Approve" / "Reject" buttons with outcome strings `"approve"` / `"reject"`.

**Style reference**: Look at `sdk/react/src/execution/ApprovalCard.tsx` (the agent session approval card) for consistent styling patterns.

### Step 4: Wire Into Timeline

**File**: `sdk/react/src/workflow/WorkflowExecutionTimelineEvent.tsx`

In the `case "approvalRequested"` block (currently at line 233):

```typescript
case "approvalRequested":
  const isHumanInput = !p.value.toolCallId;
  const isWaiting = taskStates?.[event.taskName]?.status === "waiting_approval";

  return (
    <EventRow icon={<ShieldIcon />} iconColor="text-warning" timestamp={timestamp}>
      <span className="font-medium text-warning">Approval requested</span>
      <p className="mt-1 text-xs text-foreground">{p.value.prompt}</p>
      {p.value.approvers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Approvers: {p.value.approvers.join(", ")}
        </p>
      )}
      {p.value.timeoutSeconds > 0 && (
        <p className="text-xs text-muted-foreground">
          Timeout: {formatDurationMs(p.value.timeoutSeconds * 1000)}
        </p>
      )}
      {isWaiting && isHumanInput && (
        <WorkflowTaskApprovalCard
          taskName={event.taskName}
          outcomes={p.value.outcomes ?? []}
          formSchema={p.value.formSchema}
          onSubmit={onSubmitTaskApproval}
          isSubmitting={isSubmitting}
        />
      )}
    </EventRow>
  );
```

**Prop plumbing** (pass through the component tree):

1. `WorkflowExecutionViewer.tsx` — already has `taskStates` from `useWorkflowExecutionEventStream` and `actions` from `useWorkflowExecutionActions`. Pass both to timeline.
2. `WorkflowExecutionTimeline.tsx` — accept and forward `taskStates`, `onSubmitTaskApproval`, `isSubmitting` props.
3. `WorkflowExecutionTimelineEvent.tsx` — use the new props in the `approvalRequested` case.

### Step 5: Card Auto-Dismissal

Already handled by the event store. When `approvalResolved` event arrives:
```typescript
// workflow-execution-event-store.ts line 306
case "approvalResolved":
  if (prev && prev.status === "waiting_approval") {
    map.set(taskName, { ...prev, status: "running" });
  }
  break;
```

The `isWaiting` check becomes false → card disappears from the timeline. No extra work needed.

---

## API Contract Reference

### SubmitWorkflowTaskApprovalInput (Proto)

```protobuf
// apis/ai/stigmer/agentic/workflowexecution/v1/io.proto
message SubmitWorkflowTaskApprovalInput {
  string execution_id = 1;    // Required. e.g. "wex_01abc123"
  string task_name = 2;       // Required. Must match the human_input task name in workflow
  string outcome = 3;         // Required. Must match one of the configured outcome names
  google.protobuf.Struct form_data = 4;  // Optional. Key-value pairs matching form_schema
  string reviewer = 5;        // Optional. Server resolves from auth if empty
  string comment = 6;         // Optional. Free-text comment
}
```

### TypeScript SDK Type (generated)

```typescript
// apis/stubs/ts/ai/stigmer/agentic/workflowexecution/v1/io_pb.ts
export type SubmitWorkflowTaskApprovalInput = {
  executionId: string;
  taskName: string;
  outcome: string;
  formData?: JsonObject;
  reviewer: string;
  comment: string;
};
```

### HumanInputResult (what the workflow receives after approval)

```typescript
// backend/services/runner/src/workflow-engine/types.ts
export interface HumanInputResult {
  readonly outcome: string;           // "approve", "reject", etc.
  readonly reviewer?: string;         // who approved
  readonly responded_at?: string;     // ISO 8601
  readonly form_data?: Record<string, unknown>;  // submitted form values
  readonly auto_resolved?: boolean;   // true if timeout auto-resolved
  readonly reason?: string;           // e.g. "timeout"
}
```

---

## Integration Test Pattern (proves the backend works)

```go
// test/integration/workflow_hitl_test.go
_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
    &workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
        ExecutionId: executionID,
        TaskName:    "awaitApproval",
        Outcome:     "approve",
        Reviewer:    "integration-test",
    })
```

---

## Specific Workflow Outcomes (Tiny Tactics Demo)

These are the outcomes configured in the workflows that this UI needs to support:

**daily-notification-plan / daily_approval:**
- `approve` (label: "Approve Plan")
- `reject` (label: "Reject Plan")

**risk-escalation / escalation_approval:**
- `pause_campaigns` (label: "Pause Active Campaigns")
- `adjust_strategy` (label: "Adjust Strategy (Keep Sending)")
- `monitor_only` (label: "Monitor Only — No Action")

**weekly-strategy-review / strategy_review:**
- `approve` (label: "Approve Strategy")
- `adjust` (label: "Approve with Adjustments")
- `reject` (label: "Reject — Needs Rework")

All workflows also have `form_schema` with text fields (e.g., "feedback", "decisions", "focus_areas"). These should render as text inputs/textareas.

---

## File Map (All Paths Relative to Repo Root)

| File | Action | Purpose |
|------|--------|---------|
| `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto` | Modify | Add `outcomes`, `form_schema` to `ApprovalRequestedPayload` |
| `sdk/react/src/workflow/useWorkflowExecutionActions.ts` | Modify | Add `submitTaskApproval` method |
| `sdk/react/src/workflow/WorkflowTaskApprovalCard.tsx` | Create | New interactive approval card component |
| `sdk/react/src/workflow/WorkflowExecutionTimelineEvent.tsx` | Modify | Render card in `approvalRequested` case when `waiting_approval` |
| `sdk/react/src/workflow/WorkflowExecutionTimeline.tsx` | Modify | Pass through `taskStates`, `onSubmitTaskApproval`, `isSubmitting` |
| `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` | Modify | Plumb `taskStates` and new action to timeline |
| `sdk/react/src/workflow/index.ts` | Modify | Export new component |

Backend emit site (for proto extension):
- Find where `ApprovalRequestedPayload` is constructed when a `human_input` task activates
- Include `outcomes` and `form_schema` from the workflow task config in the emitted event

---

## Definition of Done

1. A workflow execution paused at `human_input` shows interactive outcome buttons in the web timeline
2. Clicking a button submits the decision and the workflow resumes
3. The card disappears after submission (via `approvalResolved` event)
4. Form fields render when `form_schema` is configured
5. Graceful fallback to Approve/Reject when outcomes are not in the event payload
