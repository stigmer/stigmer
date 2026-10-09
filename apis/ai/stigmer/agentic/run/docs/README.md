# Run Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Run resource.

## What Is a Run?

A Run is a single, observable, controllable run of an agent — one user message and the agent's response. It is the bottom layer of the three-resource runtime stack:

```
Agent ──► Session ──► Run
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **Session** | Terminal session | Names the agent it runs (`agent_ref`) and pins the version it resolved. Groups related runs into a conversational context and maintains message history across runs. |
| **Run** | `docker run` | A single invocation of the session's agent, at the session's pinned version. Produces messages, tool calls, and results. |

A run continues a session (`session_id`) or starts a new one (`session_spec`, whose `agent_ref` names the agent; empty runs the built-in assistant). Secrets and logins come from the sender's My vault when the conversation includes it (`include_my_vault`), then the vaults the conversation lists; a run no person sent uses only the vaults its conversation and its schedule, share, channel or platform client name.

Runs are created via the API or CLI. You do not author them in YAML the way you author an Agent — you trigger them with a message and let the system manage the resource.

## Key Capabilities

Run is more than a log record. It provides active runtime control:

- **Lifecycle control**: pause, resume, cancel, terminate, or recover from failure — all without losing completed work
- **Human-in-the-Loop (HITL) approvals**: pause mid-run at a tool approval gate and wait for a human decision (approve, skip, or reject) before continuing
- **File attachments**: inject input files into the agent's sandbox before the run starts
- **Run artifacts**: download files and directories created by the agent during the run
- **Run settings**: one `run_config` per message (model, speed tier, thinking, cost and tool limits), resolved with the agent's defaults and recorded on `status.run_config`; see [run-resource-guide.md](run-resource-guide.md#run-settings-run_config)
- **Context management**: automatic context window summarization for long-running conversations, by the model's Model Registry entry
- **Usage metrics**: real-time token and LLM call tracking per run and per sub-agent
- **Resolved context visibility**: see exactly which MCP servers, environment keys, and skills the agent had access to

## Documentation Index

| Document | Description |
|---|---|
| [run-resource-guide.md](run-resource-guide.md) | Complete spec and status schema reference — all fields, types, and CLI commands |
| [run-lifecycle.md](run-lifecycle.md) | Phase state machine — cancel, terminate, pause/resume, recover |
| [hitl-approvals.md](hitl-approvals.md) | Human-in-the-Loop approval gates — approve, skip, reject, batch approvals |
| [attachments-and-artifacts.md](attachments-and-artifacts.md) | Input file attachments and output run artifacts |
| [examples.md](examples.md) | Complete examples from minimal trigger to full-featured run |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/run/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Run`, `RunStatus`, `ToolCall`, `SubAgentRun`, `UsageMetrics`, `ContextInfo`, `RunArtifact`, `PendingApproval` |
| `spec.proto` | `RunSpec`, `Attachment` |
| `invocation.proto` | `RunConfig` (the settings message every run, surface and agent shares), `AgentInvocation` |
| `enum.proto` | `RunPhase`, `MessageType`, `ToolCallStatus`, `TodoStatus`, `SubAgentStatus`, `RunArtifactKind`, `ApprovalAction` |
| `command.proto` | `RunCommandController` — create, update, cancel, terminate, pause, resume, recover, submitApproval, uploadAttachment |
| `query.proto` | `RunQueryController` — get, list, listBySession, subscribe, getArtifactDownloadUrl |
| `io.proto` | Input/output messages for all RPCs |
