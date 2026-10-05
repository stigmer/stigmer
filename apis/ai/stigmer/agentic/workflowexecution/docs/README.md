# WorkflowExecution Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` WorkflowExecution resource.

## What Is a WorkflowExecution?

A WorkflowExecution is a single run of a Workflow. A run names its workflow (`spec.workflow_id`) and is pinned to the version the workflow had when the run started:

```
Workflow ──► WorkflowExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Workflow** | Docker image | Defines the orchestration logic — task graph, DSL, env declarations — and who can see its runs. Every saved change is a new version. |
| **WorkflowExecution** | `docker run` | A single run of one version of a Workflow. Tracks real-time task progress, outputs, and lifecycle state. |

A run's keys come from the values passed with it (`runtime_env`), then, for the keys the workflow declares that are still missing, from the personal environment of the person who started it (for a workflow of the run's own organization). Who can see a run is the workflow's `spec.execution_visibility`: the person who started it by default, or every member of the organization when the workflow's owner opts in.

WorkflowExecutions are triggered via the API or CLI. You do not author them in YAML the way you author a Workflow — you trigger them with a message and let the system manage the resource.

## Key Capabilities

WorkflowExecution is more than a log record. It provides active runtime control:

- **Lifecycle control**: pause, resume, cancel, terminate, or recover from failure — all without losing completed work
- **Task-level progress tracking**: each task has its own status, input, output, timestamps, and error — the source of truth for execution progress
- **Human-in-the-Loop (HITL) approvals**: approval requests from child agents surface at the workflow level for centralized review
- **Signal delivery**: send external events to running workflows waiting at LISTEN tasks — with race-proof delivery via Temporal SignalWithStart
- **Real-time streaming**: subscribe to live updates via server-streaming RPC as phases and tasks change
- **Runtime environment**: inject execution-scoped environment variables and secrets for the keys the workflow declares
- **Temporal durability**: executions are backed by Temporal — they survive restarts and resume from checkpoints
- **Version pin**: every step reads the workflow version the run started on, so a later save never changes a running step

## Execution Pattern

```
Workflow "customer-onboarding" (template, current version 3f9a1c...)
  → WorkflowExecution "customer-onboarding-20250111-143022" (specific run, pinned to 3f9a1c...)
      - Phase: IN_PROGRESS
      - Tasks: [validate_email: COMPLETED, create_account: IN_PROGRESS, send_welcome: PENDING]
      - Progress: 1/3 tasks completed
```

## Trigger Sources

WorkflowExecutions can be created from multiple sources:

| Source | How | When |
|---|---|---|
| **API call** | `WorkflowExecutionCommandController.create` with `spec.workflow_id` | User or service invokes on demand |
| **CLI** | `stigmer run workflow <ref>` | Developer or operator runs manually |
| **Console** | The workflow page's run form | A person runs it from the browser |
| **MCP** | The `run_workflow` tool | An assistant runs it on a person's behalf |
| **Webhook** | Webhook handler creates execution | External system (Stripe, GitHub, etc.) fires event |

No Schedule starts a workflow yet, and a `run_workflow` task is refused when its workflow is saved.

## Documentation Index

| Document | Description |
|---|---|
| [workflow-execution-resource-guide.md](workflow-execution-resource-guide.md) | API schema reference — spec, status, tasks, CLI commands |
| [execution-lifecycle.md](execution-lifecycle.md) | Phase state machine — cancel, terminate, pause/resume, recover, signal |
| [hitl-approvals.md](hitl-approvals.md) | Human-in-the-Loop approval forwarding from child agents |
| [examples.md](examples.md) | Complete examples from minimal trigger to multi-task pipeline monitoring |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/workflowexecution/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `WorkflowExecution`, `WorkflowExecutionStatus`, `WorkflowTask` |
| `spec.proto` | `WorkflowExecutionSpec` |
| `enum.proto` | `ExecutionPhase`, `WorkflowTaskType`, `WorkflowTaskStatus`, `WorkflowUpdateType` |
| `command.proto` | `WorkflowExecutionCommandController` — create, update, updateStatus, submitApproval, delete, sendSignal, cancel, terminate, recover, pause, resume |
| `query.proto` | `WorkflowExecutionQueryController` — get, list, listByWorkflow, subscribe |
| `io.proto` | Input/output messages for all RPCs |

## Related Resources

- [Workflow Documentation](../workflow/docs/README.md) — author and validate the workflow template
- [AgentExecution Documentation](../agentexecution/docs/README.md) — agent execution invoked by `WORKFLOW_TASK_AGENT_INVOCATION` tasks
