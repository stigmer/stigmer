# Async Workflow Integration

How automated pipelines (Zigflow workflows) invoke agents and wait for completion without polling — the Temporal token handshake pattern.

---

## The Problem: Pipelines That Invoke Agents

When an automated workflow invokes an agent, it needs to know when the agent is done before moving to the next step. A naive approach is polling: check the execution status every few seconds until it reaches a terminal phase.

Polling has two problems:

1. **Worker thread blocking**: The polling activity holds a Temporal worker thread for the entire duration of the agent run (potentially minutes or hours). This exhausts worker capacity.
2. **Missed completion**: If the polling interval is too long, the pipeline doesn't respond to completion quickly. If it's too short, it wastes compute.

The token handshake pattern solves both problems: the calling activity pauses itself without holding a thread, and the agent notifies the activity directly when it completes.

---

## The Token Handshake Pattern

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Zigflow Workflow (Go)          │  Stigmer Agent (Java/Python)               │
│                                 │                                             │
│  1. Activity starts             │                                             │
│  2. Extract task token          │                                             │
│  3. Create AgentExecution       │                                             │
│     with callback_token=token   │                                             │
│  4. Return ErrResultPending ────┼──► Activity paused, thread released        │
│     (thread freed immediately)  │                                             │
│                                 │  5. Agent runs (seconds to hours)          │
│                                 │  6. Agent completes                         │
│                                 │  7. Agent calls ActivityCompletion          │
│                                 │     .complete(token, result)               │
│  8. Temporal resumes  ◄─────────┼─────────────────────────────────────────── │
│     the paused activity         │                                             │
│  9. Workflow continues          │                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Correctness**: The caller waits for actual agent completion, not just an acknowledgment
- **Scalability**: Worker threads are not held during agent execution (no blocking)
- **Resilience**: The token is durable in Temporal — survives worker restarts
- **No polling**: The agent notifies the caller; the caller does not repeatedly check

---

## `callback_token` — The Spec Field

The `callback_token` field in `AgentExecutionSpec` carries the Temporal task token from the calling activity.

| Field | Type | Description |
|---|---|---|
| `callback_token` | `bytes` | Opaque binary blob from the Temporal SDK (typically 100–200 bytes). Contains namespace, workflow ID, run ID, activity ID, and attempt. **Do not parse or modify.** Treat as an opaque handle. |

**When empty or null:**
- Fire-and-forget: execution proceeds normally, no callback is performed
- Use case: CLI commands, direct API calls, interactive chat

**When provided:**
- The agent workflow **must** complete the external activity using this token — both on success and failure
- Token uniquely identifies the external activity execution

---

## Go — Calling Activity (Zigflow)

```go
// In a Zigflow workflow activity
func CallAgentActivity(ctx context.Context, config *AgentCallTaskConfig) (*AgentResult, error) {
    // Step 1: Extract this activity's task token
    taskToken := activity.GetInfo(ctx).TaskToken

    // Step 2: Create the AgentExecution with the token
    execution := &agentexecutionv1.AgentExecution{
        ApiVersion: "agentic.stigmer.ai/v1",
        Kind:       "AgentExecution",
        Spec: &agentexecutionv1.AgentExecutionSpec{
            AgentId:       config.AgentId,
            Message:       config.Message,
            AutoApproveAll: config.AutoApproveAll,
            CallbackToken: taskToken,  // 👈 Pass the token here
        },
    }

    _, err := client.AgentExecution.Create(ctx, execution)
    if err != nil {
        return nil, err
    }

    // Step 3: Return ErrResultPending — activity is paused, thread released
    // Temporal will resume this activity when the agent calls complete(token, result)
    return nil, activity.ErrResultPending
}
```

**Key behavior of `ErrResultPending`:**
- The activity function returns immediately
- The Temporal worker thread is freed for other work
- The activity appears as "Running" in the Temporal UI
- Temporal will not retry the activity — it will stay paused until the token callback arrives

---

## Java — Agent Workflow Completion

After the agent execution finishes, the agent workflow calls the `ActivityCompletionClient` with the token:

```java
// In the agent workflow (after execution completes)
if (spec.getCallbackToken() != null && !spec.getCallbackToken().isEmpty()) {
    // Complete the external Go activity using the token
    systemActivities.completeZigflowToken(
        spec.getCallbackToken(),
        AgentExecutionResult.newBuilder()
            .setExecutionId(execution.getMetadata().getId())
            .setPhase(status.getPhase())
            .setOutput(lastAiMessage)
            .build()
    );
}
```

Both success and failure paths must call completion. If the agent fails, call the completion with an error result rather than silently not calling it (which would cause the caller to wait until the `StartToCloseTimeout`).

---

## `callback_token` in Status

The token is also stored in `AgentExecutionStatus.callback_token` for reference by the runner:

| Location | Purpose |
|---|---|
| `spec.callback_token` | Set by the caller when creating the execution |
| `status.callback_token` | Copied by the system into status for the runner to read during completion |

The status field is system-managed. Never set it directly.

---

## Events-Based Approval Notification

When a pipeline-invoked agent enters `EXECUTION_WAITING_FOR_APPROVAL`, the parent workflow needs to know so it can surface the approval to users without polling.

This is enabled via the `parent_workflow_id` field:

```go
// In the Go workflow activity
execution := &agentexecutionv1.AgentExecution{
    Spec: &agentexecutionv1.AgentExecutionSpec{
        AgentId:          config.AgentId,
        Message:          config.Message,
        CallbackToken:    taskToken,
        ParentWorkflowId: workflow.GetInfo(ctx).WorkflowExecution.ID,  // 👈 Pass parent ID
    },
}
```

**Signal flow:**

```
Agent enters WAITING_FOR_APPROVAL
    │
    ├── Java sends Temporal signal "child_approval_required" to parent workflow ID
    │
    ├── Signal payload (ChildApprovalNotification):
    │   ├── execution_id: "aex_abc123"
    │   └── pending_approvals: [all pending entries]
    │
    ├── Go workflow receives signal via signal channel
    ├── Updates WorkflowTask status to WORKFLOW_TASK_WAITING_APPROVAL
    └── Populates WorkflowExecution.status.pending_approvals
```

The Go workflow then surfaces the approval to users. Once approved, it forwards the decision to the agent via `AgentExecution.submitApproval` RPC using the `child_agent_execution_id` from the pending approval.

**Backward compatibility:** `parent_workflow_id` is optional. Agents invoked without it continue to work — approval can still be submitted directly via `AgentExecution.submitApproval`.

---

## Timeout Considerations

Set a `StartToCloseTimeout` on the calling activity that accounts for the maximum expected agent execution duration:

```go
ao := workflow.ActivityOptions{
    StartToCloseTimeout: 24 * time.Hour,  // agents may run for a long time
    // Do NOT set HeartbeatTimeout — the activity returns ErrResultPending immediately
    // and cannot heartbeat while paused
}
ctx = workflow.WithActivityOptions(ctx, ao)
```

If the token callback never arrives (e.g., the agent workflow crashes before completing), the activity times out at `StartToCloseTimeout`. This prevents indefinite hangs.

---

## Observability

While the activity is paused, both workflows are visible in the Temporal UI:

| Workflow | Status in Temporal UI |
|---|---|
| Caller (Zigflow) | Running — waiting for `child_approval_required` signal or activity completion |
| Agent workflow | Running — executing the agent |

The token is logged at creation time (Base64-encoded, first 20 characters only) for security. Full tokens are never logged.

---

## References

- Proto definition: `spec.callback_token` in `ai/stigmer/agentic/agentexecution/v1/spec.proto`
- Status field: `status.callback_token` in `ai/stigmer/agentic/agentexecution/v1/api.proto`
- Parent workflow notification: `status.parent_workflow_id`, `ChildApprovalNotification` in `api.proto`
- ADR: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`
- Temporal docs: https://docs.temporal.io/activities#asynchronous-activity-completion
