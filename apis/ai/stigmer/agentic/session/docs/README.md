# Session Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Session resource.

## What Is a Session?

A Session is the second layer in Stigmer's three-resource runtime stack. It is a durable, named conversation context that groups multiple AgentRuns together, preserving message history and a persistent workspace across every run within that conversation.

```
Agent ──► Session ──► AgentRun
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **Session** | Terminal session | Names its agent (`agent_ref`) and pins the version it resolved. Groups related runs into a conversational context. Maintains message history and workspace state across runs. |
| **AgentRun** | `docker run` | A single invocation of the session's agent, at the pinned version. Produces messages, tool calls, and results. |

A Session is not ephemeral. It is a resource you create explicitly (or let the platform create automatically) and that persists until you delete it. Everything the agent does across multiple turns — the conversation thread, the files it creates, the sandbox environment — is anchored to the Session.

## Key Concepts

**Thread continuity** — The Session holds the `thread_id` that carries the full conversation history across every run. The agent "remembers" everything said in previous turns because all runs within a session share the same thread.

**Workspace persistence** — The Session optionally provisions a sandbox (a Kubernetes pod with a persistent workspace volume, on managed deployments) with a workspace sourced from a git repository or a local path. That workspace persists across all runs in the session. Files the agent creates in turn one are still there in turn ten.

**Workspace sources** — A session can be backed by a `GitRepoSource` (clone a repo on first run) or a `LocalPathSource` (use an existing directory on the host, local mode only). When no workspace source is specified, the agent runs in an empty directory.

**The agent and its version** — `spec.agent_ref` names the agent (`org/slug`, optional `version`); empty means the built-in assistant. On create, update and apply the server resolves the reference and records `status.agent_id` and `status.agent_version_hash`. A reference naming `latest`, or none on a new or changed reference, pins the agent's current version; a tag or hash pins that version; an update that echoes the stored reference with no version keeps the pin. So an author's later saves never change an open conversation until someone updates it with `version: latest`. Naming or changing the agent needs `can_execute` on it, and every run asks again. Another organization's agent is accepted only when it is your organization's parent's, shared at `visibility_child_orgs`.

**One session, many runs** — A single session can contain an unlimited number of AgentRuns. Each run adds to the thread. The session itself does not "run" — it is the context within which runs run.

## Session in the Platform Lifecycle

Sessions are scoped to an organization and are always `visibility_private`. They are not designed to be shared across organizations — they are runtime artifacts, not reusable templates.

Sessions are created in two ways:

1. **Explicitly** — You create a session via `stigmer session create` or `apply`, then pass the `session_id` when triggering runs.
2. **Automatically** — When you trigger a run with `session_spec` instead of `session_id`, the platform creates the session from that spec (its `agent_ref` names the agent) and runs the first message in the same request.

## Documentation Index

| Document | Description |
|---|---|
| [session-resource-guide.md](session-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [workspace-sources.md](workspace-sources.md) | Git repo and local path workspace provisioning, branch/commit pinning, authentication |
| [conversation-continuity.md](conversation-continuity.md) | Thread identity, message history across runs, context window interaction |
| [examples.md](examples.md) | Complete YAML examples from minimal session to git-backed workspace session |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/session/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Session` resource with metadata and `SessionStatus` (`agent_id`, `agent_version_hash`) |
| `spec.proto` | `SessionSpec` — `agent_ref`, `subject`, `harness_state_id`, `metadata`, `workspace_entries`, `mcp_server_usages`, `skill_refs`, `harness`, `execution_target` |
| `workspace.proto` | `WorkspaceSource`, `GitRepoSource`, `LocalPathSource` |
| `command.proto` | `SessionCommandController` — apply, create, update, delete |
| `query.proto` | `SessionQueryController` — get, list, listByAgent |
| `io.proto` | Input/output messages for all RPCs |

## Further Reading

- [What is a Session?](../../../../../docs/product/what-is-session.md) — Conceptual overview, the problem it solves, and getting started
- [AgentRun docs](../agentrun/docs/README.md) — Runs that run within a session
- [Agent docs](../agent/docs/README.md) — The template at the top of the stack
