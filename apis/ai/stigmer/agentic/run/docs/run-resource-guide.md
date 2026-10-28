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

Unlike a routine's or channel's saved settings, a message may set `service_tier` or `thinking_mode` without a model, to adjust the model a less specific layer chose (for example, thinking off for one message on an agent whose default turns it on). A lane that composes the turn for a routine writes its saved `run_config` here; on a lane whose caller is a visitor (the hosted edition's chat-link guests and Slack and WhatsApp senders), the channel's saved settings replace this field.

### Per-Message Intents

These apply to this message only and never carry over to the next one in the session. They are not settings, so no routine, channel or agent saves them.

| Field | Type | Description |
|---|---|---|
| `interaction_mode` | `InteractionMode` | `INTERACTION_MODE_AGENT` (default): full tool access. `INTERACTION_MODE_PLAN`: read-only analysis, no file mutations. |
| `build_from_plan` | `bool` | Marks a "Build from plan" turn: the person approved a plan from an earlier Plan-mode turn and asked the agent to implement it. The runner injects the implement-plan directive, so `message` stays a short label. |
| `structured_output_schema` | `google.protobuf.Struct` | JSON Schema the agent's output must conform to. The validated data is the session's `stigmer.agent.structured_output` event. |

No request sets an approval mode: it is a fact of the lane the turn came through, recorded on `status.approval_mode`. See [hitl-approvals.md](hitl-approvals.md#unattended-runs-routines-channels-and-chat-links).

### The Vaults a Turn Uses

A turn's secrets and logins come from vaults; neither a run nor a conversation carries its own, except a repository's `token`. A first turn names the conversation's vaults on `session_spec.vaults` and sets `session_spec.include_my_vault` to use the sender's My vault first; a later change is a session update. A repository's token is sealed for the conversation's life, shown as `***REDACTED***` on every read, and destroyed with the conversation. `status.credentials.person` records whose turn it was, which decides whose My vault applies.

### Approval Control

| Field | Type | Default | Description |
|---|---|---|---|
| `auto_approve_all` | `bool` | `false` | When `true`, bypasses all HITL approval gates for this run. Use in trusted CI/CD pipelines. See [hitl-approvals.md](hitl-approvals.md). |

### Files

| Field | Type | Description |
|---|---|---|
| `file_ids` | `repeated string` | Files this message carries, by id (at most 20, each once). Each must be a File of the run's organization the sender may view; the server makes it the conversation's own and lists it in the conversation's resources. `message` may be empty when files are named. See [Files](https://stigmer.ai/docs/concepts/files). |
| `workspace_file_refs` | `repeated string` | Workspace-relative paths for files already inside the session's workspace. The agent reads these directly — no upload, no injection. |

The server records the message's file blocks on `status.message_files`: an `image` block for JPEG, PNG, GIF and WebP Files, a `document` block otherwise, each naming the conversation's File.

---

## RunConfig Fields

Defined in `ai/stigmer/agentic/run/v1/invocation.proto`. The same message is a message's request (`spec.run_config`), the saved settings of a routine (its invocation) or a channel, an agent's defaults (`Agent.spec.run_config`, versioned with the agent), and the settings a turn ran with (`status.run_config`). Zero or empty means "not set at this layer".

| Field | Type | Description |
|---|---|---|
| `model_name` | `string` | The model, by its Model Registry id on the harness that runs it. Example: `"claude-sonnet-4.5"`. |
| `max_cost_usd` | `double` | Stop the message once its estimated cost reaches this many US dollars; the work done so far is kept and the turn ends `TERMINATED`. Per message: a follow-up or a resume after an approval starts a fresh count. |
| `max_tool_rounds` | `int32` | Stop after this many model-to-tools rounds (clamped to 10–1000). Stigmer harness only; subagent rounds are not counted. |
| `service_tier` | `ServiceTier` | `SERVICE_TIER_STANDARD` (the default when no layer sets it) or `SERVICE_TIER_FAST`, valid only for a model with a fast pricing tier on its harness. |
| `thinking_mode` | `ThinkingMode` | `THINKING_MODE_DISABLED` (the default when no layer sets it) or `THINKING_MODE_ENABLED`, valid only for a model the registry marks thinking-capable on its harness. |
| `max_tool_result_chars` | `int32` | Cut a single tool result longer than this many characters to its start and its end. The whole result is kept for the session, outside the workspace, where the agent can read it back; a tool that pages itself (reading a file, searching, listing, fetching a page) is read again a window at a time instead. Above 80,000 it raises the bound only for the file tools. 30,000 when no layer sets it. |

**How a turn's settings are resolved.** Once, at create, from three layers, most specific first: the message (or the routine or channel it came through), the defaults of the agent version the turn runs, and the lane's operator profile.

- **Choices** (`model_name`, `service_tier`, `thinking_mode`) come from the most specific layer that sets them. Tier and thinking come only from the model's layer or a more specific one, never from a layer whose model was replaced. With no model in any layer the run uses its harness's registry default.
- **Limits** (`max_cost_usd`, `max_tool_rounds`, `max_tool_result_chars`) take the smallest value any layer sets: a message, routine or channel can lower an agent's cap, never raise it.
- The agent's choices apply only on the harness its `harness` names; on a conversation running another harness, the agent layer gives its limits alone.
- Saved settings are self-contained: a routine, channel or agent that sets `SERVICE_TIER_FAST` or `THINKING_MODE_ENABLED` names its model. Only a message may set them alone.

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
| `run_config` | `RunConfig` | The settings this turn runs with, resolved once at create from `spec.run_config` (or the routine's or channel's saved settings), the agent version's defaults and the lane's operator profile. An empty `model_name` means no layer named one and the harness chose. Server-only. |
| `approval_mode` | `ApprovalMode` | `APPROVAL_MODE_INTERACTIVE` or `APPROVAL_MODE_UNATTENDED`, a fact of the lane: routine fires and the hosted edition's shared-agent guest and channel turns are unattended; every other turn is interactive. Server-only. |
| `stop_cause` | `string` | Why the turn stopped, as one word (`budget_reached`, `timeout`, `infrastructure`, `platform_stop`, `user`, `model_error`, `failed`, `eval_stopped`, `review_resolved`). Empty while the turn works and when it ended on its own. See [run-lifecycle.md](run-lifecycle.md). |

### The Conversation

A run's status carries no transcript. The agent's messages and thinking, its tool calls and their results, the approvals it waited on and their answers, its todos, its subagents' threads, its structured output, the memories it recalled and every file-review decision are events in the session's log. Each event names the run it belongs to (`run_id`) and the thread that produced it; read them with the session's `listEvents` (filtered by run) or follow them with `streamEvents`. See the [Session docs](../../session/docs/README.md).

### File Record

| Field | Type | Description |
|---|---|---|
| `file_changes` | `repeated FileChangeSet` | The change sets this run's turns captured, in a session with file review on. Empty for a run that changed no file or ran without file review. A record only: it carries no status and no decisions. What was kept, what was undone and what is still undecided are the session's `stigmer.file_review.*` events. |

**FileChangeSet fields** (defined in `ai/stigmer/agentic/run/v1/filereview.proto`):

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable id of the change set, unique per turn; the id the session's `stigmer.file_review.*` events name. |
| `turn_id` | `string` | The turn that produced the change set. |
| `harness_id` | `string` | The harness that made the edits: `deep-agent` (Stigmer) or `claude` (Claude Agent). |
| `baseline_snapshot` | `SnapshotRef` | Workspace state at turn start, the "before" of the diff. |
| `candidate_snapshot` | `SnapshotRef` | Workspace state at the turn boundary, the "after". The diff is computed between the two snapshots. |
| `changes` | `repeated CapturedFileChange` | One entry per file: `path_before`, `path_after`, `kind`, the contents `before` and `after` (inline, or by storage key when large), their SHA-256 digests, the `unified_diff`, whether the diff is complete, and lines added and removed. |
| `aggregate_digest` | `string` | Digest over the ordered changes. Enforcement only: putting files back refuses content that differs from what was reviewed. |
| `diff_completeness` | `DiffCompleteness` | Whether the set's diff is complete enough to keep in one step. |
| `command_provenance` | `TurnCommandProvenance` | The consent the turn's commands ran under, when every change came from a command a person allowed: the tool call ids whose answers in the session's log authorized them, or `authorized_by_auto_approve_all`. |

While a turn works, `file_change_progress` shows a running count of the files it has changed so far (paths, kinds and line counts only); it is cleared once the turn's change set is on `file_changes`.

### Usage

| Field | Type | Description |
|---|---|---|
| `streaming_usage` | `StreamingUsageSummary` | Tokens (input, output, cache read and write), turn count, the model requested and the estimated cost in USD, updated as the run works. Display only: the metered record of each model call is `LlmCallUsageRecord`, which the usage report RPCs read. |

### Files the run returned

What the agent saved in its outputs folder comes back as Files, listed by their `run_id` (`stigmer download run` writes them out). They are not a status field.

---

## CLI Commands

### Triggering Runs

```bash
# Run an agent: creates a session and its first run
stigmer run my-agent -m "Your message here"

# Choose the model for this message
stigmer run my-agent -m "Your message" --model claude-sonnet-4.5

# Attach input files
stigmer run my-agent -m "Process this config" --attach ./config.yaml

# Bypass all approval gates (for automation)
stigmer run my-agent -m "Automated task" --auto-approve

# Reopen an existing session and continue the conversation
stigmer resume ses_abc123
```

### Inspecting Runs

```bash
# Get a single run by ID
stigmer get run run_abc123

# List runs
stigmer list run

# Print a run's events from the session's log; --follow streams them
stigmer runs logs run_abc123 --follow
```

### Lifecycle Control

```bash
# Pause a run in progress
stigmer runs pause run_abc123

# Resume a paused run
stigmer runs resume run_abc123

# Interrupt the run's session: every unfinished turn stops
stigmer runs cancel run_abc123

# Terminate immediately (stuck agents)
stigmer runs terminate run_abc123 --reason "Not responding to interrupt"
```

Recovering a failed run is the `recover` RPC; the CLI has no command for it.

### HITL Approvals

```bash
# Allow a waiting tool call (the tool use id runs logs shows)
stigmer runs approve run_abc123 --tool-call <tool-use-id>

# Deny it; the agent reads the comment and the run continues
stigmer runs approve run_abc123 --tool-call <tool-use-id> --action deny --comment "Not this one"

# Allow it and every waiting call of its class for the rest of the turn
stigmer runs approve run_abc123 --tool-call <tool-use-id> --action allow-all
```

### Outputs

```bash
# Download every output the run saved in .stigmer/outputs/
stigmer download run run_abc123

# Download one output, by its path in the outputs folder
stigmer download run run_abc123 --path reports/summary.md
```
