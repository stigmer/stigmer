# AgentExecution Resource Guide

Complete spec and status schema reference for the `agentic.stigmer.ai/v1` AgentExecution resource.

For conceptual overview, lifecycle, and documentation index, see [README.md](README.md).

---

## Resource Structure

An AgentExecution follows the standard Stigmer resource pattern:

```
AgentExecution
├── metadata    — system-managed identity and audit fields
├── spec        — user-provided inputs (what you supply when triggering)
└── status      — system-managed outputs (what the system records during/after execution)
```

You never write `status` fields. They are populated by the agent runner and updated progressively during execution.

---

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `AgentExecution` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | User-provided execution inputs |
| `status` | No | System-managed; never set by users |

---

## Spec Fields (`AgentExecutionSpec`)

Defined in `ai/stigmer/agentic/agentexecution/v1/spec.proto`.

### Session and Agent Targeting

Either `session_id` or `agent_id` must be provided. Both are optional in the sense that you choose one path.

| Field | Type | Description |
|---|---|---|
| `session_id` | `string` | The session this execution belongs to. If provided, the execution is appended to the existing session's conversation history. |
| `agent_id` | `string` | Required when `session_id` is omitted. A new session is auto-created using the agent's default instance. |

**Targeting rules:**
- Provide `session_id` to continue an existing conversation.
- Provide `agent_id` alone to start a fresh session automatically.
- Providing both is allowed — `session_id` takes precedence.

### Message

| Field | Type | Validation | Description |
|---|---|---|---|
| `message` | `string` | min_len: 1 (required) | The user input that triggers this execution. Each execution represents one user message and the agent's full response to it. |

### Execution Config (`ExecutionConfig`)

Optional overrides for this specific execution. When not specified, defaults are derived from the agent's configuration and the Model Registry.

| Field | Type | Description |
|---|---|---|
| `execution_config.model_name` | `string` | Override the LLM model for this run. Example: `"claude-sonnet-4.5"`, `"gpt-4o"`. |
| `execution_config.context_management` | `ContextManagementConfig` | Override context window management behavior. See [context-management.md](context-management.md). |

### Runtime Environment

| Field | Type | Description |
|---|---|---|
| `runtime_env` | `map<string, ExecutionValue>` | Execution-scoped secrets and environment variables. Available only for this execution. Deleted when execution completes. Highest merge priority: Environment values (via instance `environment_refs`) < `runtime_env`. Keys must be declared in `Agent.spec.env` (a declaration whitelist, not a value source) or they are dropped. |

Use `runtime_env` for B2B integrations where secrets must be injected at runtime per-caller, not stored in the agent configuration.

### Approval Control

| Field | Type | Default | Description |
|---|---|---|---|
| `auto_approve_all` | `bool` | `false` | When `true`, bypasses all HITL approval gates for this execution. Use in trusted CI/CD pipelines. See [hitl-approvals.md](hitl-approvals.md). |

### File Attachments

| Field | Type | Description |
|---|---|---|
| `attachments` | `repeated Attachment` | Files to inject into the agent sandbox before execution begins. See [attachments-and-artifacts.md](attachments-and-artifacts.md). |
| `workspace_file_refs` | `repeated string` | Workspace-relative paths for files already inside the session's workspace. The agent reads these directly — no upload, no injection. |

### Async Workflow Integration

| Field | Type | Description |
|---|---|---|
| `callback_token` | `bytes` | Temporal task token for async activity completion. Set by automated pipeline callers (Zigflow). See [async-workflow-integration.md](async-workflow-integration.md). |
| `parent_workflow_id` | `string` | Temporal workflow ID of the calling workflow. Enables events-based approval notification — the agent signals the parent when approval is required. |

---

## Attachment Fields (`Attachment`)

Defined in `ai/stigmer/agentic/agentexecution/v1/spec.proto`.

Files must be pre-uploaded via `uploadAttachment` RPC before creating the execution. The returned `storage_key` is then referenced here.

| Field | Type | Validation | Description |
|---|---|---|---|
| `filename` | `string` | min_len: 1 | Original filename. Used for display and default mount path derivation. Example: `"config.yaml"`. |
| `storage_key` | `string` | min_len: 1 | Reference to the pre-uploaded file. Obtained from `uploadAttachment` RPC. Format: `"attachments/{ulid}/{filename}"`. |
| `mount_path` | `string` | — | Path in sandbox where the file is placed. Defaults to `/inputs/{filename}` if omitted. |
| `content_type` | `string` | — | MIME type for content negotiation. Example: `"application/yaml"`, `"text/plain"`. |
| `extract` | `bool` | — | When `true`, the attachment is a ZIP archive to be extracted at `mount_path`. Set automatically by the CLI for directory attachments. |
| `local_path` | `string` | — | Absolute path on the CLI host. When set in local mode, the runner reads directly from this path instead of downloading from storage. Ignored in cloud mode. |

---

## Context Management Config (`ContextManagementConfig`)

Defined in `ai/stigmer/agentic/agentexecution/v1/spec.proto`.

Controls automatic context summarization. Defaults are derived from the Model Registry for the configured model. See [context-management.md](context-management.md) for full documentation.

| Field | Type | Default | Description |
|---|---|---|---|
| `disable_summarization` | `bool` | `false` | When `true`, disables automatic context summarization entirely. Warning: execution may fail if context exceeds model limits. |
| `custom_trigger_threshold` | `int32` | `0` (use model default) | Token count that triggers summarization. Must be greater than `custom_target_tokens` if both are set. |
| `custom_target_tokens` | `int32` | `0` (use model default) | Target token count after summarization. Must be less than `custom_trigger_threshold` if both are set. |

---

## Status Fields (`AgentExecutionStatus`)

Defined in `ai/stigmer/agentic/agentexecution/v1/api.proto`. All fields are system-managed.

### Core Status

| Field | Type | Description |
|---|---|---|
| `phase` | `ExecutionPhase` | Current lifecycle phase. See [execution-lifecycle.md](execution-lifecycle.md) for all phases and transitions. |
| `error` | `string` | Error message when `phase == EXECUTION_FAILED`. Empty otherwise. |
| `started_at` | `string` | ISO 8601 timestamp when execution began processing. |
| `completed_at` | `string` | ISO 8601 timestamp when execution reached a terminal state. Empty for non-terminal phases. |

### Messages

| Field | Type | Description |
|---|---|---|
| `messages` | `repeated AgentMessage` | Chronological stream of execution events: human input, AI responses, tool results, and system notifications. |

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
| `tool_calls` | `repeated ToolCall` | All tool calls made during this execution, tracked separately for querying and display. |

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

### Sub-Agent Executions

| Field | Type | Description |
|---|---|---|
| `sub_agent_executions` | `repeated SubAgentExecution` | Sub-agent invocations during this execution, ordered chronologically. |

**SubAgentExecution fields:**

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
| `pending_approvals` | `repeated PendingApproval` | All tool calls currently awaiting approval. Populated when `phase == EXECUTION_WAITING_FOR_APPROVAL`. See [hitl-approvals.md](hitl-approvals.md). |

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

To calculate total execution cost, sum `status.usage` with `usage` from each entry in `sub_agent_executions`.

### Context Info

| Field | Type | Description |
|---|---|---|
| `context_info` | `ContextInfo` | Context window utilization and summarization tracking. Updated progressively during streaming. See [context-management.md](context-management.md). |

### Artifacts

| Field | Type | Description |
|---|---|---|
| `artifacts` | `repeated ExecutionArtifact` | Files and directories published by the agent during execution. See [attachments-and-artifacts.md](attachments-and-artifacts.md). |

---

## CLI Commands

### Triggering Executions

```bash
# Run an agent — auto-creates a session and execution
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

### Inspecting Executions

```bash
# Get a single execution by ID
stigmer agent execution get aex_abc123

# List executions in a session
stigmer agent execution list --session ses_abc123

# Watch real-time streaming updates
stigmer agent execution watch aex_abc123
```

### Lifecycle Control

```bash
# Pause a running execution
stigmer agent execution pause aex_abc123

# Resume a paused execution
stigmer agent execution resume aex_abc123

# Cancel gracefully
stigmer agent execution cancel aex_abc123 --reason "Task no longer needed"

# Terminate immediately (stuck agents)
stigmer agent execution terminate aex_abc123 --reason "Not responding to cancel"

# Recover a failed execution from last checkpoint
stigmer agent execution recover aex_abc123
```

### HITL Approvals

```bash
# Approve a pending tool call
stigmer agent execution approve aex_abc123 --tool-call-id call_def789

# Skip a pending tool call
stigmer agent execution skip aex_abc123 --tool-call-id call_def789

# Reject — fails the execution
stigmer agent execution reject aex_abc123 --tool-call-id call_def789
```

### Artifacts

```bash
# Download an artifact
stigmer agent execution download aex_abc123 --artifact generated-report
```
