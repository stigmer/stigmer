# Async Workflow Integration

How a workflow's `agent_call` step invokes an agent and waits for the turn to finish without polling — the Temporal token handshake pattern, carried by the execution's `parent` link.

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
│  Workflow run (agent_call step) │  Agent turn (AgentExecution)               │
│                                 │                                             │
│  1. Activity starts             │                                             │
│  2. Extract task token          │                                             │
│  3. Create AgentExecution       │                                             │
│     with parent.callback_token  │                                             │
│  4. Return a pending result ────┼──► Activity paused, thread released        │
│     (thread freed immediately)  │                                             │
│                                 │  5. Agent runs (seconds to hours)          │
│                                 │  6. Agent completes                         │
│                                 │  7. Platform calls ActivityCompletion       │
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

## `parent` — The Spec Field

`AgentExecutionSpec.parent` (`WorkflowParent`) links a turn to the workflow run whose `agent_call` step started it. It is the only way a turn names a workflow: there is no separate token, parent-workflow or task-queue field.

| Field | Type | Description |
|---|---|---|
| `parent.workflow_execution_id` | `string` | The workflow execution whose step started this turn. Required when `parent` is set. The turn's activities run on that workflow run's task queue, in its sandbox; the server derives the queue from this ID, so no caller names a queue. |
| `parent.signal_workflow_id` | `string` | The Temporal workflow ID told about approval requests (`child_approval_required`). For a nested workflow this is a child workflow with its own ID, so it is named rather than derived. |
| `parent.callback_token` | `bytes` | The Temporal task token of the waiting `agent_call` activity (typically 100–200 bytes). **Opaque: never parse or modify it.** The platform completes that activity with the turn's result when the turn finishes, on success and on failure. |

**Who may set it.** The server honours `parent` only from the workflow run it names:

- a request the server composes itself;
- a runner whose credential is bound to that workflow run;
- a holder of the platform's `can_write_reserved_labels` permission.

Any other caller that sets `parent` is refused with `INVALID_ARGUMENT`; the field is never silently dropped. When the execution also carries the `stigmer.ai/workflow-execution-id` lineage label, the two must name the same workflow run.

**When `parent` is empty:** the turn is an ordinary conversation turn (CLI, API, chat); nothing is completed or signalled.

---

## The Calling Step

The runner's `agent_call` activity:

1. Extracts its own Temporal task token.
2. Applies a Session that names the called agent (`session_spec.agent_ref`), so the turn runs that agent at its current version and never the built-in assistant.
3. Creates the AgentExecution in that session with `parent` set to the workflow execution ID, the workflow to signal, and the task token.
4. Returns the pending-result error, so the activity is paused and its worker thread released.

A call with no workflow execution ID fails in the activity, because an unlinked turn could never complete the step.

**Key behavior of a pending activity:**
- The activity function returns immediately
- The Temporal worker thread is freed for other work
- The activity appears as "Running" in the Temporal UI
- Temporal will not retry the activity — it will stay paused until the token callback arrives

---

## Completion

When the turn reaches a terminal phase, the agent-execution workflow completes the waiting activity with the turn's result (execution ID, phase, final text, structured output). Both success and failure complete it; a failed turn completes it with an error result rather than leaving the caller to wait for its `StartToCloseTimeout`.

`AgentExecutionStatus.callback_token` holds the token the runner reads during completion. It is system-managed; never set it.

---

## Events-Based Approval Notification

When a workflow-invoked turn enters `EXECUTION_WAITING_FOR_APPROVAL`, the parent workflow needs to know so it can surface the approval to users without polling. The control plane signals `parent.signal_workflow_id`:

```
Agent enters WAITING_FOR_APPROVAL
    │
    ├── The control plane (the Stigmer server, in either edition)
    │   sends Temporal signal "child_approval_required" to parent.signal_workflow_id
    │
    ├── Signal payload: the bare child execution id string, e.g. "aex_abc123"
    │   (identity-only: a proto-encoded payload poisoned the receiving
    │   workflow task)
    │
    ├── The runner's call-agent orchestrator receives the signal
    ├── Derives the gate from the child's persisted pending_approvals
    ├── Updates WorkflowTask status to WORKFLOW_TASK_WAITING_APPROVAL
    └── Populates WorkflowExecution.status.pending_approvals (per-child merge)
```

The workflow then surfaces the approval to users. Once approved, it forwards the decision to the agent via the `AgentExecution.submitApproval` RPC using the `child_agent_execution_id` from the pending approval. Approval can always be submitted directly via `AgentExecution.submitApproval` as well.

---

## Timeout Considerations

The calling activity's `StartToCloseTimeout` accounts for the maximum expected turn duration. It sets no `HeartbeatTimeout`: the activity returns a pending result immediately and cannot heartbeat while paused. If the completion never arrives (for example, the agent workflow crashes before completing), the activity times out at `StartToCloseTimeout`, which prevents indefinite hangs.

---

## Observability

While the activity is paused, both workflows are visible in the Temporal UI:

| Workflow | Status in Temporal UI |
|---|---|
| Caller (workflow run) | Running — waiting for `child_approval_required` signal or activity completion |
| Agent workflow | Running — executing the agent |

The token is logged at creation time (Base64-encoded, first 20 characters only) for security. Full tokens are never logged.

---

## References

- Proto definition: `spec.parent` and `WorkflowParent` in `ai/stigmer/agentic/agentexecution/v1/spec.proto`
- Status field: `status.callback_token` in `ai/stigmer/agentic/agentexecution/v1/api.proto`
- Temporal docs: https://docs.temporal.io/activities#asynchronous-activity-completion
