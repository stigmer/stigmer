# WorkflowInstance Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` WorkflowInstance resource.

## What Is a WorkflowInstance?

A WorkflowInstance is a configured deployment of a Workflow template. It binds a reusable Workflow (the orchestration blueprint) to one or more Environment resources that supply the credentials, secrets, and configuration values the workflow needs to run.

WorkflowInstances are authored as YAML files and applied with `stigmer apply`. Once applied, the instance is ready to be triggered via WorkflowExecution resources.

## The Template → Instance → Execution Pattern

Stigmer separates workflow orchestration into three distinct layers:

| Layer | Resource | Role |
|---|---|---|
| **Template** | `Workflow` | Reusable orchestration blueprint — defines tasks, task order, and env variable declarations |
| **Instance** | `WorkflowInstance` | Configured deployment — binds the template to environments and secrets |
| **Execution** | `WorkflowExecution` | A single runtime run — tracks status, output, and history |

This separation means:
- A single Workflow template can power multiple instances (dev, staging, prod, different teams).
- Secrets and credentials live in Environment resources, not in the workflow definition.
- Each WorkflowExecution records an individual run with its own state and output.

## WorkflowInstance vs. Workflow: A Critical Distinction

| | Workflow | WorkflowInstance |
|---|---|---|
| **Purpose** | Define what to orchestrate | Configure how to run it |
| **Authored as** | YAML file | YAML file |
| **Applied with** | `stigmer apply workflow.yaml` | `stigmer apply workflow-instance.yaml` |
| **Contains** | Tasks, task configs, env variable declarations | Workflow reference, environment bindings |
| **Reusability** | High — shared across instances | Per-deployment — one instance per configuration |
| **Execution** | Not executable directly | Triggered via WorkflowExecution |

## Default Instance

When a Workflow is created, the platform automatically creates a **default WorkflowInstance** with no environment bindings. This instance is used for quick, credential-free testing. Its ID is stored in `status.default_instance_id` on the Workflow resource.

For production use, create dedicated instances with explicit environment bindings.

## WorkflowInstance Lifecycle

```
Author workflow-instance.yaml  ──►  stigmer apply  ──►  Instance created
         │                               │                      │
         │                        Validates workflow_id    status.audit.version = 1
         │                        and env_refs exist
         │
         ▼
Trigger execution  ──►  stigmer apply workflow-execution.yaml
         │
         └──►  WorkflowExecution created
               tracks individual run
```

WorkflowInstance creation is synchronous — the resource is available immediately after `stigmer apply` returns. There is no async validation phase (unlike Workflow resources).

## Environment Layering

A WorkflowInstance can reference multiple Environment resources in `spec.env_refs`. Environments are merged in declaration order — later environments override earlier ones for conflicting keys.

```
[base-env]  +  [aws-prod-env]  +  [github-team-env]
     │                │                    │
  Common config    AWS creds          Team-specific tokens
  for all envs     (overrides base)   (overrides generic)
```

This layered model enables clean separation of shared config from environment-specific or team-specific credentials.

## Documentation Index

| Document | Description |
|---|---|
| [workflowinstance-resource-guide.md](workflowinstance-resource-guide.md) | API schema reference — metadata, spec, status, CLI commands |
| [examples.md](examples.md) | Complete workflow instance YAML examples from minimal to multi-environment |

## Querying WorkflowInstances

Use the Stigmer MCP server (`slug: stigmer-mcp-server`) to discover existing instances:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across workflow instances, workflows, agents, and environments |
| `get_workflow_instance` | Get a specific instance by org and slug |

Always query the referenced Workflow's validation state before executing. A WorkflowInstance that references an `INVALID` Workflow will fail at execution time.
