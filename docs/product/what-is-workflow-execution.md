# What is a Workflow Execution?

## One-Sentence Positioning

**A Workflow Execution is a single, observable, controllable run of a workflow—the same way `kubectl create job` is a single, observable, controllable instance of a CronJob definition.**

---

## Executive Summary

A WorkflowExecution is Stigmer's runtime record for one invocation of a workflow pipeline. When you trigger a workflow, Stigmer creates a WorkflowExecution that captures everything about that run: what triggered it, the real-time status of every task inside it, each task's inputs and outputs, and the final outcome.

WorkflowExecution sits at the bottom of the three-layer workflow stack:

```
Workflow ──► WorkflowInstance ──► WorkflowExecution
```

The Workflow is the *blueprint*. The WorkflowExecution is the *evidence*—a durable, queryable record of exactly what happened and what is happening right now. Each execution has a lifecycle (pending → in-progress → completed), full task-level audit trails, and control operations: pause, resume, cancel, terminate, recover from failure, and send signals to waiting tasks.

Three features distinguish WorkflowExecution from a simple job submission:

1. **Task-level progress visibility**: Every task in the pipeline has its own status, input, output, timestamps, and error. You always know exactly which task is running, which completed, and which failed—and why.
2. **Lifecycle control without lost work**: Executions can be paused and resumed from checkpoints. Failed executions can be recovered without re-executing the steps that already succeeded.
3. **Signal delivery**: External systems—webhooks, payment processors, human approvers—can unblock a waiting `listen` task at any time by sending a named signal, delivered reliably via Temporal's SignalWithStart.

---

## The Problem Workflow Execution Solves

### Running Automation Is a Black Box

Submitting a multi-step pipeline to a job runner gives you a job ID and an eventual success or failure. There is no record of which step was running when it failed, what the intermediate outputs were, or how long each step took. There is no way to stop the job mid-way, review progress, or let a human make a decision before a critical step executes.

**What goes wrong at scale:**

- A pipeline that touches payment APIs fails at step 7 of 12. You have no record of what steps succeeded—so you restart from step 1 and risk duplicating side effects.
- A ten-step deployment pipeline is executing in production at 3am. You cannot see which step it is on, pause it to review, or stop it gracefully without killing the whole process.
- A pipeline calls an AI agent. The agent finishes 20 minutes later. Your pipeline is already dead—the process timed out—so you never get the output.
- A compliance workflow needs a human to approve step 5 before step 6 runs. You implement a polling loop in application code that breaks the moment the process restarts.
- A long-running pipeline fails due to a transient network error. There is no checkpoint. You restart from the beginning and pay the full compute cost again.

### The Hidden Cost of This Approach

These problems compound:

- **No visibility**: A running job is a timer and a status LED. You cannot inspect intermediate state.
- **No control**: You can kill a job or wait for it. There is no middle ground.
- **No durability**: Server restarts lose all in-flight work. Transient failures restart from scratch.
- **No human-in-the-loop**: Injecting approval gates requires bespoke polling infrastructure.
- **No audit trail**: When something goes wrong, you have a final error message. You have no record of what the pipeline had done, what inputs each step received, or what order events occurred.

---

## The WorkflowExecution Resource

WorkflowExecution follows the standard Stigmer resource pattern: a `spec` that contains what you provide, and a `status` that contains what the system produces.

### The Spec: What You Provide

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  name: customer-onboarding-20250111-143022
  org: acme-corp
spec:
  # Reference the WorkflowInstance to execute.
  # (Alternatively, use workflow_id to resolve the default instance automatically.)
  workflow_instance_id: wfi-customer-onboarding-prod

  # The trigger message — the primary input to the workflow.
  trigger_message: "New signup: john.doe@example.com"

  # Metadata about who or what triggered this execution (for audit, not workflow logic).
  trigger_metadata:
    source: api
    caller_id: usr-jane-admin
    timestamp: "2025-01-11T14:30:22Z"

  # Execution-scoped environment overrides (highest merge priority).
  runtime_env:
    CUSTOMER_EMAIL:
      value: john.doe@example.com
    STRIPE_API_KEY:
      secret_ref: sec-stripe-prod
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `workflow_instance_id` | Either/or | The WorkflowInstance to execute — contains environment bindings and secrets. |
| `workflow_id` | Either/or | If `workflow_instance_id` is omitted, the system resolves the default instance automatically. |
| `trigger_message` | No | The input payload or message for this run. Accessible as `{{workflow.input.trigger_message}}` in task configs. |
| `trigger_metadata` | No | Key-value metadata about the trigger source (API, webhook, schedule). For audit only—not passed to task logic. |
| `runtime_env` | No | Execution-scoped environment variables and secrets. Override instance-level values for this run only. |
| `callback_token` | No | Temporal task token for workflow-calling-workflow scenarios — enables async completion without polling. |

### The Status: What the System Produces

Everything Stigmer records during and after execution lives in `status`. You never set `status` fields—they are system-managed and updated in real time by the workflow execution engine.

```yaml
status:
  phase: EXECUTION_IN_PROGRESS

  tasks:
    - task_id: task-1
      task_name: Validate customer email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      input:
        method: POST
        url: https://api.emailvalidator.com/v1/validate
        body:
          email: john.doe@example.com
      output:
        valid: true
        domain: example.com
      started_at: "2025-01-11T14:30:23Z"
      completed_at: "2025-01-11T14:30:23.450Z"

    - task_id: task-2
      task_name: Create Stripe customer
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_IN_PROGRESS
      started_at: "2025-01-11T14:30:24Z"

    - task_id: task-3
      task_name: Send welcome email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_PENDING

  started_at: "2025-01-11T14:30:22Z"
```

---

## Architecture: The Three Layers

A workflow execution in Stigmer involves three resources, each with a distinct responsibility.

```
Workflow ──► WorkflowInstance ──► WorkflowExecution
```

| Layer | Analogy | What It Does |
|---|---|---|
| **Workflow** | GitHub Actions workflow file | Declares the pipeline—tasks, control flow, environment variable declarations. Immutable template. You author this in YAML. |
| **WorkflowInstance** | GitHub Actions environment | Binds the Workflow to concrete credentials and configuration. One Workflow, many instances: staging, production, per-customer. |
| **WorkflowExecution** | `kubectl create job` | A single invocation of a WorkflowInstance. Tracks real-time task progress, outputs, timestamps, and errors. |

**Why this matters:**

The same Workflow YAML runs in local development and in production. The WorkflowInstance controls what environment it runs against. The WorkflowExecution captures exactly what happened in that specific run.

You never modify the Workflow to change environment values. You never modify the WorkflowInstance to see what a run did. Each layer has exactly one job.

---

## Task-Level Progress Tracking

The signature feature of WorkflowExecution is `status.tasks`—the source of truth for what the pipeline is doing right now.

Every task in the workflow definition has a corresponding entry in `status.tasks` with its own lifecycle:

```
WORKFLOW_TASK_PENDING → WORKFLOW_TASK_IN_PROGRESS → WORKFLOW_TASK_COMPLETED
                                                  ↘ WORKFLOW_TASK_FAILED
WORKFLOW_TASK_PENDING → WORKFLOW_TASK_SKIPPED  (conditional logic)
WORKFLOW_TASK_IN_PROGRESS → WORKFLOW_TASK_WAITING_APPROVAL  (child agent HITL)
```

| Task Status | Terminal? | Description |
|---|---|---|
| `WORKFLOW_TASK_PENDING` | No | Waiting for preceding tasks to complete. |
| `WORKFLOW_TASK_IN_PROGRESS` | No | Currently executing. |
| `WORKFLOW_TASK_COMPLETED` | Yes | Finished successfully. `output` is populated. |
| `WORKFLOW_TASK_FAILED` | Yes | Failed. `error` is populated. May cause workflow failure. |
| `WORKFLOW_TASK_SKIPPED` | Yes | Skipped by conditional logic. Not an error. Counts toward progress. |
| `WORKFLOW_TASK_WAITING_APPROVAL` | No | Paused — a child agent invocation hit a HITL gate. |

**Progress calculation is always derivable from the task list:**

```
total_tasks      = len(status.tasks)
completed_tasks  = count(tasks where status in [COMPLETED, FAILED, SKIPPED])
progress_percent = (completed_tasks / total_tasks) × 100
current_task     = tasks.find(status == IN_PROGRESS)
```

No separate counter fields. The task list is the ground truth.

### Seven Task Types

WorkflowExecution tracks tasks of seven distinct types. Each type has its own expected input and output schema:

| Type | What It Does |
|---|---|
| `WORKFLOW_TASK_AGENT_INVOCATION` | Invoke an AI AgentInstance with a prompt. Waits for the AgentExecution to complete. Returns the agent's response. |
| `WORKFLOW_TASK_API_CALL` | Make an HTTP or gRPC call to an external service. Returns status code, headers, and response body. |
| `WORKFLOW_TASK_APPROVAL` | Pause the workflow and wait for one or more designated approvers to approve or reject. |
| `WORKFLOW_TASK_CONDITIONAL` | Evaluate a boolean expression and branch to different task paths. |
| `WORKFLOW_TASK_PARALLEL` | Execute multiple sub-tasks concurrently and wait for all to finish. |
| `WORKFLOW_TASK_TRANSFORM` | Transform data between tasks—map, filter, aggregate, format. |
| `WORKFLOW_TASK_CUSTOM` | Custom business logic defined by plugins. |

---

## Execution Lifecycle: The Phase State Machine

Every WorkflowExecution moves through a defined set of phases, stored in `status.phase` and updated in real time.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EXECUTION_PENDING                                │
│              (created, queued, Temporal picks up)                       │
└─────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     EXECUTION_IN_PROGRESS               ◄──────────────┤
│          (tasks executing sequentially or in parallel)                  │
└──────┬──────────────┬──────────────┬──────────────────┬────────────────┘
       │              │              │                  │
pause()│       cancel()│      HITL   │       all tasks  │
       │              │      gate   │       complete   │
       ▼              ▼      (child) ▼                  ▼
┌───────────────┐ ┌──────────────┐ ┌────────────────────────────────┐
│ EXECUTION_    │ │ EXECUTION_   │ │ EXECUTION_COMPLETED            │
│ PAUSED        │ │ CANCELLED    │ │ (status.output populated)      │
│ (resumable;   │ │ (graceful,   │ └────────────────────────────────┘
│  non-terminal)│ │  terminal)   │
└──────┬────────┘ └──────────────┘
       │
resume()│
       └──► (back to IN_PROGRESS)

     ┌──────────────────────────────────────────────────────────────────┐
     │                   EXECUTION_FAILED                                │
     │     (task failed or unrecoverable error; status.error set)       │
     └──────────────────────────────┬───────────────────────────────────┘
                                    │ recover()
                                    ▼
                        (back to IN_PROGRESS, from last checkpoint)

     ┌──────────────────────────────────────────────────────────────────┐
     │                  EXECUTION_TERMINATED                             │
     │    (force-killed via terminate(); no cleanup, no recovery)       │
     └──────────────────────────────────────────────────────────────────┘
```

**Phase reference:**

| Phase | Terminal? | Description |
|---|---|---|
| `EXECUTION_PENDING` | No | Created, waiting for Temporal to pick up. Typical duration: < 1 second. |
| `EXECUTION_IN_PROGRESS` | No | Tasks are actively executing. `status.tasks` updated in real time. |
| `EXECUTION_PAUSED` | No | Temporarily stopped. Checkpoint saved. Can be resumed from exact pause point. |
| `EXECUTION_COMPLETED` | Yes | All tasks succeeded. `status.output` is populated. |
| `EXECUTION_FAILED` | Yes | One or more tasks failed. `status.error` describes what went wrong. Can be recovered. |
| `EXECUTION_CANCELLED` | Yes | Stopped gracefully via `cancel`. Workflow had opportunity to clean up. Cannot be recovered. |
| `EXECUTION_TERMINATED` | Yes | Force-killed via `terminate`. No cleanup. Cannot be recovered. |

---

## Lifecycle Control

You have full control over a running workflow execution through dedicated operations. Each maps to a Temporal workflow control API. All operations are idempotent.

### Cancel — Graceful Stop

Stop an in-progress execution. The workflow code receives the cancellation signal and can run cleanup or compensation logic before transitioning to `CANCELLED`.

```bash
stigmer cancel workflow-execution wfx-abc123xyz456 --reason "Customer cancelled the order"
```

- **Precondition**: `PENDING` or `IN_PROGRESS`
- **Cleanup**: Workflow code can handle the signal
- **Recovery**: Not possible (terminal state)

### Terminate — Force Kill

Immediately kill an execution without allowing cleanup. The workflow receives no signal. Use this only for stuck or unresponsive workflows that do not respond to `cancel`.

```bash
stigmer terminate workflow-execution wfx-abc123xyz456 --reason "Stuck for 2 hours, not responding to cancel"
```

- **Precondition**: `PENDING` or `IN_PROGRESS`
- **Cleanup**: None — immediate kill
- **Recovery**: Not possible

**Cancel vs. Terminate:**

| Aspect | `cancel` | `terminate` |
|---|---|---|
| Signal sent to workflow | Yes — workflow can handle it | No — immediate kill |
| Workflow can clean up | Yes | No |
| Compensation logic runs | Yes | No |
| Use case | Normal / planned stop | Stuck or unresponsive |
| Recoverable? | No | No |

### Pause / Resume — Temporary Stop

Pause a running execution. Unlike cancel, `PAUSED` is not terminal—the execution resumes from exactly where it stopped. Temporal checkpoints preserve all in-progress task state. No resources are consumed while paused.

```bash
stigmer pause workflow-execution wfx-abc123xyz456 --reason "Maintenance window starting"
stigmer resume workflow-execution wfx-abc123xyz456
```

**Pause vs. Cancel:**

| Aspect | `pause` | `cancel` |
|---|---|---|
| Terminal state? | No | Yes |
| Can resume? | Yes (from checkpoint) | No |
| Resources consumed | Minimal (waiting for signal) | None |
| Use case | Temporary stop | Permanent stop |

### Recover — Resume from Failure

Resume a `FAILED` execution from its last successful checkpoint. Completed tasks are preserved—they are not re-executed, and their side effects are not duplicated.

```bash
stigmer recover workflow-execution wfx-abc123xyz456 --reason "External API recovered, resuming"
```

- **Precondition**: `EXECUTION_FAILED` only
- **`TERMINATED` cannot be recovered** (no clean checkpoint)
- **`CANCELLED` cannot be recovered** (intentional user action)

**Recovery vs. restart:**

| Aspect | `recover` | Create new execution |
|---|---|---|
| Completed work | Preserved | Lost (re-executed) |
| Side effects | Not duplicated | May duplicate |
| Execution ID | Same | New ID |
| Use case | Resume after fix | Start fresh |

---

## Signal Delivery

Workflows can pause at `listen` tasks to wait for an external event—a payment confirmation, a human approval response, a webhook from a third-party service. WorkflowExecution exposes a `sendSignal` operation to deliver these events reliably.

```bash
# Payment confirmed — unblock the waiting listen task
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123", "amount": 99.99, "currency": "USD"}'
```

The `--signal` value must match the signal ID declared in the workflow's `listen` task:

```yaml
# In workflow YAML
- waitForPayment:
    kind: listen
    task_config:
      to:
        mode: one
        signals:
          - id: payment_confirmed    # ← must match --signal value
            type: signal
```

### Race-Proof Delivery

`sendSignal` uses Temporal's `SignalWithStart` API internally. If the signal arrives before Temporal has fully started the workflow—a real race condition in high-throughput systems—`SignalWithStart` starts the workflow first and then delivers the signal atomically. The signal is never lost.

### Idempotent Signal Delivery

External systems (Stripe, GitHub, etc.) retry webhooks on timeout. Pass an idempotency key to prevent duplicate signal delivery:

```bash
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123"}' \
  --idempotency-key "stripe:evt_1NqZP92eZvKYlo2CqOc7XYRT"
```

Duplicate signals with the same key within 24 hours return the original response without re-delivering the event.

---

## Human-in-the-Loop (HITL) Approvals

When a workflow task invokes an AI agent that hits an approval gate, the approval request surfaces at the WorkflowExecution level for centralized review. You do not need to find and manage the child AgentExecution directly.

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-3
      task_name: Invoke deployment agent
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_WAITING_APPROVAL
  pending_approvals:
    - tool_call_id: call_deploy_production
      tool_name: kubectl_apply
      message: "Apply deployment to cluster prod-us-east-1"
      args_preview: '{"manifest": "deployment.yaml", "cluster": "prod-us-east-1"}'
      requested_at: "2025-01-11T14:31:15Z"
      child_agent_execution_id: agx-deployer-001
```

Submit the decision via the workflow execution — Stigmer routes it to the correct child agent:

```bash
# Approve — agent continues, kubectl apply executes
stigmer workflow-execution approve wfx-abc123xyz456 \
  --tool-call-id call_deploy_production \
  --comment "Tests pass, staging verified — approved"

# Skip — agent adapts its plan without the tool
stigmer workflow-execution skip wfx-abc123xyz456 \
  --tool-call-id call_deploy_production

# Reject — agent execution fails, task fails, workflow may fail
stigmer workflow-execution reject wfx-abc123xyz456 \
  --tool-call-id call_deploy_production \
  --comment "Wrong cluster target"
```

**Three possible decisions:**

| Decision | Effect on Task | Effect on Child Agent |
|---|---|---|
| Approve | Returns to `IN_PROGRESS` | Tool executes, agent continues |
| Skip | Returns to `IN_PROGRESS` | Tool skipped, agent adapts its plan |
| Reject | → `WORKFLOW_TASK_FAILED` | Agent execution fails immediately |

When multiple agent tasks run in parallel and each hits an approval gate, all entries accumulate in `status.pending_approvals`. Each entry's `child_agent_execution_id` ensures decisions route to the correct child.

---

## Real-Time Streaming

Subscribe to live execution updates without polling:

```bash
stigmer watch workflow-execution wfx-abc123xyz456
```

The `subscribe` RPC opens a server-streaming connection that pushes a complete `WorkflowExecution` message on every state change:
- Execution phase transitions (PENDING → IN_PROGRESS)
- Task status changes (task started, completed, failed)
- Output populated when execution completes
- Stream closes automatically when execution reaches a terminal state

Multiple clients can subscribe to the same execution simultaneously—all receive the same updates.

---

## Getting Started

```bash
# Trigger a workflow (resolves to default WorkflowInstance automatically)
stigmer run workflow customer-onboarding \
  --message "New signup: john.doe@example.com"

# Trigger using a specific WorkflowInstance with runtime overrides
stigmer run workflow customer-onboarding \
  --instance wfi-customer-onboarding-prod \
  --message "New signup: john.doe@example.com" \
  --env CUSTOMER_EMAIL=john.doe@example.com \
  --secret STRIPE_API_KEY=sec-stripe-prod \
  --watch

# Watch a running execution in real time
stigmer watch workflow-execution wfx-abc123xyz456

# Control a running execution
stigmer pause workflow-execution wfx-abc123xyz456
stigmer resume workflow-execution wfx-abc123xyz456
stigmer cancel workflow-execution wfx-abc123xyz456

# Recover a failed execution from its last checkpoint
stigmer recover workflow-execution wfx-abc123xyz456

# Send a signal to unblock a listen task
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123"}'

# List all executions
stigmer list workflow-executions

# List only failed executions in production
stigmer list workflow-executions --phase failed --tag environment:production

# List execution history for a specific workflow
stigmer list workflow-executions --workflow customer-onboarding
```

---

## How It Compares

| Without WorkflowExecution | With WorkflowExecution |
|---|---|
| Job status is: running, failed, succeeded — nothing more | Task-level progress: exactly which step is running, its input, output, and duration |
| Pipeline failure forces restart from step 1 | `recover` resumes from the last checkpoint — completed tasks are not re-run |
| Stopping a job mid-way kills the process | `cancel` signals the workflow for graceful cleanup; `pause` saves a checkpoint |
| Human approvals require bespoke polling infrastructure | `WORKFLOW_TASK_APPROVAL` tasks and HITL forwarding — built in, no extra code |
| External events require polling loops that break on restart | `sendSignal` delivers events reliably via Temporal SignalWithStart |
| Webhook retries cause duplicate pipeline executions | Idempotency keys prevent duplicate signal delivery |
| AI agents in pipelines require custom completion detection | AgentExecution is a first-class task type — output captured automatically |
| No audit trail of what each step did | Every task has input, output, error, start time, end time — queryable forever |

---

## Further Reading

- [Workflow Execution Resource Guide](../../apis/ai/stigmer/agentic/workflowexecution/docs/workflow-execution-resource-guide.md) — Complete spec and status schema reference, task types, CLI commands
- [Execution Lifecycle](../../apis/ai/stigmer/agentic/workflowexecution/docs/execution-lifecycle.md) — Phase state machine, cancel/terminate/pause/resume/recover/signal operations
- [HITL Approvals](../../apis/ai/stigmer/agentic/workflowexecution/docs/hitl-approvals.md) — Approval forwarding from child agents, parallel approval scenarios
- [Examples](../../apis/ai/stigmer/agentic/workflowexecution/docs/examples.md) — Complete examples from minimal trigger to signal-driven and recovery scenarios
- [What is a Workflow?](./what-is-workflow.md) — The blueprint that WorkflowExecution runs
- [What is a Workflow Instance?](./what-is-workflowinstance.md) — The environment binding between Workflow and execution
- [What is an Agent Execution?](./what-is-agent-execution.md) — The runtime record for agents invoked by `WORKFLOW_TASK_AGENT_INVOCATION` tasks
