# Human-in-the-Loop (HITL) Approvals

How AgentExecution gates destructive tool calls behind human approval — approve, skip, or reject per tool.

---

## What Is HITL?

Human-in-the-Loop (HITL) is an approval mechanism that pauses an execution before a specific tool call executes and waits for a human decision. It prevents autonomous agents from taking irreversible actions — deleting repositories, sending emails, force-pushing branches — without explicit user consent.

When an agent is about to invoke a tool that requires approval:

1. The tool call's status changes to `TOOL_CALL_WAITING_APPROVAL`
2. The execution phase changes to `EXECUTION_WAITING_FOR_APPROVAL`
3. `status.pending_approvals` is populated with details of every tool awaiting a decision
4. Execution pauses — no further processing occurs
5. A human submits a decision via the `submitApproval` RPC
6. Once all pending approvals have decisions, execution resumes

---

## Configuring Approval Policies

Approval policies are configured on the **Agent** (not on the AgentExecution). They are part of `spec.mcp_server_usages[].tool_approval_overrides`.

```yaml
# In your Agent YAML (not AgentExecution)
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.repository}}"
        - tool_name: force_push
          requires_approval: true
          message: "Force push to branch: {{args.branch}} in {{args.repository}}"
        - tool_name: search_code
          requires_approval: false  # explicitly disable approval for this tool
```

### Approval Policy Chain

Policies resolve in order of increasing priority:

| Priority | Source | Description |
|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | Platform or org defaults set on the MCP server resource |
| 2 | `Agent.McpServerUsage.tool_approval_overrides` | Per-agent overrides — can enable or disable approval for specific tools |
| 3 (highest) | `AgentExecution.auto_approve_all` | Runtime bypass — when `true`, all approval gates are skipped for this execution |

Each layer overrides the one below it. An agent can require approval for a tool even if the platform default says it does not, and a specific execution can bypass all approvals entirely.

---

## The Approval Flow

### Single Tool Approval

When one tool requires approval:

```
Agent is IN_PROGRESS
    │
    ├── Agent calls delete_repository(repository="acme/important-repo")
    │
    ├── delete_repository.requires_approval = true
    │
    ├── ToolCall.status → TOOL_CALL_WAITING_APPROVAL
    ├── AgentExecution.status.phase → EXECUTION_WAITING_FOR_APPROVAL
    ├── status.pending_approvals populated with:
    │   - tool_call_id: "call_abc123"
    │   - tool_name: "delete_repository"
    │   - message: "Delete repository: acme/important-repo"
    │   - args_preview: {"repository": "acme/important-repo"}
    │   - requested_at: "2026-02-28T10:00:00Z"
    │
    └── Human submits decision via submitApproval RPC
```

### Batch Approval (Multiple Tools)

When the LLM returns multiple tool calls in a single response and more than one requires approval, LangGraph creates one interrupt per tool. All are surfaced simultaneously in `status.pending_approvals`.

The agent runner resumes the graph only after **all** pending approvals have decisions. This avoids repeated node re-execution and idempotency risks from resuming one tool at a time.

```
Agent calls tools A, B, C in one LLM response.
Tools A and C require approval. Tool B does not.

status.pending_approvals = [
  { tool_call_id: "call_A", tool_name: "delete_repo", interrupt_id: "intr_1" },
  { tool_call_id: "call_C", tool_name: "send_email",  interrupt_id: "intr_2" }
]

Human submits:
  submitApproval(tool_call_id: "call_A", action: APPROVE)
  submitApproval(tool_call_id: "call_C", action: SKIP)

All decisions collected → graph resumes with both decisions in one Command.
```

---

## PendingApproval Fields

Each entry in `status.pending_approvals` is a `PendingApproval` message:

| Field | Type | Description |
|---|---|---|
| `tool_call_id` | `string` | ID of the tool call awaiting approval. Pass this to `submitApproval`. |
| `tool_name` | `string` | Name of the tool. Example: `"delete_repository"`. |
| `message` | `string` | Human-readable approval prompt with resolved argument placeholders. |
| `args_preview` | `string` | Sanitized JSON preview of tool arguments. Sensitive values are redacted. |
| `requested_at` | `string` | ISO 8601 timestamp when approval was requested. |
| `from_sub_agent` | `bool` | `true` if this approval originates from a sub-agent tool call. |
| `sub_agent_name` | `string` | Name of the sub-agent when `from_sub_agent == true`. |
| `interrupt_id` | `string` | LangGraph interrupt ID for targeted resume. Used internally — do not modify. |
| `child_agent_execution_id` | `string` | Set when this `PendingApproval` is surfaced at a `WorkflowExecution` level, enabling approval forwarding. |

---

## Submitting a Decision

Call the `submitApproval` RPC with the execution ID, the tool call ID, and your decision.

```bash
# Approve — tool executes normally
stigmer agent execution approve aex_abc123 \
  --tool-call-id call_abc123 \
  --comment "Verified the target repository is safe to delete"

# Skip — tool is skipped, LLM adapts its plan
stigmer agent execution skip aex_abc123 \
  --tool-call-id call_abc123 \
  --comment "Will handle this operation manually"

# Reject — execution fails immediately
stigmer agent execution reject aex_abc123 \
  --tool-call-id call_abc123 \
  --comment "Wrong repository — this looks like a mistake"
```

### Four Possible Decisions

| Decision | `ApprovalAction` | Effect on ToolCall | Effect on Execution |
|---|---|---|---|
| Approve | `APPROVAL_ACTION_APPROVE` | `TOOL_CALL_RUNNING` → `TOOL_CALL_COMPLETED` | Phase returns to `EXECUTION_IN_PROGRESS` |
| Skip | `APPROVAL_ACTION_SKIP` | `TOOL_CALL_SKIPPED` (terminal) | Phase returns to `EXECUTION_IN_PROGRESS`. LLM receives: "Tool was skipped by user." |
| Reject | `APPROVAL_ACTION_REJECT` | Stays in `TOOL_CALL_WAITING_APPROVAL` | Phase transitions to `EXECUTION_FAILED` |
| Approve all | `APPROVAL_ACTION_APPROVE_ALL` | `TOOL_CALL_RUNNING` → `TOOL_CALL_COMPLETED`; every co-pending tool resolves to APPROVE | Phase returns to `EXECUTION_IN_PROGRESS`; the rest of this execution runs un-gated |

**On Skip:** The LLM receives a message: `"Tool '{name}' was skipped by user. Please proceed without this operation."` This allows the agent to adapt its plan and continue execution without the skipped tool's result.

**On Reject:** The entire execution fails immediately. The rejection error message (from the optional `comment`) is stored in `status.error`.

**On Approve all ("approve and don't ask again"):** The clicked tool is approved, and every other tool call currently in `TOOL_CALL_WAITING_APPROVAL` is resolved to APPROVE so the gate clears in one action. For the remainder of this execution, new tool calls (including sub-agent tool calls) skip the approval gate entirely — the gate-time equivalent of `auto_approve_all`. The scope is the current execution only; it is not persisted to the session or agent. Interactive clients may carry a session-scoped preference forward in-memory (reset on reload), but the server persists no such state.

---

## Audit Trail

Every approval decision is recorded in the `ToolCall` fields:

| Field | Description |
|---|---|
| `approval_requested_at` | When approval was requested |
| `approval_decided_at` | When the decision was submitted |
| `approved_by` | User ID who made the decision (from authentication context) |
| `approval_action` | The action taken (APPROVE, SKIP, REJECT, APPROVE_ALL) |

When a user chooses **Approve all**, the co-pending tool calls that are auto-resolved carry `approval_action = APPROVAL_ACTION_APPROVE`, while the tool the user actually clicked carries `APPROVAL_ACTION_APPROVE_ALL`. This keeps the trail honest: every executed tool shows an explicit decision, and the single APPROVE_ALL entry marks where the user opted into trusting the rest of the run.

This provides a complete audit trail: who approved or rejected what tool call, when, and on which execution.

---

## Bypassing Approvals for Automation

For CI/CD pipelines and trusted batch jobs where human approval is impractical, set `auto_approve_all: true` in the `AgentExecutionSpec`:

```yaml
spec:
  agent_id: agt_abc123
  message: "Run automated deployment"
  auto_approve_all: true
```

Or via CLI:

```bash
stigmer run my-agent "Run automated deployment" --auto-approve
```

`auto_approve_all` is the highest-priority override in the policy chain. When set, all tools that would normally pause for approval execute immediately without waiting.

**Security considerations:**
- Restrict access to `auto_approve_all` with appropriate IAM policies
- Audit executions where this flag is used — they bypass all approval safeguards
- Do not use in user-facing interactive sessions

---

## Sub-Agent Approvals

When a sub-agent's tool requires approval, the approval is surfaced in the **parent** AgentExecution's `status.pending_approvals`, with `from_sub_agent: true` and the sub-agent's name in `sub_agent_name`.

This allows a single approval UI to handle both parent and sub-agent approvals uniformly. The user does not need to know where in the agent hierarchy the approval originates.

```
PendingApproval {
  tool_call_id: "call_xyz"
  tool_name: "delete_file"
  message: "Delete file: /workspace/important.config"
  from_sub_agent: true
  sub_agent_name: "code-editor"
}
```

---

## Approval Timeout

Stigmer does not automatically reject pending approvals after a timeout — executions remain in `EXECUTION_WAITING_FOR_APPROVAL` indefinitely until a decision is submitted. This is intentional: approval requests may legitimately wait for hours while reviewers are offline.

To enforce a timeout in your workflows, implement external monitoring and call `reject` (or `cancel`) if the approval exceeds your acceptable wait window.
