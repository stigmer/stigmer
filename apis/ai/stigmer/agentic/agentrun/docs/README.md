# AgentExecution Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` AgentExecution resource.

## What Is an AgentExecution?

An AgentExecution is a single, observable, controllable run of an agent — one user message and the agent's response. It is the bottom layer of the three-resource runtime stack:

```
Agent ──► Session ──► AgentExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **Session** | Terminal session | Names the agent it runs (`agent_ref`) and pins the version it resolved. Groups related executions into a conversational context and maintains message history across runs. |
| **AgentExecution** | `docker run` | A single invocation of the session's agent, at the session's pinned version. Produces messages, tool calls, and results. |

An execution continues a session (`session_id`) or starts a new one (`session_spec`, whose `agent_ref` names the agent; empty runs the built-in assistant). Secrets and runtime values come from the Environments bound to whatever started the run (a schedule, a workflow task, a PlatformClient), from `runtime_env`, and, for declared keys still missing, from the personal environment of the person who sent the message.

AgentExecutions are created via the API or CLI. You do not author them in YAML the way you author an Agent — you trigger them with a message and let the system manage the resource.

## Key Capabilities

AgentExecution is more than a log record. It provides active runtime control:

- **Lifecycle control**: pause, resume, cancel, terminate, or recover from failure — all without losing completed work
- **Human-in-the-Loop (HITL) approvals**: pause mid-run at a tool approval gate and wait for a human decision (approve, skip, or reject) before continuing
- **File attachments**: inject input files into the agent's sandbox before execution starts
- **Execution artifacts**: download files and directories created by the agent during execution
- **Run settings**: one `run_config` per message (model, speed tier, thinking, cost and tool limits), resolved with the agent's defaults and recorded on `status.run_config`; see [agent-execution-resource-guide.md](agent-execution-resource-guide.md#run-settings-run_config)
- **Context management**: automatic context window summarization for long-running conversations, by the model's Model Registry entry
- **Usage metrics**: real-time token and LLM call tracking per execution and per sub-agent
- **Resolved context visibility**: see exactly which MCP servers, environment keys, and skills the agent had access to
- **Async workflow integration**: Temporal token handshake for workflow-invoked agents, through the vouched `parent` link

## Documentation Index

| Document | Description |
|---|---|
| [agent-execution-resource-guide.md](agent-execution-resource-guide.md) | Complete spec and status schema reference — all fields, types, and CLI commands |
| [execution-lifecycle.md](execution-lifecycle.md) | Phase state machine — cancel, terminate, pause/resume, recover |
| [hitl-approvals.md](hitl-approvals.md) | Human-in-the-Loop approval gates — approve, skip, reject, batch approvals |
| [attachments-and-artifacts.md](attachments-and-artifacts.md) | Input file attachments and output execution artifacts |
| [examples.md](examples.md) | Complete examples from minimal trigger to full-featured execution |
| [async-workflow-integration.md](async-workflow-integration.md) | Temporal token handshake for pipeline-invoked agents |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/agentexecution/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `AgentExecution`, `AgentExecutionStatus`, `ToolCall`, `SubAgentExecution`, `UsageMetrics`, `ContextInfo`, `ExecutionArtifact`, `PendingApproval` |
| `spec.proto` | `AgentExecutionSpec`, `WorkflowParent`, `Attachment` |
| `invocation.proto` | `RunConfig` (the settings message every run, surface and agent shares), `AgentInvocation` |
| `enum.proto` | `ExecutionPhase`, `MessageType`, `ToolCallStatus`, `TodoStatus`, `SubAgentStatus`, `ExecutionArtifactKind`, `ApprovalAction` |
| `command.proto` | `AgentExecutionCommandController` — create, update, cancel, terminate, pause, resume, recover, submitApproval, uploadAttachment |
| `query.proto` | `AgentExecutionQueryController` — get, list, listBySession, subscribe, getArtifactDownloadUrl |
| `io.proto` | Input/output messages for all RPCs |
