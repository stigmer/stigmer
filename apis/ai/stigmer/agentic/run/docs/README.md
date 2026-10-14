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
| **Run** | `docker run` | A single invocation of the session's agent, at the session's pinned version. Records the turn's phase, settings, usage, artifacts and file record; what the agent said and did is the session's event log. |

A run continues a session (`session_id`) or starts a new one (`session_spec`, whose `agent_ref` names the agent; empty runs the built-in assistant). Secrets and logins come from the sender's My vault when the conversation includes it (`include_my_vault`), then the vaults the conversation lists; a run no person sent uses only the vaults its conversation and its schedule, share, channel or organization's embedding settings name.

Runs are created via the API or CLI. You do not author them in YAML the way you author an Agent — you trigger them with a message and let the system manage the resource.

A run does not carry its transcript. The agent's messages, thinking, tool calls and results, approvals, todos, sub-agent threads, structured output, recalled memories and file-review decisions are events in the session's log, read with the session's `listEvents` and `streamEvents`, each event naming the run it belongs to. See the [Session docs](../../session/docs/README.md).

## Key Capabilities

Run is more than a log record. It provides active runtime control:

- **Lifecycle control**: pause, resume, terminate, or recover from failure without losing completed work; the session's `interrupt` stops a conversation's unfinished turns
- **Human-in-the-Loop (HITL) approvals**: a turn waits at a tool that needs a person's answer (`RUN_WAITING_FOR_APPROVAL`) until the session's `confirmToolUse` or `grantPermission` answers it
- **File record**: `status.file_changes` keeps the change sets each turn captured (contents before and after, the diff, the snapshots); keeping or undoing them is the session's file review
- **File attachments**: inject input files into the agent's sandbox before the run starts
- **Run artifacts**: download files and directories created by the agent during the run
- **Run settings**: one `run_config` per message (model, speed tier, thinking, cost and tool limits), resolved with the agent's defaults and recorded on `status.run_config`; see [run-resource-guide.md](run-resource-guide.md#run-settings-run_config)
- **Context management**: automatic context window summarization for long-running conversations, by the model's Model Registry entry
- **Usage**: `status.streaming_usage` tracks tokens and estimated cost while the run works; the usage report RPCs read the metered record
- **Credential sources**: `status.credentials.sources` names, for every key the run uses, the vault and entry it comes from, never the value

## Documentation Index

| Document | Description |
|---|---|
| [run-resource-guide.md](run-resource-guide.md) | Complete spec and status schema reference — all fields, types, and CLI commands |
| [run-lifecycle.md](run-lifecycle.md) | Phase state machine — interrupt, terminate, pause/resume, recover |
| [hitl-approvals.md](hitl-approvals.md) | Human-in-the-Loop approval gates — what asks, answering on the session, approve all, unattended turns |
| [attachments-and-artifacts.md](attachments-and-artifacts.md) | Input file attachments and output run artifacts |
| [examples.md](examples.md) | Complete examples from minimal trigger to full-featured run |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/run/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `Run`, `RunStatus`, `LoadedVersions`, `RunCredentials`, `RunValueSource`, `RunValueDeclarer`, `SetupProgress` |
| `spec.proto` | `RunSpec`, `Attachment`, `ConversationCatchup`, `DeclaredPreferences`, `RecalledMemories`, `RecalledMemoryFact` |
| `invocation.proto` | `RunConfig` (the settings message every run, surface and agent shares), `AgentInvocation` |
| `enum.proto` | `RunPhase`, `RunArtifactKind`, `RunControlSignal`, `InteractionMode`, `ApprovalMode`, `ServiceTier`, `ThinkingMode`, the file-record enums (`FileChangeKind`, `FileCaptureClass`, `DiffCompleteness`, `SnapshotKind`, `FileReviewBlockReason`), `RunValueDeclarerKind`, `RunValueOrigin` |
| `filereview.proto` | The file record: `FileChangeSet`, `CapturedFileChange`, `SnapshotRef`, `GitTreeRef`, `CasManifestRef`, `TurnCommandProvenance`; the live `FileChangeProgress` |
| `message.proto` | `ToolCallOutputRef`, `FileContent` — the inline-or-stored content envelope the file record uses |
| `artifact.proto` | `RunArtifact` |
| `writeback.proto` | `WorkspaceWriteBack`, `WorkspaceWriteBackPhase` |
| `usage.proto` | `StreamingUsageSummary`, `LlmCallUsageRecord`, `TokenUsage`, `ModelUsage` and the usage report aggregates |
| `plugin_eval_case.proto` | `PluginEvalCaseContext`, `PluginEvalFiles` and the mock server types a plugin eval's turn runs with |
| `command.proto` | `RunCommandController` — create, update, updateStatus, delete, terminate, recover, pause, resume, uploadAttachment |
| `query.proto` | `RunQueryController` — get, list, listBySession, getArtifactDownloadUrl, getArtifactContent, the usage reports (run, session, agent, org), getRunSummary |
| `io.proto` | Input/output messages for all RPCs |
