# Human-in-the-Loop (HITL) Approvals

How WorkflowExecution surfaces child agent approval requests and routes decisions to the correct agent.

---

## What Is HITL in a Workflow Context?

When a workflow task of type `WORKFLOW_TASK_AGENT_INVOCATION` invokes an agent that requires tool approval, the approval request propagates up to the WorkflowExecution level. This enables a single approval UI to handle approvals from any agent in the workflow — including agents running in parallel.

The WorkflowExecution acts as an **approval aggregation point**:

```
WorkflowExecution "acme-onboarding-20250111"
  └── Task "analyze_feedback" (WORKFLOW_TASK_AGENT_INVOCATION)
        └── AgentExecution "agx-abc123"
              └── Tool "delete_customer_record" (requires_approval: true)
                    └── PendingApproval surfaced at WorkflowExecution.status.pending_approvals
```

The approval decision can be submitted either directly to the child `AgentExecution` or via the `WorkflowExecution.submitApproval` RPC — both paths are equivalent.

---

## How HITL Propagates from Agent to Workflow

When a child agent hits an approval gate, the following sequence occurs:

1. Child `AgentExecution.status.phase` → `EXECUTION_WAITING_FOR_APPROVAL`
2. Child signals parent workflow via Temporal: `"child_approval_required"`
3. Parent workflow updates:
   - Task status → `WORKFLOW_TASK_WAITING_APPROVAL`
   - `status.pending_approvals` populated with approval entries from the child
4. Each entry in `pending_approvals` includes `child_agent_execution_id` to identify the source
5. User submits decision via `WorkflowExecution.submitApproval` or `AgentExecution.submitApproval`
6. Approval is forwarded to the child agent (if submitted via workflow)
7. Child agent resumes execution
8. Child signals parent: approval cleared
9. Task status returns to `WORKFLOW_TASK_IN_PROGRESS`
10. `status.pending_approvals` entry is removed

**The workflow phase remains `EXECUTION_IN_PROGRESS` throughout** — only the task status reflects the waiting state.

---

## Parallel Agent Approvals

When multiple `WORKFLOW_TASK_AGENT_INVOCATION` tasks run in parallel and more than one child agent hits an approval gate simultaneously, all approval entries accumulate in `status.pending_approvals`:

```
WorkflowExecution.status.pending_approvals = [
  {
    tool_call_id: "call_A",
    tool_name: "delete_repository",
    message: "Delete repository: acme/important-repo",
    child_agent_execution_id: "agx-task2-agent",
    requested_at: "2026-02-28T10:00:00Z"
  },
  {
    tool_call_id: "call_B",
    tool_name: "send_mass_email",
    message: "Send email to 5,000 customers",
    child_agent_execution_id: "agx-task3-agent",
    requested_at: "2026-02-28T10:00:05Z"
  }
]
```

Each entry's `child_agent_execution_id` identifies which child agent the approval belongs to. Decisions are submitted and forwarded independently — each approval routes to its specific child.

---

## pending_approvals Fields

Each entry in `status.pending_approvals` is a `PendingApproval` message (shared with AgentExecution):

| Field | Type | Description |
|---|---|---|
| `tool_call_id` | `string` | ID of the tool call awaiting approval. Pass this to `submitApproval`. |
| `tool_name` | `string` | Name of the tool requiring approval. Example: `"delete_repository"`. |
| `message` | `string` | Human-readable approval prompt with resolved argument placeholders. |
| `args_preview` | `string` | Sanitized JSON preview of tool arguments. Sensitive values are redacted. |
| `requested_at` | `string` | ISO 8601 timestamp when the approval was requested. |
| `interrupt_id` | `string` | LangGraph interrupt ID for targeted resume. Used internally — do not modify. |
| `child_agent_execution_id` | `string` | ID of the child `AgentExecution` that originated this approval request. Used for routing. |

---

## Submitting a Decision

### Via WorkflowExecution (recommended for workflow-level UIs)

```bash
# Approve — tool executes normally
stigmer workflow-execution approve wfx-abc123xyz456 \
  --tool-call-id call_A \
  --comment "Verified the target repository is safe to delete"

# Skip — tool is skipped, LLM adapts its plan
stigmer workflow-execution skip wfx-abc123xyz456 \
  --tool-call-id call_A \
  --comment "Will handle this manually"

# Reject — agent execution fails immediately
stigmer workflow-execution reject wfx-abc123xyz456 \
  --tool-call-id call_A \
  --comment "Wrong repository — this looks like a mistake"
```

The decision is forwarded to the child `AgentExecution` identified by `pending_approvals[i].child_agent_execution_id`.

### Via AgentExecution (direct child approval)

```bash
# Approve the child agent directly (equivalent result)
stigmer agent execution approve agx-abc123 \
  --tool-call-id call_A \
  --comment "Approved via direct child agent approval"
```

Both submission paths result in identical state transitions. The workflow-level path is more convenient when the UI only knows the workflow execution ID.

---

## Three Possible Decisions

| Decision | `ApprovalAction` | Effect on Task | Effect on Child AgentExecution |
|---|---|---|---|
| Approve | `APPROVAL_ACTION_APPROVE` | Returns to `WORKFLOW_TASK_IN_PROGRESS` | Phase returns to `EXECUTION_IN_PROGRESS` |
| Skip | `APPROVAL_ACTION_SKIP` | Returns to `WORKFLOW_TASK_IN_PROGRESS` | Phase returns to `EXECUTION_IN_PROGRESS`. LLM receives: "Tool was skipped by user." |
| Reject | `APPROVAL_ACTION_REJECT` | → `WORKFLOW_TASK_FAILED` | Phase → `EXECUTION_FAILED` |

**On Approve:** The tool executes with the provided arguments. The child agent resumes.

**On Skip:** The LLM receives: `"Tool '{name}' was skipped by user. Please proceed without this operation."` The agent adapts its plan and continues without the skipped tool's result.

**On Reject:** The child agent execution fails immediately. The workflow task status changes to `WORKFLOW_TASK_FAILED`. Depending on the workflow's error handling configuration, this may also fail the entire workflow execution.

---

## submitApproval RPC

The `WorkflowExecution.submitApproval` RPC forwards the approval to the correct child agent:

**Preconditions:**
- `status.pending_approvals` must be populated
- `tool_call_id` must match an entry in `status.pending_approvals`
- `status.pending_approvals[i].child_agent_execution_id` must not be empty
- User must have `can_edit` permission on the workflow execution

**Validation:**
- `execution_id`: Required, must reference an existing WorkflowExecution
- `tool_call_id`: Required, must match `status.pending_approvals[i].tool_call_id`
- `action`: Required, must be `APPROVE`, `SKIP`, or `REJECT` (not `UNSPECIFIED`)
- `comment`: Optional, stored in audit trail

**Idempotency:** If the same approval is submitted twice (same `execution_id`, `tool_call_id`, and `action`), the second call is a no-op if the approval was already processed.

---

## Example: End-to-End Approval Flow

**Scenario:** A workflow runs an agent that wants to delete a customer record. The tool requires approval.

**Step 1: Check for pending approvals**

```bash
stigmer get workflow-execution wfx-abc123xyz456 --output yaml
```

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-2
      task_name: cleanup_customer_data
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_WAITING_APPROVAL
      started_at: "2025-01-11T14:31:00Z"
  pending_approvals:
    - tool_call_id: call_abc123
      tool_name: delete_customer_record
      message: "Delete all data for customer cus-xyz789 (john.doe@example.com)"
      args_preview: '{"customer_id": "cus-xyz789", "include_backups": true}'
      requested_at: "2025-01-11T14:31:15Z"
      child_agent_execution_id: agx-cleanup-agent-001
```

**Step 2: Submit the approval decision**

```bash
stigmer workflow-execution approve wfx-abc123xyz456 \
  --tool-call-id call_abc123 \
  --comment "Customer requested full data deletion per GDPR request #1234"
```

**Step 3: Confirm the task resumed**

```bash
stigmer get workflow-execution wfx-abc123xyz456 --output yaml
```

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-2
      task_name: cleanup_customer_data
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_IN_PROGRESS   # back to in-progress
      started_at: "2025-01-11T14:31:00Z"
  pending_approvals: []  # cleared after decision submitted
```

---

## Approval Timeout

WorkflowExecution does not automatically reject pending approvals after a timeout — tasks remain in `WORKFLOW_TASK_WAITING_APPROVAL` indefinitely until a decision is submitted. This is intentional: approval requests may legitimately wait for hours while reviewers are offline.

To enforce a timeout:
- Implement external monitoring and call `reject` or `cancel` if the approval exceeds your acceptable wait window
- Use `WORKFLOW_TASK_APPROVAL` (native workflow approval task) instead of an agent invocation if you need built-in timeout support

---

## Difference from Native Workflow Approvals

WorkflowExecution supports two distinct approval mechanisms:

| Mechanism | How | When to Use |
|---|---|---|
| **HITL via child agent** | Agent hits approval gate → surfaces in `pending_approvals` | Agent autonomously decides it needs approval for a specific tool call |
| **Native `WORKFLOW_TASK_APPROVAL` task** | Explicit approval task in workflow DSL | Workflow author defines an approval gate at a specific point in the flow |

For the native `WORKFLOW_TASK_APPROVAL` task, the approval is handled as a standard workflow task with its own `input` (approvers list, message, timeout) and `output` (approved, approved_by, comment). No `pending_approvals` field is used.

---

## Related Documentation

- [hitl-approvals.md in AgentExecution](../../agentexecution/docs/hitl-approvals.md) — approval mechanism from the agent's perspective, including tool-level configuration
- [execution-lifecycle.md](execution-lifecycle.md) — `WORKFLOW_TASK_WAITING_APPROVAL` task status and overall phase state machine
- [examples.md](examples.md) — complete HITL workflow example
