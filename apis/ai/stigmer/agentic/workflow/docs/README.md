# Workflow Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Workflow resource.

## What Is a Workflow?

A Workflow is a versioned, structured orchestration definition. It describes a sequence of tasks — HTTP calls, gRPC calls, agent invocations, conditional branches, parallel forks, loops, and more — that the platform executes as a durable Temporal workflow.

Workflows are authored as YAML files and applied with `stigmer apply`. Once applied, the platform validates the workflow structure and records a version; a run starts on the workflow itself (`WorkflowRun.spec.workflow_id`) and is pinned to the version the workflow had when the run started.

## Workflow vs. Agent: A Critical Distinction

Workflows and Agents serve different purposes and execute differently.

| | Agent | Workflow |
|---|---|---|
| **Purpose** | Conversational AI with tools | Deterministic orchestration |
| **Authored as** | YAML file | YAML file |
| **Applied with** | `stigmer apply agent.yaml` | `stigmer apply workflow.yaml` |
| **Executes as** | LLM + tool calls | Temporal durable workflow |
| **Control flow** | Emergent (LLM-driven) | Explicit (defined in spec) |
| **Invokes agents** | Not applicable | `agent_call` task |
| **Run by** | Session (`agent_ref`) | WorkflowRun (`workflow_id`) |

An agent *thinks*. A workflow *orchestrates*. Workflows can invoke agents as tasks, giving them a place inside deterministic pipelines.

## Workflow Lifecycle

```
Author workflow.yaml  ──►  stigmer apply  ──►  Platform stores resource
        │                      │                      │
        │               Creates/updates         status.state = PENDING
        │               Workflow resource       version recorded
        │
        ▼
Validation (async)  ──►  Temporal validates DSL  ──►  status.state = VALID
        │                                                      │
        │                                           Generated YAML stored
        │                                           in status.serverless_
        │                                           workflow_validation.yaml
        ▼
Run  ──►  stigmer run workflow <org>/<workflow>  (WorkflowRun, spec.workflow_id)
```

Workflow creation does not block on validation. The resource is created immediately with `validation_state: PENDING`. Validation runs in the background via Temporal. Users can poll `status.serverless_workflow_validation.state` to confirm validity before executing.

## Two Audiences

This documentation serves two distinct audiences:

**Workflow Authors** — engineers building automation pipelines:
- [workflow-resource-guide.md](workflow-resource-guide.md) — resource schema, metadata, CLI commands
- [task-reference.md](task-reference.md) — all 13 task types with configs and examples
- [expressions.md](expressions.md) — JQ expression syntax for dynamic values
- [examples.md](examples.md) — complete end-to-end workflow YAML examples

**Platform Integrators** — engineers running workflows programmatically:
- [workflow-resource-guide.md](workflow-resource-guide.md) — status fields and validation lifecycle
- [examples.md](examples.md) — agent_call and integration patterns

## Documentation Index

| Document | Description |
|---|---|
| [workflow-resource-guide.md](workflow-resource-guide.md) | API schema reference — metadata, spec, status, validation lifecycle, CLI commands |
| [task-reference.md](task-reference.md) | All 13 task types — schemas, required fields, YAML examples |
| [expressions.md](expressions.md) | JQ expression syntax — `${ }` notation, context variables, common patterns |
| [examples.md](examples.md) | Complete workflows from minimal single-task to multi-agent pipelines |

## Querying Workflows

Use the Stigmer MCP server (`slug: stigmer-mcp-server`) to discover existing workflows:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across workflows, agents, skills, MCP servers |
| `get_workflow` | Get a specific workflow by org and slug |

Always query before starting a run: a run that names a workflow the caller cannot run, or one that does not exist, is refused.

## Related Documentation

- [WorkflowRun Documentation](../../workflowrun/docs/README.md) — how to trigger, monitor, and control workflow runs

## Versions and run visibility

- **Version**: the hash of the whole spec — tasks, each `agent_call` step's `environment_refs`, the declared `env`, the budget and the description — with `run_visibility` cleared. Saving a spec that differs from every earlier version records a new one; a run reads the version it pinned at start for every step.
- **Run visibility** (`spec.run_visibility`): who can see the workflow's runs. `workflow_run_visibility_private` (the default) shows each run to the person who started it; `workflow_run_visibility_organization` shows every run, past runs included, to every member of the organization. It is set at create and changed only through `WorkflowCommandController.updateRunVisibility`, which requires `can_manage_audience` (the workflow's owner); update and apply keep the stored level, and changing it records no version.
- **Step names**: an `agent_call` task's name is unique across the whole workflow, the tasks nested in `for_each`, `fork` and `try_catch` and every `compensate` list included. A save that repeats one is refused, naming both places.
