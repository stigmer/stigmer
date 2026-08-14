# Session Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Session resource.

## What Is a Session?

A Session is the third layer in Stigmer's four-resource runtime stack. It is a durable, named conversation context that groups multiple AgentExecutions together, preserving message history and a persistent workspace across every run within that conversation.

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **AgentInstance** | Container config | Binds an Agent to an Environment — provides secrets, credentials, and runtime values. |
| **Session** | Terminal session | Groups related executions into a conversational context. Maintains message history and workspace state across runs. |
| **AgentExecution** | `docker run` | A single invocation of an agent instance within a session. Produces messages, tool calls, and results. |

A Session is not ephemeral. It is a resource you create explicitly (or let the platform create automatically) and that persists until you delete it. Everything the agent does across multiple turns — the conversation thread, the files it creates, the sandbox environment — is anchored to the Session.

## Key Concepts

**Thread continuity** — The Session holds the `thread_id` that carries the full conversation history across every execution. The agent "remembers" everything said in previous turns because all executions within a session share the same thread.

**Workspace persistence** — The Session optionally provisions a sandbox (a Kubernetes pod with a persistent workspace volume, on managed deployments) with a workspace sourced from a git repository or a local path. That workspace persists across all executions in the session. Files the agent creates in turn one are still there in turn ten.

**Workspace sources** — A session can be backed by a `GitRepoSource` (clone a repo on first execution) or a `LocalPathSource` (use an existing directory on the host, local mode only). When no workspace source is specified, the agent runs in an empty directory.

**One session, many executions** — A single session can contain an unlimited number of AgentExecutions. Each execution adds to the thread. The session itself does not "run" — it is the context within which executions run.

## Session in the Platform Lifecycle

Sessions are scoped to an organization and are always `visibility_private`. They are not designed to be shared across organizations — they are runtime artifacts, not reusable templates.

Sessions are created in two ways:

1. **Explicitly** — You create a session via `stigmer session create` or `apply`, then pass the `session_id` when triggering executions.
2. **Automatically** — When you trigger an execution with only an `agent_id` (no `session_id`), the platform auto-creates a session backed by the agent's default instance.

## Documentation Index

| Document | Description |
|---|---|
| [session-resource-guide.md](session-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [workspace-sources.md](workspace-sources.md) | Git repo and local path workspace provisioning, branch/commit pinning, authentication |
| [conversation-continuity.md](conversation-continuity.md) | Thread identity, message history across executions, context window interaction |
| [examples.md](examples.md) | Complete YAML examples from minimal session to git-backed workspace session |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/session/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Session` resource with metadata and status |
| `spec.proto` | `SessionSpec` — `agent_instance_id`, `subject`, `thread_id`, `sandbox_id`, `metadata`, `workspace_source` |
| `workspace.proto` | `WorkspaceSource`, `GitRepoSource`, `LocalPathSource` |
| `command.proto` | `SessionCommandController` — apply, create, update, delete |
| `query.proto` | `SessionQueryController` — get, list, listByAgentInstance |
| `io.proto` | Input/output messages for all RPCs |

## Further Reading

- [What is a Session?](../../../../../docs/product/what-is-session.md) — Conceptual overview, the problem it solves, and getting started
- [AgentExecution docs](../agentexecution/docs/README.md) — Executions that run within a session
- [AgentInstance docs](../agentinstance/docs/README.md) — The instance a session is bound to
- [Agent docs](../agent/docs/README.md) — The template at the top of the stack
