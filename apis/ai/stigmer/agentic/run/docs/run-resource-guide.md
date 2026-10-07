# Run Resource Guide

Complete spec and status schema reference for the `agentic.stigmer.ai/v1` Run resource.

For conceptual overview, lifecycle, and documentation index, see [README.md](README.md).

---

## Resource Structure

A Run follows the standard Stigmer resource pattern:

```
Run
├── metadata    — system-managed identity and audit fields
├── spec        — user-provided inputs (what you supply when triggering)
└── status      — system-managed outputs (what the system records during/after the run)
```

You never write `status` fields. They are populated by the agent runner and updated progressively during the run.

---

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Run` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | User-provided run inputs |
| `status` | No | System-managed; never set by users |

---

## Spec Fields (`RunSpec`)

Defined in `ai/stigmer/agentic/run/v1/spec.proto`.

### Session and Agent Targeting

`target` is a oneof: set `session_id` or `session_spec`, or neither.

| Field | Type | Description |
|---|---|---|
| `session_id` | `string` | The session this run continues. The run is appended to the session's conversation history and runs the agent version the session records. |
| `session_spec` | `SessionSpec` | A new session to create with this first message. `session_spec.agent_ref` names the agent the conversation runs (`org/slug`, with an optional tag or hash version); the created session's ID is returned on the run's `session_id`. |

**Targeting rules:**
- Provide `session_id` to continue an existing conversation.
- Provide `session_spec` with `agent_ref` to start a new conversation on an agent, at its current version unless the reference names one.
- Provide neither to start a new conversation with the built-in assistant.
- Every run is refused unless the caller may add a turn to the session (`can_create_run_in`) and may still run the session's agent (`can_execute`). An agent deleted behind the session fails the run with `FAILED_PRECONDITION` naming the agent.

### Message

| Field | Type | Validation | Description |
|---|---|---|---|
| `message` | `string` | min_len: 1 (required) | The user input that triggers this run. Each run represents one user message and the agent's full response to it. |

### Run Settings (`run_config`)

| Field | Type | Description |
|---|---|---|
| `run_config` | `RunConfig` | What this message asks for: model, speed tier, thinking, and run limits. Every field is optional; an unset field falls to the agent's defaults, then to the operator's profile for the lane. See [RunConfig Fields](#runconfig-fields) for the fields and the rule. |

Unlike a saved surface's settings, a message may set `service_tier` or `thinking_mode` without a model, to adjust the model a less specific layer chose (for example, thinking off for one message on an agent whose default turns it on). A lane that composes the turn for a surface (a schedule) writes that surface's saved `run_config` here; on a lane whose caller is a visitor (the hosted edition's shared-agent guests and channel senders), the surface's saved settings replace this field.

### Per-Message Intents

These apply to this message only and never carry over to the next one in the session. They are not settings, so no surface or agent saves them.

| Field | Type | Description |
|---|---|---|
| `interaction_mode` | `InteractionMode` | `INTERACTION_MODE_AGENT` (default): full tool access. `INTERACTION_MODE_PLAN`: read-only analysis, no file mutations. |
| `build_from_plan` | `bool` | Marks a "Build from plan" turn: the person approved a plan from an earlier Plan-mode turn and asked the agent to implement it. The runner injects the implement-plan directive, so `message` stays a short label. |
| `structured_output_schema` | `google.protobuf.Struct` | JSON Schema the agent's output must conform to. The validated data lands on `status.structured_output`. |

No request sets an approval mode: it is a fact of the lane the turn came through, recorded on `status.approval_mode`. See [hitl-approvals.md](hitl-approvals.md#unattended-surfaces-channels-and-guest-shares).

### Runtime Environment

| Field | Type | Description |
|---|---|---|
| `runtime_env` | `map<string, ExecutionValue>` | Run-scoped secrets and values. Available only for this run. Deleted when the run completes. Fills every requirement with its key ahead of every saved Credential; a key that the agent, its MCP servers and the workspace's git hosts do not declare is dropped. |

Use `runtime_env` for B2B integrations where secrets must be injected at runtime per-caller, not stored in the agent configuration.

### Approval Control

| Field | Type | Default | Description |
|---|---|---|---|
| `auto_approve_all` | `bool` | `false` | When `true`, bypasses all HITL approval gates for this run. Use in trusted CI/CD pipelines. See [hitl-approvals.md](hitl-approvals.md). |

### File Attachments

| Field | Type | Description |
|---|---|---|
| `attachments` | `repeated Attachment` | Files to inject into the agent sandbox before the run begins. See [attachments-and-artifacts.md](attachments-and-artifacts.md). |
| `workspace_file_refs` | `repeated string` | Workspace-relative paths for files already inside the session's workspace. The agent reads these directly — no upload, no injection. |

---

## Attachment Fields (`Attachment`)

Defined in `ai/stigmer/agentic/run/v1/spec.proto`.

Files must be pre-uploaded via `uploadAttachment` RPC before creating the run. The returned `storage_key` is then referenced here.

| Field | Type | Validation | Description |
|---|---|---|---|
| `filename` | `string` | min_len: 1 | Original filename. Used for display and default mount path derivation. Example: `"config.yaml"`. |
| `storage_key` | `string` | min_len: 1 | Reference to the pre-uploaded file. Obtained from `uploadAttachment` RPC. Format: `"attachments/{ulid}/{filename}"`. |
| `mount_path` | `string` | — | Path in sandbox where the file is placed. Defaults to `/inputs/{filename}` if omitted. |
| `content_type` | `string` | — | MIME type for content negotiation. Example: `"application/yaml"`, `"text/plain"`. |
| `extract` | `bool` | — | When `true`, the attachment is a ZIP archive to be extracted at `mount_path`. Set automatically by the CLI for directory attachments. |
| `local_path` | `string` | — | Absolute path on the CLI host. When set in local mode, the runner reads directly from this path instead of downloading from storage. Ignored in cloud mode. |

---

## RunConfig Fields

Defined in `ai/stigmer/agentic/run/v1/invocation.proto`. The same message is a message's request (`spec.run_config`), a surface's saved settings (a schedule's invocation, a channel, a share), an agent's defaults (`Agent.spec.run_config`, versioned with the agent), and the settings a turn ran with (`status.run_config`). Zero or empty means "not set at this layer".

| Field | Type | Description |
|---|---|---|
| `model_name` | `string` | The model, by its Model Registry id on the engine that runs it. Example: `"claude-sonnet-4.5"` (native), `"claude-sonnet-4-6"` (Cursor). |
| `max_cost_usd` | `double` | Stop the message once its estimated cost reaches this many US dollars; the work done so far is kept and the turn ends `TERMINATED`. Per message: a follow-up or a resume after an approval starts a fresh count. |
| `max_tool_rounds` | `int32` | Stop after this many model-to-tools rounds (clamped to 10–1000). Native harness only; sub-agent rounds are not counted. |
| `service_tier` | `ServiceTier` | `SERVICE_TIER_STANDARD` (the default when no layer sets it) or `SERVICE_TIER_FAST`, valid only for a model with a fast pricing tier on its engine. |
| `thinking_mode` | `ThinkingMode` | `THINKING_MODE_DISABLED` (the default when no layer sets it) or `THINKING_MODE_ENABLED`, valid only for a model the registry marks thinking-capable on its engine. |
| `max_tool_result_chars` | `int32` | Truncate a single tool result longer than this many characters, with a marker asking the agent to request specific sections. 30,000 when no layer sets it. |

**How a turn's settings are resolved.** Once, at create, from three layers, most specific first: the message (or the surface it came through), the defaults of the agent version the turn runs, and the lane's operator profile.

- **Choices** (`model_name`, `service_tier`, `thinking_mode`) come from the most specific layer that sets them. Tier and thinking come only from the model's layer or a more specific one, never from a layer whose model was replaced. With no model in any layer the engine decides (native: the registry default; Cursor: Auto).
- **Limits** (`max_cost_usd`, `max_tool_rounds`, `max_tool_result_chars`) take the smallest value any layer sets: a message or a surface can lower an agent's cap, never raise it.
- The agent's choices apply only on the engine its `harness` names; on a conversation running the other engine, the agent layer gives its limits alone.
- Saved settings are self-contained: a surface or an agent that sets `SERVICE_TIER_FAST` or `THINKING_MODE_ENABLED` names its model. Only a message may set them alone.

The proto comment on `RunConfig` is the normative rule. The user-facing explanation, with an agent example, is [Agents: Run settings](https://stigmer.ai/docs/concepts/agents#run-settings).

---

## Status Fields (`RunStatus`)

Defined in `ai/stigmer/agentic/run/v1/api.proto`. All fields are system-managed.

### Core Status

| Field | Type | Description |
|---|---|---|
| `phase` | `RunPhase` | Current lifecycle phase. See [run-lifecycle.md](run-lifecycle.md) for all phases and transitions. |
| `error` | `string` | Error message when `phase == RUN_FAILED`. Empty otherwise. |
| `started_at` | `string` | ISO 8601 timestamp when the run began processing. |
| `completed_at` | `string` | ISO 8601 timestamp when the run reached a terminal state. Empty for non-terminal phases. |
| `agent_id` | `string` | The agent this turn ran, from its session; empty for the built-in assistant. |
| `agent_version_hash` | `string` | The agent version this turn ran, from its session. |
| `declared_preferences` | `DeclaredPreferences` | The organization's and the person's standing context, snapshotted when the turn was created. |
| `recalled_memories` | `RecalledMemories` | The confirmed memories recalled into this turn, snapshotted when it was created. |
| `run_config` | `RunConfig` | The settings this turn runs with, resolved once at create from `spec.run_config` (or the surface's saved settings), the agent version's defaults and the lane's operator profile. An empty `model_name` means no layer named one and the engine chose. Server-only. |
| `approval_mode` | `ApprovalMode` | `APPROVAL_MODE_INTERACTIVE` or `APPROVAL_MODE_UNATTENDED`, a fact of the lane: schedule fires and the hosted edition's shared-agent guest and channel turns are unattended; every other turn is interactive. Server-only. |

### Messages

| Field | Type | Description |
|---|---|---|
| `messages` | `repeated AgentMessage` | Chronological stream of run events: human input, AI responses, tool results, and system notifications. |

**AgentMessage fields:**

| Field | Type | Description |
|---|---|---|
| `type` | `MessageType` | `MESSAGE_HUMAN`, `MESSAGE_AI`, `MESSAGE_TOOL`, or `MESSAGE_SYSTEM`. |
| `content` | `string` | Text content of the message. |
| `timestamp` | `string` | ISO 8601 creation timestamp. |
| `tool_calls` | `repeated ToolCall` | Tool calls associated with this AI message (only for `MESSAGE_AI` where tools were invoked). |
| `is_streaming` | `bool` | `true` while the AI is actively generating this message. Enables typing indicators in UIs. |
| `token_count` | `int32` | Total tokens consumed to generate this message. Zero until generation completes. |
| `generation_duration_ms` | `int32` | Wall-clock time in milliseconds from first token to completion. |

### Tool Calls

| Field | Type | Description |
|---|---|---|
| `tool_calls` | `repeated ToolCall` | All tool calls made during this run, tracked separately for querying and display. |

**ToolCall fields:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for this tool call. |
| `name` | `string` | Name of the tool called. |
| `args` | `google.protobuf.Struct` | Arguments passed to the tool (JSON structure). |
| `result` | `string` | Result returned by the tool. Contains partial output while `is_streaming == true`. |
| `status` | `ToolCallStatus` | `TOOL_CALL_PENDING`, `TOOL_CALL_RUNNING`, `TOOL_CALL_COMPLETED`, `TOOL_CALL_FAILED`, `TOOL_CALL_WAITING_APPROVAL`, or `TOOL_CALL_SKIPPED`. |
| `started_at` | `string` | ISO 8601 timestamp when the tool call started. |
| `completed_at` | `string` | ISO 8601 timestamp when the tool call completed or failed. |
| `error` | `string` | Error message when `status == TOOL_CALL_FAILED`. |
| `is_streaming` | `bool` | `true` while the tool is actively producing output. |
| `requires_approval` | `bool` | `true` if this tool requires user approval before execution. |
| `approval_message` | `string` | Human-readable approval prompt with resolved argument placeholders. |
| `approval_requested_at` | `string` | ISO 8601 timestamp when approval was requested. |
| `approval_decided_at` | `string` | ISO 8601 timestamp when approval decision was submitted. |
| `approved_by` | `string` | User ID of the person who made the approval decision. |
| `approval_action` | `ApprovalAction` | `APPROVAL_ACTION_APPROVE`, `APPROVAL_ACTION_SKIP`, or `APPROVAL_ACTION_REJECT`. |

### Sub-runs

| Field | Type | Description |
|---|---|---|
| `sub_agent_runs` | `repeated SubAgentRun` | Sub-agent invocations during this run, ordered chronologically. |

**SubAgentRun fields:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier, matching the tool call ID from the `task` tool invocation. |
| `name` | `string` | Name of the sub-agent invoked. |
| `input` | `string` | Task/instruction given to the sub-agent. |
| `output` | `string` | Result returned by the sub-agent. Only populated on `SUB_AGENT_COMPLETED`. |
| `status` | `SubAgentStatus` | `SUB_AGENT_PENDING`, `SUB_AGENT_IN_PROGRESS`, `SUB_AGENT_COMPLETED`, or `SUB_AGENT_FAILED`. |
| `started_at` | `string` | ISO 8601 timestamp when the sub-agent was invoked. |
| `completed_at` | `string` | ISO 8601 timestamp when the sub-agent completed or failed. |
| `error` | `string` | Error message when `status == SUB_AGENT_FAILED`. |
| `tool_calls` | `repeated ToolCall` | Tool calls made by this sub-agent, separate from main agent tool calls. |
| `messages` | `repeated AgentMessage` | AI responses and tool results from within the sub-agent's context. |
| `usage` | `UsageMetrics` | Token and LLM resource usage for this sub-agent only. |

### Todo List

| Field | Type | Description |
|---|---|---|
| `todos` | `map<string, TodoItem>` | Multi-step task tracking. Updated via the `write_todos` tool. Key: todo item ID. |

**TodoItem fields:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier for the todo item. |
| `content` | `string` | Description of the task. |
| `status` | `TodoStatus` | `TODO_PENDING`, `TODO_IN_PROGRESS`, `TODO_COMPLETED`, or `TODO_CANCELLED`. |
| `created_at` | `string` | ISO 8601 creation timestamp. |
| `updated_at` | `string` | ISO 8601 last-updated timestamp. |

### Pending Approvals

| Field | Type | Description |
|---|---|---|
| `pending_approvals` | `repeated PendingApproval` | All tool calls currently awaiting approval. Populated when `phase == RUN_WAITING_FOR_APPROVAL`. See [hitl-approvals.md](hitl-approvals.md). |

### Usage Metrics

| Field | Type | Description |
|---|---|---|
| `usage` | `UsageMetrics` | Main agent token and LLM resource usage. Does **not** include sub-agent usage. |

**UsageMetrics fields:**

| Field | Type | Description |
|---|---|---|
| `prompt_tokens` | `int32` | Total input tokens consumed across all LLM calls. |
| `completion_tokens` | `int32` | Total output tokens generated across all LLM calls. |
| `total_tokens` | `int32` | `prompt_tokens + completion_tokens`. |
| `llm_call_count` | `int32` | Number of LLM API calls made. |
| `primary_model` | `string` | Primary model used. Example: `"claude-sonnet-4.5"`. |

To calculate total run cost, sum `status.usage` with `usage` from each entry in `sub_agent_runs`.

### Context Info

| Field | Type | Description |
|---|---|---|
| `context_info` | `ContextInfo` | Context window utilization and summarization tracking: current token count, the model's context window, the summarization trigger and target (both from the model's Model Registry entry), and each summarization event. Updated progressively during streaming. |

### Artifacts

| Field | Type | Description |
|---|---|---|
| `artifacts` | `repeated RunArtifact` | Files and directories published by the agent during the run. See [attachments-and-artifacts.md](attachments-and-artifacts.md). |

---

## CLI Commands

### Triggering Runs

```bash
# Run an agent — auto-creates a session and run
stigmer run my-agent "Your message here"

# Continue an existing session
stigmer run my-agent "Follow-up message" --session ses_abc123

# Specify a model override
stigmer run my-agent "Your message" --model claude-sonnet-4.5

# Attach input files
stigmer run my-agent "Process this config" --attach ./config.yaml

# Bypass all approval gates (for automation)
stigmer run my-agent "Automated task" --auto-approve
```

### Inspecting Runs

```bash
# Get a single run by ID
stigmer runs get run_abc123

# List runs in a session
stigmer runs list --session ses_abc123

# Watch real-time streaming updates
stigmer runs logs run_abc123 --follow
```

### Lifecycle Control

```bash
# Pause a run in progress
stigmer runs pause run_abc123

# Resume a paused run
stigmer runs resume run_abc123

# Cancel gracefully
stigmer runs cancel run_abc123 --reason "Task no longer needed"

# Terminate immediately (stuck agents)
stigmer runs terminate run_abc123 --reason "Not responding to cancel"

# Recover a failed run from last checkpoint
stigmer runs recover run_abc123
```

### HITL Approvals

```bash
# Approve a pending tool call
stigmer runs approve run_abc123 --tool-call call_def789

# Skip a pending tool call
stigmer runs skip run_abc123 --tool-call-id call_def789

# Reject — fails the run
stigmer runs reject run_abc123 --tool-call-id call_def789
```

### Artifacts

```bash
# Download an artifact
stigmer download run run_abc123 --artifact generated-report
```
