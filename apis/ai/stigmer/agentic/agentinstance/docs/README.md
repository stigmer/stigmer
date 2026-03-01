# AgentInstance Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` AgentInstance resource.

## What Is an AgentInstance?

An AgentInstance is the **binding layer** between an Agent template and its runtime environment. It supplies the secrets, credentials, and environment variable values that an Agent declared it needs — transforming a static template into a live, runnable configuration.

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **AgentInstance** | Container config | Binds an Agent to an Environment — provides secrets, credentials, and runtime values. |
| **Session** | Terminal session | Groups related executions into a conversational context. Maintains message history across runs. |
| **AgentExecution** | `docker run` | A single invocation of an agent instance within a session. Produces messages, tool calls, and results. |

Every Agent has a **default instance** created automatically at creation time. This default instance requires no configuration — it exists to allow the agent to be run immediately via `stigmer run` without first creating a named instance. Named instances are created when you need to bind specific secrets or credentials.

## Key Capabilities

- **Environment binding**: attach one or more Environment resources to provide secrets and configuration to the agent at runtime
- **Layered overrides**: multiple environments are merged in order — later environments override earlier ones, enabling base + override patterns (e.g., `[base-config, github-prod-secrets]`)
- **Scoped access**: instances can be scoped to a platform, organization, or identity account — allowing per-team and per-user configurations of the same agent template
- **Multiple instances per agent**: create separate instances for development, staging, and production without duplicating the agent definition

## Documentation Index

| Document | Description |
|---|---|
| [agent-instance-resource-guide.md](agent-instance-resource-guide.md) | Complete spec and status schema reference — all fields, types, and CLI commands |
| [environment-binding.md](environment-binding.md) | How environments are layered, merged, and resolved at execution time |
| [examples.md](examples.md) | Complete examples from minimal to full-featured instance configurations |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/agentinstance/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `AgentInstance`, `AgentInstanceSpec` |
| `spec.proto` | `AgentInstanceSpec` — `agent_id`, `description`, `environment_refs` |
| `command.proto` | `AgentInstanceCommandController` — apply, create, update, delete |
| `query.proto` | `AgentInstanceQueryController` — get, getByAgent, getByReference |
| `io.proto` | Input/output messages for all RPCs — `AgentInstanceId`, `GetAgentInstancesByAgentRequest`, `AgentInstanceList` |
