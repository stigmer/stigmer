# Execution Lifecycle

The phase state machine for AgentExecution — all phases, transitions, and lifecycle control operations.

---

## Phase State Machine

Every AgentExecution moves through a defined set of phases. The phase is stored in `status.phase` and updated in real time.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          EXECUTION_PENDING                                    │
│              (created, queued, waiting for a worker to pick up)               │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                   │ worker picks up
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EXECUTION_IN_PROGRESS                  ◄─────────────┼──────────────────┐
│                    (agent is actively processing)                             │                  │
└──────────┬─────────────────┬────────────────┬──────────────────┬─────────────┘                  │
           │                 │                │                  │                                 │
    pause()│         cancel()│        HITL    │        success   │                     approve()   │
           │                 │        gate    │                  │                      or skip()  │
           ▼                 ▼        hit     ▼                  ▼                                 │
┌──────────────────┐  ┌──────────────┐  ┌──────────────────────────────┐                         │
│ EXECUTION_PAUSED │  │EXECUTION_    │  │ EXECUTION_WAITING_FOR_       │─────────────────────────┘
│ (checkpoint      │  │CANCELLED     │  │ APPROVAL                     │
│  saved, resumable│  │(graceful,    │  │ (paused at HITL gate;        │
│  via resume())   │  │ terminal)    │  │  non-terminal)               │
└──────────┬───────┘  └──────────────┘  └──────────────────────────────┘
           │                                          │ reject()
    resume()│                                         ▼
           │                             ┌────────────────────────────────┐
           └──────────────────────────►  │       EXECUTION_FAILED         │
                    (back to IN_PROGRESS) │  (error, rejection, or crash)  │
                                          └───────────────┬────────────────┘
                                                          │ recover()
                                                          ▼
                                             (back to IN_PROGRESS,
                                              from last checkpoint)

          ┌────────────────────────────────────────────────────────────────┐
          │                    EXECUTION_TERMINATED                         │
          │  (force-killed, no signal, no checkpoint — unresponsive agents) │
          └────────────────────────────────────────────────────────────────┘

          ┌────────────────────────────────────────────────────────────────┐
          │                    EXECUTION_COMPLETED                          │
          │            (agent finished successfully, terminal)              │
          └────────────────────────────────────────────────────────────────┘
```

---

## Phase Reference

| Phase | Enum Value | Terminal? | Description |
|---|---|---|---|
| `EXECUTION_PENDING` | 1 | No | Created, waiting for a worker to start processing. |
| `EXECUTION_IN_PROGRESS` | 2 | No | Agent is actively processing the message. |
| `EXECUTION_COMPLETED` | 3 | **Yes** | Agent finished successfully. |
| `EXECUTION_FAILED` | 4 | **Yes** | Agent encountered an error. Can be recovered (unless terminated). |
| `EXECUTION_CANCELLED` | 5 | **Yes** | Stopped gracefully by user via `cancel`. Checkpoint preserved. Cannot be recovered. |
| `EXECUTION_WAITING_FOR_APPROVAL` | 6 | No | Paused at a HITL gate. Waiting for human approval decision. |
| `EXECUTION_PAUSED` | 7 | No | Temporarily stopped via `pause`. Checkpoint saved. Can be resumed. |
| `EXECUTION_TERMINATED` | 8 | **Yes** | Force-killed via `terminate`. No checkpoint. Cannot be recovered. |

**Terminal states** — once reached, the phase does not change again:
- `COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`

**Non-terminal states** — execution can continue from these:
- `PENDING`, `IN_PROGRESS`, `WAITING_FOR_APPROVAL`, `PAUSED`

---

## Lifecycle Control Operations

Stigmer exposes five control operations for managing running executions. Each operation is idempotent — calling it on an execution already in the target state succeeds as a no-op.

### `cancel` — Graceful Stop

Sends a cancellation signal to the running Temporal workflow. The agent activity receives the signal, saves its LangGraph checkpoint, and transitions to `EXECUTION_CANCELLED`.

```bash
stigmer agent execution cancel aex_abc123 --reason "Task no longer needed"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot cancel terminal executions

**What happens:**
1. Temporal `CancelWorkflow` API is called
2. The Python activity receives the cancellation context
3. LangGraph checkpoint is saved with current `thread_id`
4. `status.phase` → `EXECUTION_CANCELLED`
5. `status.completed_at` is set

**After cancellation:**
- Checkpoint is preserved but the execution is terminal — it cannot be recovered
- If you need to re-run the work, create a new AgentExecution

---

### `terminate` — Force Kill

Force-kills the Temporal workflow immediately via `TerminateWorkflow`. The agent activity receives no signal and cannot clean up. Use this only for stuck or unresponsive agents.

```bash
stigmer agent execution terminate aex_abc123 --reason "Stuck for 30 min, not responding to cancel"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot terminate terminal executions

**What happens:**
1. Temporal `TerminateWorkflow` API is called (no signal to agent)
2. All in-progress tool calls are stopped abruptly
3. LangGraph checkpoint may be incomplete
4. `status.phase` → `EXECUTION_TERMINATED`
5. `status.completed_at` is set

**After termination:**
- Checkpoint is potentially incomplete — recovery is not possible
- `TERMINATED` executions cannot be recovered

---

### Cancel vs. Terminate

| Aspect | `cancel` | `terminate` |
|---|---|---|
| Signal sent to agent | Yes — agent can handle it | No — immediate kill |
| Agent can clean up | Yes | No |
| LangGraph checkpoint | Saved gracefully | May be incomplete |
| Use case | Normal / planned stop | Stuck or unresponsive agent |
| Recovery possible? | No (terminal) | No (terminal) |
| Idempotent? | Yes | Yes |

**When to use terminate:**
- The agent has been running for an unexpected duration and does not respond to `cancel`
- The agent is in an infinite loop
- Emergency stop is needed immediately

---

### `pause` — Temporary Stop

Sends a "pause" signal to the Temporal workflow. The workflow gracefully cancels the running activity; LangGraph auto-saves the checkpoint on cancellation. The workflow then waits for a "resume" signal — no compute resources are consumed while paused.

```bash
stigmer agent execution pause aex_abc123 --reason "Reviewing progress before continuing"
```

**Preconditions:**
- Execution must be in `EXECUTION_PENDING` or `EXECUTION_IN_PROGRESS`
- Cannot pause terminal or already-paused executions

**What happens:**
1. "pause" signal is sent to the Temporal workflow
2. Running activity is cancelled gracefully
3. LangGraph saves checkpoint using `thread_id`
4. `status.phase` → `EXECUTION_PAUSED`
5. Workflow enters a wait state (no resources consumed)
6. `status.completed_at` is **not** set (execution is not finished)

---

### `resume` — Continue from Pause

Sends a "resume" signal to the paused Temporal workflow. The workflow re-invokes the activity with the same execution context; LangGraph loads the checkpoint automatically and continues from the exact pause point.

```bash
stigmer agent execution resume aex_abc123
```

**Preconditions:**
- Execution must be in `EXECUTION_PAUSED`

**What happens:**
1. "resume" signal is sent to the waiting workflow
2. Activity is re-invoked with the same `thread_id`
3. LangGraph loads the checkpoint automatically
4. `status.phase` → `EXECUTION_IN_PROGRESS`
5. Agent continues from exactly where it was paused

---

### Pause vs. Cancel

| Aspect | `pause` | `cancel` |
|---|---|---|
| Terminal state? | No | Yes |
| Can resume? | Yes (via `resume`) | No |
| Checkpoint saved? | Yes | Yes (best-effort) |
| Workflow resources | Minimal (waiting) | None (terminated) |
| Use case | Temporary stop, review | Permanent stop |

---

### `recover` — Resume from Failure

Uses Temporal's `ResetWorkflow` to resume a `FAILED` execution from its last checkpoint. Completed work is preserved — successful tool calls are not re-executed.

```bash
stigmer agent execution recover aex_abc123
```

**Preconditions:**
- Execution must be in `EXECUTION_FAILED`
- `TERMINATED` executions cannot be recovered (incomplete checkpoint)
- `CANCELLED` executions cannot be recovered (intentional user action)

**What happens:**
1. Temporal `ResetWorkflow` is called from the last successful task
2. The activity is re-invoked with the same `thread_id`
3. LangGraph loads the checkpoint automatically
4. `status.phase` → `EXECUTION_IN_PROGRESS`
5. `status.completed_at` is cleared
6. `status.error` is cleared
7. Agent continues from where it failed — completed tool calls not re-executed

**When to use recover:**
- Agent failed due to a transient error (network timeout, rate limit)
- An external API was down but is now available
- A bug was fixed and the agent should continue without losing its progress

---

## ToolCallStatus Transitions

Tool calls also have their own status transitions, tracked in `status.tool_calls[]`:

```
Normal flow:
TOOL_CALL_PENDING → TOOL_CALL_RUNNING → TOOL_CALL_COMPLETED

Failure:
TOOL_CALL_PENDING → TOOL_CALL_RUNNING → TOOL_CALL_FAILED

HITL approval:
TOOL_CALL_PENDING → TOOL_CALL_WAITING_APPROVAL → TOOL_CALL_RUNNING → TOOL_CALL_COMPLETED
                                                ↘ TOOL_CALL_SKIPPED  (user chose skip)
```

| Status | Terminal? | Description |
|---|---|---|
| `TOOL_CALL_PENDING` | No | Created, waiting to execute. |
| `TOOL_CALL_RUNNING` | No | Currently executing. |
| `TOOL_CALL_COMPLETED` | Yes | Executed successfully. |
| `TOOL_CALL_FAILED` | Yes | Execution failed. |
| `TOOL_CALL_WAITING_APPROVAL` | No | Paused at HITL gate. See [hitl-approvals.md](hitl-approvals.md). |
| `TOOL_CALL_SKIPPED` | Yes | User chose to skip this tool. LLM adapts its plan. |

---

## Observability

The execution phase is reflected in:

- `status.phase` on every `get` or `subscribe` response
- Real-time streaming via the `subscribe` RPC — clients receive updated `AgentExecution` messages as the phase changes
- `status.started_at` and `status.completed_at` timestamps for duration measurement
- `status.error` populated on `FAILED` and `TERMINATED` with the failure reason
