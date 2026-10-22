# Session Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Session resource.

## What Is a Session?

A Session is the second layer in Stigmer's three-resource runtime stack. It is a durable, named conversation context that groups multiple Runs together, preserving message history and a persistent workspace across every run within that conversation.

```
Agent ──► Session ──► Run
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **Session** | Terminal session | Names its agent (`agent_ref`) and pins the version it resolved. Groups related runs into a conversational context. Maintains message history and workspace state across runs. |
| **Run** | `docker run` | A single invocation of the session's agent, at the pinned version. Produces messages, tool calls, and results. |

A Session is not ephemeral. It is a resource you create explicitly (or let the platform create automatically) and that persists until you delete it. Everything the agent does across multiple turns — the conversation thread, the files it creates, the sandbox environment — is anchored to the Session.

## Key Concepts

**Conversation continuity** — The Session holds `status.harness_state_id`, the harness's own id for the conversation, which carries the full conversation history across every run. The agent "remembers" everything said in previous turns because all runs within a session continue the same conversation.

**Workspace persistence** — The Session optionally provisions a sandbox (a Kubernetes pod with a persistent workspace volume, on managed deployments) with a workspace sourced from a git repository or a local path. That workspace persists across all runs in the session. Files the agent creates in turn one are still there in turn ten.

**Resources** — A session holds a list of resources (`spec.resources`): Files the agent finds under `.stigmer/uploads/` on every turn, git repositories cloned into the workspace on the first turn, and folders on the person's own machine (local mode only). A File named there that is not yet the conversation's becomes the conversation's own copy. With no repository or folder, the agent runs in an empty directory.

**The agent and its version** — `spec.agent_ref` names the agent (`org/slug`, optional `version`); empty means the built-in assistant. On create, update and apply the server resolves the reference and records `status.agent_id` and `status.agent_version_hash`. A reference naming `latest`, or none on a new or changed reference, pins the agent's current version; a tag or hash pins that version; an update that echoes the stored reference with no version keeps the pin. So an author's later saves never change an open conversation until someone updates it with `version: latest`. Naming or changing the agent needs `can_execute` on it, and every run asks again. Another organization's agent is accepted only when it is your organization's parent's, shared at `visibility_child_orgs`.

**One session, many runs** — A single session can contain an unlimited number of Runs. Each run adds to the thread. The session itself does not "run" — it is the context within which runs run.

**One ordered event log** — Everything that happens in a session is one list of events, in order: the user's messages, the agent's messages, thinking and tool calls, its subagents' threads, errors, and the session's own status. The events are Claude Managed Agents session events, named and shaped as Anthropic's SDK types them: the claim is the `managed-agents-2026-04-01` beta at `@anthropic-ai/sdk` 0.131.0, and a test renders every event the contract carries against that SDK's own types. Each event carries its place in the log (`seq`), the run (turn) it belongs to and the thread that produced it. `listEvents` pages through the log (oldest first, or `desc`; by type, by run, and by the time each event was accepted), and `streamEvents` sends events as they are appended, with optional live previews of the agent's message and thinking, and of a running tool's output (`stigmer.tool_output_delta`); a client that lists to catch up then streams with `after_seq` set to the last seq it has, and gets every later event exactly once (a stream without it starts from the moment it opens, as Managed Agents' does). The session's status says what the whole session is doing: `session.status_running` when a turn starts and nothing else was working, `session.status_idle` when the last working turn stops (`end_turn`; `budget_reached` when the turn stopped on its cost cap or tool-call limit; or `retries_exhausted` after a `session.error` when it failed, `model_request_failed_error` when the model provider failed it), read from the run's `stop_cause`, never from its error text, and a session whose turn ends with messages queued stays running into the turn that reads them. The newest status event is the session's state; a session with none is idle. Each turn's own phase is its own event, `stigmer.run.status` (pending, running, waiting, paused, then completed, failed, cancelled or terminated, with the turn's stop cause and error once it ends), written by the server with every phase change of the run: it is how a client learns that one turn ended while another still works, when the session's status does not change. Only the runner acting for a run writes the agent's events (`appendEvents`); the user's message, the session's status, every answer, every stop and every file-review decision are the server's.

**One turn at a time** — A session works on one turn at a time. A message sent while a turn works (`RunCommandController.sendMessage`, and `user.message` on the Managed Agents send) is queued: its `user.message` is stored at once with no `processed_at` and no run, and is read either by the working turn or, once that turn ends, by the next turn, which starts with every message still queued. When a turn reads a message, the message moves to the head of the log as that turn's, with its `processed_at`: it is listed once, where the agent read it, and streams a second time. A turn that waits for an answer or is paused refuses a message until it is answered or resumed. Stopping the session drops the queued messages, which stay listed with no `processed_at`. A new run in a session that already has an unfinished turn is refused with `SESSION_TURN_UNFINISHED`.

**Approvals and stopping are events** — A tool call that needs a person's answer is an `agent.tool_use` (or `agent.mcp_tool_use`) with `evaluated_permission` `ask`, and the session goes idle with `stop_reason` `requires_action`, whose `event_ids` name every call still waiting, oldest first. `confirmToolUse` answers one call with `allow` or `deny`, recorded as a `user.tool_confirmation`; a deny may carry a `deny_message`, which the agent reads. Answering some of several calls re-states the idle with the rest; once every waiting call is answered the session reads running and the turn resumes. `grantPermission` allows a call and every call of its class (its built-in category, its MCP server, or the hook that asked on that tool) for the rest of the turn, recorded as the call's confirmation, a `stigmer.permission.grant` and a confirmation for each other waiting call of the class. `interrupt` records a `user.interrupt` and stops every unfinished turn of the session (queued, working, waiting for an answer or paused); each ends cancelled and the session goes idle with `end_turn`. All three need `can_edit` on the session, and an answer already recorded is answered again without a second event. The runner writes a fact once nothing can change it: a message once it stops streaming, a tool call once it is known to run or to ask, a result once it settles, each under an id derived from the run and the row (a resumed turn reads back what its run wrote and resends none of it). Eleven stored events and one preview are Stigmer's own, optional for a Managed Agents client, which skips a type it does not know. Each is listed with what it says, why Managed Agents has none and who writes it in [Stigmer's own events](../../../../../../docs/sdk/streaming.mdx#stigmers-own-events). A file-review decision (`stigmer.file_review.decided`, by a person through `reviewFileChanges` or by a rule that keeps on the person's behalf) names the person's account in `decided_by`, empty for a rule's keep. File review never makes a turn wait: the edits are applied as the agent makes them, each can be kept or undone until the conversation's next message is sent, and whatever is undecided then is kept. An undo on a turn that has ended starts a short turn that puts the files back and sends no message, acting as the person who decided the newest undo it puts back; any later turn puts back an undo still owed before its agent runs. The run keeps only the record of what each turn changed (`RunStatus.file_changes`: the files' contents before and after, and the consent its commands ran under); every decision is the session's.

**The Managed Agents wire** — The same events are served on Claude Managed Agents' own HTTP paths, so Anthropic's SDK, pointed at a Stigmer server with a Stigmer API key, reads and answers a session unchanged: `GET /v1/sessions/{id}/events` (`events.list`), `GET /v1/sessions/{id}/events/stream` (`events.stream`, server-sent events) and `POST /v1/sessions/{id}/events` (`events.send`), compatible with `managed-agents-2026-04-01` as typed by `@anthropic-ai/sdk` 0.131.0. Only Managed Agents events leave through it; a send accepts `user.message` (text), `user.tool_confirmation` and `user.interrupt`, each applied through the method above that owns it, so every check and guard a direct call meets holds there too. The server's lane is `backend/services/stigmer-server/src/transport/managed-agents/`, and the developer guide is [Use Anthropic's SDK](../../../../../../docs/sdk/managed-agents.mdx).

## Session in the Platform Lifecycle

Sessions are scoped to an organization and are always `visibility_private`: a conversation is its author's. In the Enterprise and Cloud editions the author may share it with people one by one, as a participant (reads it and sends messages) or a viewer (reads it). Sessions are not designed to be shared across organizations — they are runtime records, not reusable templates.

Sessions are created in two ways:

1. **Explicitly** — You create a session via `stigmer session create` or `apply`, then pass the `session_id` when triggering runs.
2. **Automatically** — When you trigger a run with `session_spec` instead of `session_id`, the platform creates the session from that spec (its `agent_ref` names the agent) and runs the first message in the same request.

## Documentation Index

| Document | Description |
|---|---|
| [session-resource-guide.md](session-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [conversation-continuity.md](conversation-continuity.md) | Thread identity, message history across runs, context window interaction |
| [examples.md](examples.md) | Complete YAML examples from minimal session to git-backed workspace session |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/session/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Session` resource with metadata and `SessionStatus` (`agent_id`, `agent_version_hash`, and the runner-owned `harness_state_id` and `harness_state_id_history`) |
| `spec.proto` | `SessionSpec` — `agent_ref`, `subject`, `metadata`, `resources`, `plugins`, `skill_refs`, `harness`, `execution_target` |
| `resource.proto` | `SessionResource`, `FileResource`, `GitRepositoryResource`, `LocalPathResource` |
| `command.proto` | `SessionCommandController` — apply, create, update, updateSubject, reviewFileChanges, confirmToolUse, grantPermission, interrupt, delete, appendEvents, bindHarnessState |
| `query.proto` | `SessionQueryController` — get, list, listByAgent, listByChannel, listEvents, streamEvents |
| `event.proto` | `SessionEvent` (the log's envelope: `seq`, `session_id`, `run_id`, `thread_id`) and one message per Managed Agents event it carries, each named by its oneof member's `event_type` option, then Stigmer's own `stigmer.*` events; the `EventStart`, `EventDelta` and `ToolOutputDelta` previews |
| `event_content.proto` | The shapes events share: content blocks and their sources, stop reasons and details, errors and retry status, tool evaluations |
| `io.proto` | Input/output messages for all RPCs |

## Further Reading

- [What is a Session?](../../../../../docs/product/what-is-session.md) — Conceptual overview, the problem it solves, and getting started
- [Run docs](../../run/docs/README.md) — Runs that run within a session
- [Agent docs](../agent/docs/README.md) — The template at the top of the stack
