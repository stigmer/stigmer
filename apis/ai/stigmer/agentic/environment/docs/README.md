# Environment Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Environment resource.

## What Is an Environment?

An Environment is a **named collection of configuration and secrets**. It stores the key-value pairs that agents, workflow instances, and agent instances need at runtime — credentials, API tokens, feature flags, and other configuration that must not be hard-coded into an Agent definition.

```
Environment ──► AgentInstance (via environment_refs) ──► AgentExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Environment** | `.env` file | Stores named key-value pairs, each optionally marked as secret. Encrypted at rest when secret. |
| **AgentInstance** | Container config | References one or more Environments to supply runtime values to an Agent. |
| **AgentExecution** | `docker run` | Resolves all referenced Environments at start time and injects values into the agent sandbox. |

Environments are created independently of agents and instances — the same Environment can be referenced by many instances, enabling shared credential sets across teams and agents.

## Key Capabilities

- **Secret and non-secret values**: each key-value pair is individually marked as secret (`is_secret: true`) or plain config (`is_secret: false`) — no need for a separate secrets store
- **Encrypted at rest**: secret values are encrypted before storage and redacted in logs; plain values are stored as plaintext
- **Reusable across instances**: one Environment can be referenced by multiple AgentInstances or WorkflowInstances simultaneously
- **Layered merging**: AgentInstances can reference multiple Environments in order — later entries override earlier ones, enabling base + override patterns
- **Per-value descriptions**: each entry carries an optional human-readable description, making the environment self-documenting

## Documentation Index

| Document | Description |
|---|---|
| [environment-resource-guide.md](environment-resource-guide.md) | Complete spec and status schema reference — all fields, types, and CLI commands |
| [examples.md](examples.md) | Complete examples from minimal to full-featured environment configurations |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/environment/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Environment`, top-level resource message |
| `spec.proto` | `EnvironmentSpec` — `description`, `data`; `EnvironmentValue` — `value`, `is_secret`, `description` |
| `command.proto` | `EnvironmentCommandController` — apply, create, update, delete, updateVariables, removeVariables |
| `query.proto` | `EnvironmentQueryController` — get, getByReference, getSecretValue, list |
| `io.proto` | Input/output messages — `EnvironmentId`, `EnvironmentSecretValueInput`, `ListEnvironmentsRequest`, `EnvironmentList`, `UpdateEnvironmentVariablesRequest`, `RemoveEnvironmentVariablesRequest` |
