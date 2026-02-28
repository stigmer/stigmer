# Workflow Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Workflow resource.

## What Is a Workflow?

A Workflow is a versioned, structured orchestration definition. It describes a sequence of tasks — HTTP calls, gRPC calls, agent invocations, conditional branches, parallel forks, loops, and more — that the platform executes as a durable Temporal workflow.

Workflows are authored as YAML files and applied with `stigmer apply`. Once applied, the platform validates the workflow structure asynchronously and makes it available for execution via Workflow Instances.

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
| **Referenced by** | Agent YAML (`skill_refs`) | Workflow Instance |

An agent *thinks*. A workflow *orchestrates*. Workflows can invoke agents as tasks, giving them a place inside deterministic pipelines.

## Workflow Lifecycle

```
Author workflow.yaml  ──►  stigmer apply  ──►  Platform stores resource
        │                      │                      │
        │               Creates/updates         status.state = PENDING
        │               Workflow resource       default instance created
        │
        ▼
Validation (async)  ──►  Temporal validates DSL  ──►  status.state = VALID
        │                                                      │
        │                                           Generated YAML stored
        │                                           in status.serverless_
        │                                           workflow_validation.yaml
        ▼
Execute via Instance  ──►  stigmer apply workflow-instance.yaml
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
- [examples.md](examples.md) — sub-workflow and agent_call patterns

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

Always query before referencing a workflow from a workflow instance. A reference to a nonexistent workflow fails at execution time.
