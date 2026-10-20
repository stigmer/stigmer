# Run Lifecycle

The phase state machine for Run — all phases, transitions, and lifecycle control operations.

---

## Phase State Machine

Every Run moves through a defined set of phases. The phase is stored in `status.phase` and updated in real time.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          RUN_PENDING                                          │
│              (created, queued, waiting for a worker to pick up)               │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                   │ worker picks up
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         RUN_IN_PROGRESS                        ◄─────────────┼───────────────┐
│                    (agent is actively processing)                             │               │
└──────────┬─────────────────┬────────────────┬──────────────────┬─────────────┘               │
           │                 │                │                  │                              │
    pause()│      interrupt()│    a tool call │        success   │          every waiting call  │
           │       (session) │    asks        │                  │          answered            │
           ▼                 ▼                ▼                  ▼                              │
┌──────────────────┐  ┌──────────────┐  ┌──────────────────────────────┐                      │
│ RUN_PAUSED       │  │RUN_          │  │ RUN_WAITING_FOR_             │──────────────────────┘
│ (checkpoint      │  │CANCELLED     │  │ APPROVAL                     │
│  saved, resumable│  │(graceful,    │  │ (waiting for a person's      │
│  via resume())   │  │ terminal)    │  │  answer; non-terminal)       │
└──────────┬───────┘  └──────────────┘  └──────────────────────────────┘
           │
    resume()│                             ┌────────────────────────────────┐
           │                              │       RUN_FAILED               │
           └──────────────────────────►   │  (an error, a stall, or a      │
                    (back to IN_PROGRESS) │   recovery given up)           │
                                          └───────────────┬────────────────┘
                                                          │ recover()
                                                          ▼
                                             (back to IN_PROGRESS,
                                              from last checkpoint)

          ┌────────────────────────────────────────────────────────────────┐
          │                    RUN_TERMINATED                               │
          │  (stopped by the platform: the cost cap or the tool-call limit, │
          │   or a force-kill via terminate())                              │
          └────────────────────────────────────────────────────────────────┘

          ┌────────────────────────────────────────────────────────────────┐
          │                    RUN_COMPLETED                                │
          │            (agent finished successfully, terminal)              │
          └────────────────────────────────────────────────────────────────┘
```

The session's `interrupt` also stops a turn that is pending, waiting for an answer or paused; each ends `RUN_CANCELLED`.

---

## Phase Reference

| Phase | Enum Value | Terminal? | Description |
|---|---|---|---|
| `RUN_PENDING` | 1 | No | Created, waiting for a worker to start processing. |
| `RUN_IN_PROGRESS` | 2 | No | Agent is actively processing the message. |
| `RUN_COMPLETED` | 3 | **Yes** | Agent finished successfully. |
| `RUN_FAILED` | 4 | **Yes** | Agent encountered an error, stalled with nothing owed by its model, or ran out of recoveries (see [A turn outlives its runner](#a-turn-outlives-its-runner)). Can be recovered. |
| `RUN_CANCELLED` | 5 | **Yes** | Stopped by the session's `interrupt`. Cannot be recovered. |
| `RUN_WAITING_FOR_APPROVAL` | 6 | No | A tool call waits for a person's answer. See [hitl-approvals.md](hitl-approvals.md). |
| `RUN_PAUSED` | 7 | No | Temporarily stopped via `pause`. Checkpoint saved. Can be resumed. |
| `RUN_TERMINATED` | 8 | **Yes** | Stopped by the platform: the cost cap or the tool-call limit, or a force-kill via `terminate`. Cannot be recovered. |

**Terminal states** — once reached, the phase does not change again:
- `COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`

**Non-terminal states** — run can continue from these:
- `PENDING`, `IN_PROGRESS`, `WAITING_FOR_APPROVAL`, `PAUSED`

`status.stop_cause` says in one word why a turn stopped (`budget_reached`, `timeout`, `infrastructure`, `platform_stop`, `user`, `model_error`, `failed`, `eval_stopped`, `review_resolved`); it is empty while the turn works and when it ended on its own.


### A turn outlives its runner

A turn is not ended by what happens to the machine running it. When its runner drains (a deploy, the platform moving it), dies, or loses its model provider mid-reply, the turn stays `RUN_IN_PROGRESS` and continues on the next runner from where it was:

- **The step that was running finishes, when the runner can wait for it.** A draining runner lets its running tool finish within its grace and stops at the next step boundary. A runner killed outright loses the step it was in, and the next runner runs that step again.
- **The agent is never handed the task again.** It resumes its own saved work, or gets a summary of what the run already did, never the original request a second time.
- **The conversation says once why the turn paused.** Examples: "The runner is restarting; this turn continues on the next one." or "The model stopped answering; this turn continues from where it was."
- **The spending limit covers the whole task.** A run continuing after a restart, a lost runner or a stall keeps its cost count; see `RunConfig.max_cost_usd`.
- **The turn's file changes stay one change set,** to keep or undo as a whole.

The platform keeps continuing a turn while it recovers fewer than ten times within any hour. Past that, or when no runner picks the turn up within five minutes, the run ends `RUN_FAILED`, and its error and stop cause say why: `infrastructure` after a drain, and the stall's own error with `timeout` after a stall its model owed. A stall with nothing owed by the model (an engine wedged before it did anything) ends `RUN_FAILED` at once, with stop cause `timeout`.
---

## Lifecycle Control Operations

A turn is stopped through its session and controlled through the run: `interrupt` on the session, and `terminate`, `pause`, `resume` and `recover` on `RunCommandController`. Each is idempotent — calling it on a run already in the target state succeeds as a no-op.

### `interrupt` — Graceful Stop (Session)

`SessionCommandController.interrupt` records a `user.interrupt` in the session's log and stops every unfinished turn of the conversation: queued, working, waiting for an answer or paused. Each ends `RUN_CANCELLED` with `stop_cause` `user`, and the session goes idle with `end_turn`. Files undone in a turn that waited are put back at once. It needs `can_edit` on the session.

```bash
stigmer runs cancel run_abc123
```

`stigmer runs cancel` interrupts the run's session and names every turn it stopped.

**After an interrupt:**
- The run is terminal and cannot be recovered
- To continue the work, send the session a new message

---

### `terminate` — Force Kill

Force-stops the run immediately. The agent receives no signal and cannot clean up. Use this only for stuck or unresponsive agents.

```bash
stigmer runs terminate run_abc123 --reason "Stuck for 30 min, not responding to interrupt"
```

**Preconditions:**
- Run must be in `RUN_PENDING` or `RUN_IN_PROGRESS`
- Cannot terminate terminal runs

**What happens:**
1. The run's workflow is stopped without a signal to the agent
2. In-progress tool calls are stopped abruptly
3. The checkpoint may be incomplete
4. `status.phase` → `RUN_TERMINATED`
5. `status.completed_at` is set

---

### Interrupt vs. Terminate

| Aspect | `interrupt` (session) | `terminate` |
|---|---|---|
| Signal sent to agent | Yes — agent can handle it | No — immediate kill |
| Scope | Every unfinished turn of the session | This run |
| Checkpoint | Saved gracefully | May be incomplete |
| Use case | Normal / planned stop | Stuck or unresponsive agent |
| Recovery possible? | No (terminal) | No (terminal) |

---

### `pause` — Temporary Stop

Stops the agent at its current checkpoint. The run is not terminal; it waits for `resume` without consuming compute.

```bash
stigmer runs pause run_abc123 --reason "Reviewing progress before continuing"
```

**Preconditions:**
- Run must be in `RUN_PENDING` or `RUN_IN_PROGRESS`
- Cannot pause terminal or already-paused runs

**What happens:**
1. The running activity is cancelled gracefully and the checkpoint is saved
2. `status.phase` → `RUN_PAUSED`
3. `status.completed_at` is **not** set (run is not finished)

---

### `resume` — Continue from Pause

Continues a paused run from the checkpoint where it stopped.

```bash
stigmer runs resume run_abc123
```

**Preconditions:**
- Run must be in `RUN_PAUSED`

**What happens:**
1. The activity is re-invoked on the same thread and loads the checkpoint
2. `status.phase` → `RUN_IN_PROGRESS`
3. Agent continues from exactly where it was paused

---

### Pause vs. Interrupt

| Aspect | `pause` | `interrupt` (session) |
|---|---|---|
| Terminal state? | No | Yes |
| Can resume? | Yes (via `resume`) | No |
| Checkpoint saved? | Yes | Best-effort |
| Use case | Temporary stop, review | Permanent stop |

---

### `recover` — Resume from Failure

`RunCommandController.recover` retries a `FAILED` run from its last checkpoint. Completed work is preserved — successful tool calls are not re-executed. The CLI has no command for it; call the RPC.

**Preconditions:**
- Run must be in `RUN_FAILED`
- `TERMINATED` runs cannot be recovered (incomplete checkpoint)
- `CANCELLED` runs cannot be recovered (intentional user action)

**What happens:**
1. A fresh workflow starts for the run; the activity is re-invoked on the same thread and loads the checkpoint
2. `status.phase` → `RUN_IN_PROGRESS`
3. `status.completed_at` and `status.error` are cleared
4. Agent continues from where it failed — completed tool calls are not re-executed

**When to use recover:**
- Agent failed due to a transient error (network timeout, rate limit)
- An external API was down but is now available
- A bug was fixed and the agent should continue without losing its progress

---

## Observability

The run phase is reflected in:

- `status.phase` on every `get` response
- The session's log: every phase change of a run is a `stigmer.run.status` event (with the stop cause and error once the turn ends), read with the session's `listEvents` or followed with `streamEvents`; see the [Session docs](../../session/docs/README.md)
- `status.started_at` and `status.completed_at` timestamps for duration measurement
- `status.error` populated on `FAILED` and `TERMINATED` with the failure reason

What the agent did inside the turn — its messages, tool calls and their results — is the session's log too, not a field of the run.
