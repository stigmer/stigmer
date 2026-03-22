# What is an Agent Execution?

## One-Sentence Positioning

**An Agent Execution is a single, observable, controllable run of an agent—the same way `docker run` is a single, observable, controllable instance of a container image.**

---

## Executive Summary

An AgentExecution is Stigmer's runtime record for one user message and its agent response. When you send a message to an agent, Stigmer creates an AgentExecution that captures everything about that run: the input message, the AI responses streamed back, every tool call made, every sub-agent invoked, and the final outcome.

AgentExecution sits at the bottom of the four-layer stack:

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

The Agent is the *blueprint*. The AgentExecution is the *evidence*—a durable, queryable record of exactly what happened. Each execution has a lifecycle (pending → in-progress → completed), full tool call audit trails, and control operations: pause, resume, cancel, terminate, and recover from failure.

Two features distinguish AgentExecution from a simple API call:

1. **Human-in-the-Loop (HITL) approvals**: An execution can pause mid-run and wait for a human to approve, skip, or reject a specific tool call before continuing.
2. **Checkpoint-based lifecycle control**: Executions can be paused and resumed from the exact point they were stopped. Failed executions can be recovered without re-executing completed work.

---

## The Problem Agent Execution Solves

### AI Calls Are Black Boxes

A typical LLM API call gives you a response and nothing else. There is no record of which tools were called, in what order, with what arguments, and what they returned. There is no way to stop a long-running call mid-way, review its progress, or let a human approve a dangerous action before it executes.

**What goes wrong at scale:**

- A long-running agent deletes the wrong resource. You have no record of which tool call caused it, what arguments were passed, or who triggered the execution.
- An agent hits a transient error halfway through a ten-step task. You restart from scratch and pay the full cost again.
- An agent is about to send an email to all customers. There is no mechanism to pause and ask "are you sure?" before it does.
- An automated pipeline invokes an agent. When the agent finishes—minutes or hours later—there is no clean way for the pipeline to know.

### AgentExecution as the Answer

AgentExecution wraps every agent run in a durable, observable envelope:

- Every tool call is recorded with its arguments, result, start time, and end time.
- Every AI message is stored and streamable in real time.
- Every run can be paused, resumed, cancelled, force-terminated, or recovered from failure—without losing completed work.
- Every destructive tool call can be gated behind a human approval checkpoint.
- Automated pipelines can hand off to an agent and be notified when it completes—without polling.

---

## The AgentExecution Resource

AgentExecution follows the standard Stigmer resource pattern: a `spec` that contains what you provide, and a `status` that contains what the system produces.

### The Spec: What You Provide

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentExecution
metadata:
  name: review-run-1
  org: acme-corp
spec:
  # Provide either session_id or agent_id (not both required).
  # If session_id is omitted, agent_id is required — a new session
  # is auto-created using the agent's default instance.
  agent_id: agt_abc123

  # The user message that triggers this execution.
  message: "Review the latest PR in acme/backend and flag any security issues"

  # Optional: override the model for this execution.
  execution_config:
    model_name: "claude-sonnet-4.5"

  # Optional: auto-approve all tool calls that would normally require
  # human approval. Use in CI/CD pipelines or trusted batch jobs.
  auto_approve_all: false

  # Optional: attach files for the agent to read.
  attachments:
    - filename: "spec.yaml"
      storage_key: "attachments/01HGXXX.../spec.yaml"
      mount_path: "/inputs/spec.yaml"
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `session_id` | Either/or | The session this execution belongs to. |
| `agent_id` | Either/or | If `session_id` is omitted, a new session is auto-created from this agent. |
| `message` | Yes | The user input that triggers this execution. |
| `execution_config.model_name` | No | Override the LLM model for this specific run. |
| `execution_config.context_management` | No | Configure or disable automatic context summarization. |
| `runtime_env` | No | Execution-scoped secrets and environment variables. Deleted when execution completes. |
| `auto_approve_all` | No | Skip all tool approval gates for this execution. Default: `false`. |
| `attachments` | No | Files to inject into the agent sandbox before execution. |
| `workspace_file_refs` | No | Paths to files already in the session workspace. The agent reads these directly—no upload needed. |

### The Status: What the System Produces

Everything Stigmer records during and after execution lives in `status`. You never set `status` fields—they are system-managed.

```yaml
status:
  phase: EXECUTION_COMPLETED

  messages:
    - type: MESSAGE_HUMAN
      content: "Review the latest PR..."
      timestamp: "2026-02-28T10:00:00Z"
    - type: MESSAGE_AI
      content: "I'll review the PR now. Let me start by fetching it."
      timestamp: "2026-02-28T10:00:01Z"
    - type: MESSAGE_AI
      content: "Found 3 issues: ..."
      timestamp: "2026-02-28T10:00:45Z"

  tool_calls:
    - id: "call_abc123"
      name: "get_pull_request"
      args: { "repo": "acme/backend", "pr_number": 42 }
      status: TOOL_CALL_COMPLETED
      started_at: "2026-02-28T10:00:02Z"
      completed_at: "2026-02-28T10:00:05Z"

  started_at: "2026-02-28T10:00:00Z"
  completed_at: "2026-02-28T10:00:45Z"

  usage:
    prompt_tokens: 12450
    completion_tokens: 890
    total_tokens: 13340
    llm_call_count: 3
    primary_model: "claude-sonnet-4.5"
```

---

## Execution Lifecycle: The Phase State Machine

Every AgentExecution moves through a defined set of phases. Understanding the state machine tells you exactly what you can do at each phase.

```
                    ┌─────────────────────────────────────────┐
                    │            EXECUTION_PENDING             │
                    │  (created, waiting to start processing)  │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │           EXECUTION_IN_PROGRESS          │ ◄──────────┐
                    │  (agent is actively processing message)  │            │
                    └──┬──────────┬──────────┬────────────────┘            │
                       │          │          │                              │
              pause()  │          │          │  tool needs approval         │ resume()
                       │          │  cancel()│                              │
                       ▼          │          ▼                              │
          ┌────────────────────┐  │  ┌──────────────────────────┐         │
          │  EXECUTION_PAUSED  │  │  │ EXECUTION_WAITING_FOR_   │         │
          │  (checkpoint saved,│  │  │ APPROVAL                 │ ────────┘
          │  can be resumed)   │  │  │ (paused for HITL gate)   │  approve()/skip()
          └────────────────────┘  │  └──────────────────────────┘
                                  │            │
                          terminate()│          │ reject()
                                  │            ▼
                                  │  ┌──────────────────────────┐
                                  │  │    EXECUTION_FAILED      │
                                  │  │  (error or rejection)    │
                                  │  └──────────────────────────┘
                                  │            │
                                  │            │ recover()
                                  │            ▼
                                  │  (back to IN_PROGRESS, from checkpoint)
                                  │
                                  ▼
                    ┌─────────────────────────────────────────┐
                    │          EXECUTION_CANCELLED             │
                    │  (graceful stop, checkpoint preserved)  │
                    └─────────────────────────────────────────┘

          ┌─────────────────────────────────────────────────────┐
          │             EXECUTION_TERMINATED                     │
          │   (force-killed, no checkpoint, unresponsive agents) │
          └─────────────────────────────────────────────────────┘

          ┌─────────────────────────────────────────────────────┐
          │             EXECUTION_COMPLETED                      │
          │     (agent finished successfully, terminal)          │
          └─────────────────────────────────────────────────────┘
```

**Phase reference:**

| Phase | Terminal? | Description |
|---|---|---|
| `EXECUTION_PENDING` | No | Created, waiting to start. |
| `EXECUTION_IN_PROGRESS` | No | Agent is actively processing. |
| `EXECUTION_WAITING_FOR_APPROVAL` | No | Paused at a HITL gate. Waiting for human decision. |
| `EXECUTION_PAUSED` | No | Temporarily stopped. Checkpoint saved. Can be resumed. |
| `EXECUTION_COMPLETED` | Yes | Agent finished successfully. |
| `EXECUTION_FAILED` | Yes | Agent encountered an error. Can be recovered (if not terminated). |
| `EXECUTION_CANCELLED` | Yes | Stopped gracefully by user. Checkpoint preserved. |
| `EXECUTION_TERMINATED` | Yes | Force-killed immediately. No checkpoint. Cannot be recovered. |

---

## Lifecycle Control

You have full control over a running execution through dedicated operations. Each maps to a distinct Temporal workflow control signal.

### Cancel — Graceful Stop

Stop an in-progress execution. The agent receives the cancellation signal, saves its LangGraph checkpoint, and transitions to `CANCELLED`. Use this when you want a controlled shutdown.

```bash
stigmer agent execution cancel aex_abc123 --reason "Task no longer needed"
```

- **Precondition**: `PENDING` or `IN_PROGRESS`
- **Checkpoint**: Preserved
- **Recovery**: Not possible (terminal state)

### Terminate — Force Kill

Immediately stop an execution without allowing cleanup. The agent receives no signal—the workflow is killed. Use this only for stuck or unresponsive agents that ignore cancellation.

```bash
stigmer agent execution terminate aex_abc123 --reason "Stuck for 30 min, not responding to cancel"
```

- **Precondition**: `PENDING` or `IN_PROGRESS`
- **Checkpoint**: May be incomplete
- **Recovery**: Not possible

**Cancel vs. Terminate:**

| Aspect | `cancel` | `terminate` |
|---|---|---|
| Signal sent to agent | Yes | No |
| Agent can clean up | Yes | No |
| Checkpoint saved | Yes (graceful) | No |
| Use case | Normal stop | Stuck/unresponsive |
| Recoverable? | No | No |

### Pause / Resume — Temporary Stop

Pause a running execution at its current checkpoint. Unlike cancel, `PAUSED` is not terminal—the execution can be resumed later from exactly where it stopped. No resources are consumed while paused.

```bash
stigmer agent execution pause aex_abc123 --reason "Pausing to review progress"
stigmer agent execution resume aex_abc123
```

**Pause vs. Cancel:**

| Aspect | `pause` | `cancel` |
|---|---|---|
| Terminal state? | No | Yes |
| Can resume? | Yes | No |
| Checkpoint saved? | Yes | Best-effort |
| Use case | Temporary stop | Permanent stop |

### Recover — Restart from Failure

Resume a `FAILED` execution from its last checkpoint. Completed work is preserved—successful tool calls are not re-executed. Use this after a transient failure (network timeout, rate limit, external API down).

```bash
stigmer agent execution recover aex_abc123
```

- **Precondition**: `EXECUTION_FAILED` only
- **`TERMINATED` cannot be recovered** (incomplete checkpoint)
- **`CANCELLED` cannot be recovered** (intentional user action)

---

## Human-in-the-Loop (HITL) Approvals

Some tool calls are too consequential to run automatically. AgentExecution has a built-in approval gate: when a tool configured with `requires_approval: true` is about to execute, the execution enters `EXECUTION_WAITING_FOR_APPROVAL` and waits.

The approval gate is configured on the Agent spec:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp
        slug: github
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.repository}}"
        - tool_name: force_push
          requires_approval: true
          message: "Force push to branch: {{args.branch}}"
```

When the agent reaches `delete_repository`, the execution pauses. The `status.pending_approvals` field is populated with the tool name, the resolved message ("Delete repository: acme/important-repo"), and a sanitized preview of the arguments. A human submits a decision.

**Three possible decisions:**

| Decision | Effect |
|---|---|
| `APPROVE` | Tool executes normally. Execution returns to `IN_PROGRESS`. |
| `SKIP` | Tool is skipped. The LLM receives "Tool was skipped by user" and adapts its plan. Execution continues. |
| `REJECT` | Execution fails immediately. Phase transitions to `EXECUTION_FAILED`. |

```bash
# Approve a pending tool call
stigmer agent execution approve aex_abc123 --tool-call-id call_def789 --comment "Verified safe target"

# Skip a tool call
stigmer agent execution skip aex_abc123 --tool-call-id call_def789 --comment "Will handle manually"

# Reject and fail the execution
stigmer agent execution reject aex_abc123 --tool-call-id call_def789 --comment "Wrong repository"
```

**Bypassing approvals for automation:**

For CI/CD pipelines and trusted batch jobs where human approval is not practical, set `auto_approve_all: true` in the spec:

```yaml
spec:
  auto_approve_all: true
```

This bypasses all approval gates for the execution. Ensure appropriate access controls on who can set this flag and audit executions where it is used.

---

## File Attachments and Artifacts

### Attachments — Input Files

Attach files to an execution before it starts. The agent can read these from the sandbox at the specified mount paths.

```bash
# Attach a file via the CLI
stigmer run my-agent "Process this config" --attach ./config.yaml
```

The CLI uploads the file first (`uploadAttachment` RPC), receives a `storage_key`, and passes it in the execution spec:

```yaml
spec:
  attachments:
    - filename: "config.yaml"
      storage_key: "attachments/01HGXXX.../config.yaml"
      mount_path: "/inputs/config.yaml"
      content_type: "application/yaml"
```

For files that already exist inside the session's workspace, the CLI skips the upload entirely and records a `workspace_file_ref` instead—the agent reads the file directly from the workspace filesystem.

### Artifacts — Output Files

An agent can publish files or directories for users to download. When the agent calls the `publish_artifact` tool, Stigmer stores the file in artifact storage and populates `status.artifacts` with a pre-signed download URL.

```bash
# Download an artifact produced by an execution
stigmer agent execution download aex_abc123 --artifact generated-report
```

Artifacts are stored for 7 days. If a URL expires, fetch a fresh one with `getArtifactDownloadUrl`.

---

## Context Management

Long-running conversations can approach the LLM's context window limit. AgentExecution handles this automatically through context summarization: when token usage exceeds a threshold (~90% of the model's context window), Stigmer uses a lightweight economy model to summarize older conversation history and reduce context to a target size (~80%).

Summarization is transparent to the agent—it continues from the summary without interruption.

**Override context management per execution:**

```yaml
spec:
  execution_config:
    model_name: "claude-sonnet-4.5"
    context_management:
      # Disable summarization entirely (risk: execution may fail at context limit)
      disable_summarization: true

      # Or: custom thresholds (in tokens)
      custom_trigger_threshold: 100000
      custom_target_tokens: 80000
```

The execution status tracks context health in real time:

```yaml
status:
  context_info:
    current_token_count: 45230
    context_window_limit: 200000
    utilization_percent: 22.6
    summarization_enabled: true
    summarization_trigger_threshold: 180000
    summarization_target_tokens: 160000
    summarization_events: []   # populated if summarization was triggered
```

**Health thresholds for UIs:**
- 0–70%: Healthy
- 70–90%: Approaching threshold
- 90–100%: At or above trigger

---

## Usage Metrics

Every execution tracks token consumption and LLM call counts for cost visibility:

```yaml
status:
  usage:
    prompt_tokens: 12450
    completion_tokens: 890
    total_tokens: 13340
    llm_call_count: 3
    primary_model: "claude-sonnet-4.5"
```

Sub-agent usage is tracked separately on each `sub_agent_executions[]` entry. To calculate total execution cost, sum `status.usage` with the `usage` field from each sub-agent execution.

---

## Resolved Execution Context

Before streaming begins, Stigmer captures a snapshot of everything the agent has access to in `status.resolved_context`. This provides transparency into what was available at runtime:

```yaml
status:
  resolved_context:
    # Keys only — values are never included (security)
    environment_keys:
      - GITHUB_TOKEN
      - SLACK_WEBHOOK_URL

    # MCP servers and whether they resolved successfully
    mcp_servers:
      github-mcp:
        resolved: true
        enabled_tool_count: 5
        message: "Configured successfully"
      slack-mcp:
        resolved: false
        message: "Missing required environment variable: SLACK_WEBHOOK_URL"

    # Skills injected into the agent's system prompt
    skill_names:
      - code-review
      - security-checklist
```

Use this field to debug why a tool was unavailable or to audit what resources an execution consumed.

---

## Getting Started

```bash
# Run an agent — auto-creates a session and an execution
stigmer run my-agent "Review the latest PR and flag security issues"

# Run within an existing session (maintains conversation context)
stigmer run my-agent "Now check the dependencies too" --session ses_abc123

# Attach input files
stigmer run my-agent "Process this config" --attach ./config.yaml

# List executions in a session
stigmer agent execution list --session ses_abc123

# Watch a running execution in real time
stigmer agent execution watch aex_abc123

# Control a running execution
stigmer agent execution pause aex_abc123
stigmer agent execution resume aex_abc123
stigmer agent execution cancel aex_abc123

# Recover a failed execution from its last checkpoint
stigmer agent execution recover aex_abc123
```

---

## How It Compares

| Without AgentExecution | With AgentExecution |
|---|---|
| LLM responses vanish after the call | Every message, tool call, and result stored and queryable |
| No way to stop a long-running agent | Cancel (graceful), terminate (immediate), or pause/resume |
| Transient failures restart from scratch | Recover from last checkpoint — completed work is preserved |
| Dangerous tool calls execute without review | HITL approval gates — approve, skip, or reject per tool |
| No visibility into what environment the agent had | `resolved_context` shows every MCP server, env key, and skill |
| Token costs invisible until the bill arrives | `usage` metrics updated in real time per execution |
| Automated pipelines poll for completion | Async token handshake — pipeline is notified on completion |

---

## Further Reading

- [Agent Resource Guide](../../apis/ai/stigmer/agentic/agent/docs/agent-resource-guide.md) — The blueprint that AgentExecution runs
- [What is an Agent?](./what-is-agent.md) — The four-layer stack: Agent → AgentInstance → Session → AgentExecution
- [MCP Server Integration](../../apis/ai/stigmer/agentic/agent/docs/mcp-server-integration.md) — Tool access and approval policy configuration
- [Agent Execution Lifecycle](../architecture/agent-execution-lifecycle.md) — Phases, pause/resume/cancel, checkpoint preservation
- [How to Provide Secrets](./how-to-provide-secrets.md) — Choosing between the Environment Flow (persistent) and the Execution Flow (ephemeral `runtime_env`)
