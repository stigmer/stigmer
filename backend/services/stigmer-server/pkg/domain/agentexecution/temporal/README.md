# Agent Execution Temporal Integration

This package contains the Temporal workflow definitions and activity stubs for
agent execution in Stigmer OSS: the Go side of a two-worker split in which
stigmer-server orchestrates and the TypeScript unified runner
(`backend/services/runner`) executes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Temporal Server                              │
└─────────────────────────────────────────────────────────────────┘
                      │                    │
         ┌────────────▼─────────┐  ┌──────▼──────────────────┐
         │  Workflow Tasks       │  │  Activity Tasks         │
         │  (stigmer-server)     │  │  (unified runner)       │
         └────────────┬─────────┘  └──────┬──────────────────┘
                      │                    │
         ┌────────────▼─────────┐  ┌──────▼──────────────────┐
         │  Go Worker            │  │  TS Runner Worker       │
         │  agent_execution_     │  │  stigmer_runner (or     │
         │  stigmer              │  │  session:{id} /         │
         │                       │  │  wfexec:{id})           │
         │  - InvokeAgentExec-   │  │  - EnsureThread         │
         │    utionWorkflow      │  │  - ExecuteDeepAgent     │
         │  - CompleteExternal-  │  │  - ExecuteCursor        │
         │    Activity           │  │  (+ workflow-engine     │
         │  - UpdateExecution-   │  │   activities and the    │
         │    Status (reg+local) │  │   runner's own          │
         │  - Load/DeleteEC/     │  │   workflows)            │
         │    ReadHarness (LOCAL)│  │                         │
         └───────────────────────┘  └─────────────────────────┘
```

One runner codebase serves both harnesses: the workflow dispatches
`ExecuteDeepAgent` (native/deepagents) or `ExecuteCursor` (Cursor CLI) based on
`session.spec.harness`, and Temporal routes by activity NAME within the runner
queue — there are no per-harness queues.

## Task Queues

- **Go Workflow Queue**: `agent_execution_stigmer`
  (env: `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE`)
  - Workflow orchestration plus the Go-side activities listed above.

- **Runner Activity Queue** (env: `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`,
  default: `stigmer_runner`)
  - In **global** routing mode: all sessions share this single queue.
  - In **session** routing mode: serves as the fallback when session ID is empty.

  > Historical note: the retired Python agent-runner polled a queue named
  > `agent_execution_runner`. That queue name is gone from live code — only the
  > ENV VAR name above still carries the old wording, and it must stay
  > byte-identical for deployment compatibility.

## Activity Routing Modes

Controlled by `STIGMER_ACTIVITY_ROUTING` (default: `global`):

| Mode | Queue Name | Use Case |
|------|-----------|----------|
| `global` | `stigmer_runner` | OSS local dev — single runner polls one shared queue |
| `session` | `session:{session_id}` | Desktop (embedded runners) and cloud (per-session sandboxes) |

In **session** mode, each session's activities route to a dedicated queue
derived from the session ID (e.g. `session:ses_01arz…`). The runner polling
that queue handles all execution activities for that session, providing
workspace isolation and data locality. A workflow child execution can also
carry an explicit `wfexec:{execution_id}` override for sandbox affinity.

The queue is resolved ONCE at workflow creation (`dispatch.go` →
`workflow_creator.go`) and pinned in the workflow **memo** under
`activityTaskQueue`; the workflow reads it back on every dispatch. The queue
name is derived by convention, not stored as state — dispatch does not need to
check whether a runner is polling, because Temporal holds activity tasks in
the queue until a worker connects.

## Components

- `config.go` — queue names, routing mode, default execution target (all
  env-driven, with the defaults documented above).
- `dispatch.go` — the single queue-resolution rule (explicit override →
  session mode → global RunnerQueue).
- `workflow_creator.go` — starts `InvokeAgentExecutionWorkflow` on the stigmer
  queue with the resolved activity queue in the memo; sends the
  `approvalGateResolved` signal.
- `worker_config.go` — builds the Go worker and registers exactly what Go
  implements (see the file header for the full registration table).
- `workflow_types.go` — the signal-name wire identifiers (`pause`, `resume`,
  `approvalGateResolved`).
- `workflows/` — the orchestration implementation: harness dispatch, HITL
  approval loop, pause/resume via CancellationScope, error wrapping.
- `activities/` — Go-side implementations (UpdateExecutionStatus,
  LoadAgentExecution, ReadHarnessStateId, CompleteExternalActivity) and typed
  STUBS for the runner-side activities (EnsureThread, ExecuteDeepAgent,
  ExecuteCursor, GenerateSessionSubject).

## Wire Identifiers (must stay byte-identical)

In-flight workflows and cross-edition compatibility depend on these exact
strings:

- Workflow type: `stigmer/agent-execution/invoke`
- Activity names: `EnsureThread`, `ExecuteDeepAgent`, `ExecuteCursor`,
  `GenerateSessionSubject`, `UpdateExecutionStatusActivity`,
  `stigmer/system/complete-external-activity`
- Signals: `pause`, `resume`, `approvalGateResolved`
- Memo key: `activityTaskQueue`
- Queue names/prefixes: `agent_execution_stigmer`, `stigmer_runner`,
  `session:`, `wfexec:`
- Env vars: `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE`,
  `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`, `STIGMER_ACTIVITY_ROUTING`,
  `STIGMER_DEFAULT_EXECUTION_TARGET`

Activity INPUTS are wire contracts too: `ExecuteCursorActivityInput` carries a
snake_case JSON shape shared with the Java control plane and the TS runner,
locked by `activities/execute_input_test.go`.

## Workflow Execution Flow

1. **Create Execution** — `AgentExecutionCreateHandler` persists the execution,
   resolves the activity queue via dispatch, and starts the workflow with a
   slim input (IDs + callback token; no secrets or large payloads in Temporal
   history).
2. **Workflow starts (Go worker)** — reads the activity queue from the memo,
   then branches on harness:
   - **Native**: `EnsureThread` → `ExecuteDeepAgent` (HITL loop re-invokes the
     activity after each `approvalGateResolved`).
   - **Cursor**: `ReadHarnessStateId` → `ExecuteCursor` (same loop; the Cursor
     agent id lives in `session.spec.harness_state_id`).
   - Both flows fire `GenerateSessionSubject` fire-and-forget — KNOWN-DEAD in
     OSS today (no worker registers it; issue #665 owns the fix).
3. **Runner executes (TS worker)** — streams status back via the server's gRPC
   UpdateStatus path; the workflow's `UpdateExecutionStatus` activity covers
   the failure/cancellation and final-persist paths.
4. **Error handling (Go workflow)** — `wrapActivityError` translates Temporal
   failure classes (no worker, heartbeat loss, timeout, application error)
   into actionable messages pointing at runner logs.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE` | `agent_execution_stigmer` | Go workflow queue |
| `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` | `stigmer_runner` | Runner activity queue (global mode) |
| `STIGMER_ACTIVITY_ROUTING` | `global` | `global` or `session` |
| `STIGMER_DEFAULT_EXECUTION_TARGET` | `local` | Resolves `EXECUTION_TARGET_UNSPECIFIED` (`local`/`cloud`) |

## Relationship to the Cloud Edition

The cloud edition (stigmer-cloud, Java) implements the same workflow TYPE and
signal names with its own worker set — including a Java
`GenerateSessionSubjectActivityImpl` that OSS currently lacks (#665). The
workflowexecution domain's `worker_config.go` in this repo documents the same
two-worker split for CNCF workflow execution and is the sibling reference.
