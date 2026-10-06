# Execution Lifecycle

The phase state machine for WorkflowExecution — all phases, transitions, and lifecycle control operations.

---

## Phase State Machine

Every WorkflowExecution moves through a defined set of phases. The phase is stored in `status.phase` and updated in real time by the workflow execution engine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXECUTION_PENDING                                    │
│                (created, queued, Temporal picks up)                          │
└────────────────────────────┬────────────────────────────────────────────────┘
                              │ Temporal starts workflow
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       EXECUTION_IN_PROGRESS                   ◄─────────────┼──────┐
│             (tasks executing sequentially or in parallel)                    │      │
└───────┬──────────────┬──────────────┬───────────────┬───────────────────────┘      │
        │              │              │               │                               │
 pause()│       cancel()│      HITL   │    all tasks  │                    resume()   │
        │              │      gate   │    complete   │                               │
        ▼              ▼      hit    ▼               ▼                               │
┌──────────────┐ ┌──────────────┐  ┌──────────────────────────────┐                 │
│ EXECUTION_   │ │ EXECUTION_   │  │ EXECUTION_WAITING_APPROVAL   │─────────────────┘
│ PAUSED       │ │ CANCELLED    │  │ (task waiting for child agent │
│ (checkpoint  │ │ (graceful,   │  │  HITL approval; non-terminal) │
│  saved;      │ │  terminal)   │  └──────────────────────────────┘
│  resumable)  │ └──────────────┘             │ reject (child)
└──────┬───────┘                              ▼
       │                           ┌──────────────────────────┐
resume()│                          │    EXECUTION_FAILED      │◄─── terminate() gives
       │                           │ (error, rejection, crash) │       TERMINATED
       └──────────────────────────►│                          │
                (back to           └────────────┬─────────────┘
                 IN_PROGRESS)                   │ recover()
                                                ▼
                                    (back to IN_PROGRESS,
                                     from last checkpoint)

     ┌────────────────────────────────────────────────────────────────────┐
     │                    EXECUTION_TERMINATED                             │
     │  (force-killed via terminate(); no cleanup, no recovery)           │
     └────────────────────────────────────────────────────────────────────┘

     ┌────────────────────────────────────────────────────────────────────┐
     │                    EXECUTION_COMPLETED                              │
     │         (all tasks succeeded, status.output populated)             │
     └────────────────────────────────────────────────────────────────────┘
```

---

## Phase Reference

| Phase | Enum Value | Terminal? | Description |
|---|---|---|---|
| `EXECUTION_PENDING` | 1 | No | Created, queued, waiting for Temporal to pick up. Typical duration: < 1 second. |
| `EXECUTION_IN_PROGRESS` | 2 | No | Tasks are actively executing. `status.tasks` is updated in real time. |
| `EXECUTION_COMPLETED` | 3 | **Yes** | All tasks finished successfully. `status.output` is populated. |
| `EXECUTION_FAILED` | 4 | **Yes** | One or more tasks failed or an unrecoverable error occurred. `status.error` is populated. Can be recovered. |
| `EXECUTION_CANCELLED` | 5 | **Yes** | Stopped gracefully via `cancel`. Workflow had opportunity to clean up. Cannot be recovered. |
| `EXECUTION_TERMINATED` | 6 | **Yes** | Force-killed via `terminate`. No cleanup executed. Cannot be recovered. |
| `EXECUTION_PAUSED` | 7 | No | Temporarily stopped via `pause`. Checkpoint saved. Can be resumed from exact pause point. |

**Terminal states** — once reached, the phase does not change again:
- `COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`

**Non-terminal states** — execution can continue from these:
- `PENDING`, `IN_PROGRESS`, `PAUSED`

Note: Unlike AgentExecution, WorkflowExecution does not have an `EXECUTION_WAITING_FOR_APPROVAL` phase at the workflow level. Instead, the child agent's approval is surfaced via `status.pending_approvals` and the blocked task gets status `WORKFLOW_TASK_WAITING_APPROVAL`. The workflow phase remains `EXECUTION_IN_PROGRESS`.

---

## Task Status Transitions

Each task in `status.tasks` has its own status, independent of the overall workflow phase:

```
Normal flow:
WORKFLOW_TASK_PENDING → WORKFLOW_TASK_IN_PROGRESS → WORKFLOW_TASK_COMPLETED

Failure flow:
WORKFLOW_TASK_PENDING → WORKFLOW_TASK_IN_PROGRESS → WORKFLOW_TASK_FAILED

Skip flow (conditional logic):
WORKFLOW_TASK_PENDING → WORKFLOW_TASK_SKIPPED

HITL approval flow (agent invocation tasks):
WORKFLOW_TASK_IN_PROGRESS → WORKFLOW_TASK_WAITING_APPROVAL → WORKFLOW_TASK_IN_PROGRESS
                                                            ↘ WORKFLOW_TASK_FAILED (on reject)
```

| Status | Terminal? | Description |
|---|---|---|
| `WORKFLOW_TASK_PENDING` | No | Created, waiting for dependencies. |
| `WORKFLOW_TASK_IN_PROGRESS` | No | Currently executing. |
| `WORKFLOW_TASK_COMPLETED` | Yes | Finished successfully. `output` is populated. |
| `WORKFLOW_TASK_FAILED` | Yes | Failed. `error` is populated. May cause workflow failure. |
| `WORKFLOW_TASK_SKIPPED` | Yes | Skipped by conditional logic. Not an error. Counts toward progress. |
| `WORKFLOW_TASK_WAITING_APPROVAL` | No | Child agent invocation is paused at a HITL gate. See [hitl-approvals.md](hitl-approvals.md). |

---

## Lifecycle Control Operations

Stigmer exposes seven control operations for managing running workflow executions. All operations are idempotent — calling an operation on an execution already in the target state succeeds as a no-op.

### `cancel` — Graceful Stop

Sends a cancellation signal to the Temporal workflow. The workflow code can handle the signal to perform cleanup (compensation logic, resource cleanup, notifications) before transitioning to `EXECUTION_CANCELLED`.

```bash
stigmer cancel workflow-execution wfx-abc123xyz456 \
  --reason "Customer cancelled their order"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot cancel terminal executions

**What happens:**
1. Temporal `CancelWorkflow` API is called
2. Workflow code receives the cancellation context
3. Workflow has opportunity to run cleanup/compensation logic
4. `status.phase` → `EXECUTION_CANCELLED`
5. `status.completed_at` is set
6. In-progress tasks may complete cleanup or be interrupted

**After cancellation:**
- Execution is terminal — it cannot be recovered
- To re-run the work, create a new WorkflowExecution

---

### `terminate` — Force Kill

Force-kills the Temporal workflow immediately via `TerminateWorkflow`. The workflow code receives no signal and cannot clean up. Use only for stuck or unresponsive workflows that do not respond to `cancel`.

```bash
stigmer terminate workflow-execution wfx-abc123xyz456 \
  --reason "Workflow stuck for 2 hours, not responding to cancel"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot terminate terminal executions

**What happens:**
1. Temporal `TerminateWorkflow` API is called (no signal to workflow code)
2. All in-progress tasks are stopped abruptly
3. No cleanup callbacks or defer blocks execute
4. `status.phase` → `EXECUTION_TERMINATED`
5. `status.completed_at` is set
6. `status.error` may contain termination reason

**After termination:**
- `TERMINATED` executions cannot be recovered

---

### Cancel vs. Terminate

| Aspect | `cancel` | `terminate` |
|---|---|---|
| Signal sent to workflow | Yes — workflow can handle it | No — immediate kill |
| Workflow can clean up | Yes | No |
| Compensation logic runs | Yes | No |
| Use case | Normal / planned stop | Stuck or unresponsive workflow |
| Recovery possible? | No (terminal) | No (terminal) |
| Idempotent? | Yes | Yes |

**When to use terminate:**
- The workflow has been running for an unexpected duration and does not respond to `cancel`
- The workflow is in an infinite loop
- Emergency stop is needed immediately

---

### `pause` — Temporary Stop

Sends a "pause" signal to the Temporal workflow. Running activities are gracefully cancelled and checkpoints are saved. The workflow waits for a "resume" signal — no compute resources are consumed while paused.

```bash
stigmer pause workflow-execution wfx-abc123xyz456 \
  --reason "Pausing for scheduled maintenance window"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot pause terminal or already-paused executions

**What happens:**
1. "pause" signal is sent to the Temporal workflow
2. Running activities are gracefully cancelled
3. Checkpoints are saved (LangGraph `thread_id` preserved for agent activities)
4. `status.phase` → `EXECUTION_PAUSED`
5. Workflow enters a wait state (no resources consumed)
6. `status.completed_at` is **not** set (execution is not finished)

---

### `resume` — Continue from Pause

Sends a "resume" signal to the paused Temporal workflow. The workflow re-invokes activities with the same execution context; LangGraph loads the checkpoint automatically and continues from the exact pause point.

```bash
stigmer resume workflow-execution wfx-abc123xyz456
```

**Preconditions:**
- Execution must be in `EXECUTION_PAUSED`

**What happens:**
1. "resume" signal is sent to the waiting Temporal workflow
2. Workflow unblocks from its wait state
3. Activities are re-invoked with the same `thread_id`
4. LangGraph loads checkpoint from saved state
5. `status.phase` → `EXECUTION_IN_PROGRESS`
6. Execution continues from exactly where it was paused

---

### Pause vs. Cancel

| Aspect | `pause` | `cancel` |
|---|---|---|
| Terminal state? | No | Yes |
| Can resume? | Yes (via `resume`) | No |
| Checkpoint saved? | Yes | Best-effort |
| Workflow resources | Minimal (waiting for signal) | None (terminated) |
| Use case | Temporary stop, review | Permanent stop |

---

### `recover` — Resume from Failure

Uses Temporal's `ResetWorkflow` to resume a `FAILED` execution from its last successful checkpoint. Completed work is preserved — successful tasks are not re-executed.

```bash
stigmer recover workflow-execution wfx-abc123xyz456 \
  --reason "Stripe API recovered, resuming payment processing"
```

**Preconditions:**
- Execution must be in `EXECUTION_FAILED`
- `TERMINATED` executions cannot be recovered (no clean checkpoint)
- `CANCELLED` executions cannot be recovered (intentional user action)

**What happens:**
1. Temporal `ResetWorkflow` is called from the last successful checkpoint
2. New Temporal run is created in the same workflow ID chain
3. `status.phase` → `EXECUTION_IN_PROGRESS`
4. `status.completed_at` is cleared
5. `status.error` is cleared
6. Completed tasks are preserved — workflow continues from failure point

**When to use recover:**
- Task failed due to a transient error (network timeout, rate limit)
- An external API was down but is now available
- A configuration issue was fixed and the workflow should continue without losing progress

### Recovery vs. Restart

| Aspect | `recover` | Create new execution |
|---|---|---|
| Completed work | Preserved | Lost (re-executed) |
| Side effects | Not duplicated | May duplicate |
| Execution ID | Same | New ID |
| Use case | Resume after fix | Start fresh |

---

### `sendSignal` — Deliver External Event

Delivers a named signal to a running workflow execution. Used to unblock `LISTEN` tasks that are waiting for an external event. Uses Temporal's `SignalWithStart` API internally for race-proof delivery.

```bash
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123", "amount": 99.99, "currency": "USD"}'
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot signal terminal executions

**Signal matching:** The `--signal` value must match the signal ID defined in the workflow's `LISTEN` task:

```yaml
# In workflow YAML
- waitForPayment:
    listen:
      to:
        one:
          with:
            id: payment_confirmed    # <── must match --signal value
            type: signal
```

**Race-proof delivery:** `sendSignal` uses Temporal's `SignalWithStart` API. If the signal arrives before the Temporal workflow has fully started, `SignalWithStart` starts the workflow first and then delivers the signal atomically — the signal is never lost.

**Idempotency:** Pass `--idempotency-key` to prevent duplicate signal delivery from webhook retries:

```bash
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123"}' \
  --idempotency-key "stripe:evt_1NqZP92eZvKYlo2CqOc7XYRT"
```

Duplicate signals with the same idempotency key (within 24 hours) return the original response without re-delivering the signal.

---

## Observability

The execution phase is reflected in:

- `status.phase` on every `get` or `list` response
- Real-time streaming via the `subscribe` RPC — clients receive updated `WorkflowExecution` messages as the phase changes
- `status.started_at` and `status.completed_at` timestamps for duration measurement
- `status.error` populated on `FAILED` and `TERMINATED` with the failure reason
- `status.tasks[].status` for task-level granularity

### Real-Time Subscription

Subscribe to live execution updates with the `subscribe` RPC:

```bash
stigmer watch workflow-execution wfx-abc123xyz456
```

The stream sends a complete `WorkflowExecution` resource on each state change:
1. Initial message: current state when subscription is opened
2. Subsequent messages: sent on every phase change, task status change, or output update
3. Stream closes automatically when execution reaches a terminal state

Stream update types (for WebSocket/SSE clients):

| Update Type | Triggered When |
|---|---|
| `wf_update_status_changed` | `status.phase` transitions |
| `wf_update_task_started` | Task changes from PENDING to IN_PROGRESS |
| `wf_update_task_completed` | Task changes to COMPLETED |
| `wf_update_task_failed` | Task changes to FAILED |
| `wf_update_execution_completed` | Workflow reaches COMPLETED (terminal) |
| `wf_update_execution_cancelled` | Workflow reaches CANCELLED (terminal) |
