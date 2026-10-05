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

## What Asks for Approval

By default there is nothing to configure. Stigmer asks before:

- shell commands;
- file writes and deletes;
- any MCP tool whose server marks it destructive (`destructiveHint: true` in the tool's MCP annotations, recorded at connect on `DiscoveredTool.destructive_hint`).

Nothing else asks. An MCP tool's approval card reads `Execute <tool>`.

To keep an agent away from a tool rather than asking about it, leave the tool out with the agent's `tools` and `disallowed_tools` lists (see the Agent resource's `mcp-server-integration.md`). The lists hold under every bypass below: a run that approves everything still cannot call a tool its lists exclude.

An agent's hooks also decide which tools ask (`AgentSpec.hooks`, a plugin's hooks or a block written in the agent, in Claude Code's format). Before a call runs, a `PreToolUse` hook can refuse it, ask a person first, or let it run; whichever it answers replaces the default for that call. A hook that gives no answer leaves the call to the default. When several hooks answer, a refusal wins over an ask, and an ask over an allow. The native engine runs hooks; the Cursor engine refuses a turn whose agent has hooks. Hooks are the agent author's policy: a hook that lets a call run skips the approval the default would have asked of whoever runs the agent, so an agent shared with others carries that choice to them.

`AgentExecution.auto_approve_all`, a lease, and the unattended mode decide only how a required approval is resolved, never which tools ask. None of them opens a call a hook refuses.

---

## The Approval Flow

### Single Tool Approval

When one tool requires approval:

```
Agent is IN_PROGRESS
    │
    ├── Agent calls delete_repository(repository="acme/important-repo")
    │
    ├── the github server marks delete_repository destructive
    │
    ├── ToolCall.status → TOOL_CALL_WAITING_APPROVAL
    ├── AgentExecution.status.phase → EXECUTION_WAITING_FOR_APPROVAL
    ├── status.pending_approvals populated with:
    │   - tool_call_id: "call_abc123"
    │   - tool_name: "delete_repository"
    │   - message: "Execute delete_repository"
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
| `approval_policy_source` | `ApprovalPolicySource` | **Why-gated provenance:** what is holding this call for approval. Projected from the tool call so a client can explain the gate (e.g. "required: marked destructive by the server") while the tool is still waiting. See [Why a Tool Is Gated](#why-a-tool-is-gated-authorization-provenance). |
| `approval_policy_hook` | `string` | The plugin whose hook asked for this approval; empty when no hook asked, or when the agent's own hooks block did. |
| `interrupt_id` | `string` | LangGraph interrupt ID for targeted resume. Used internally — do not modify. |
| `child_agent_execution_id` | `string` | Set when this `PendingApproval` is surfaced at a `WorkflowExecution` level, enabling approval forwarding. |

---

## Why a Tool Is Gated (Authorization Provenance)

Every tool call the approval gate evaluates carries its **authorization provenance** — *what decided its approval requirement* — on flat `ToolCall` fields, runner-written and persisted through `update_status` (no preserver involvement):

| Field | Type | Description |
|---|---|---|
| `approval_policy_source` | `ApprovalPolicySource` | What decided this call: a hook, the default for a built-in category, the server's destructive annotation, or a run-wide bypass, lease or unattended skip that resolved it. |
| `approval_policy_hook` | `string` | The plugin whose hook decided the call, or whose ask a lease, the run-wide bypass or the unattended skip resolved; empty when no hook did, or when the agent's own hooks block did. |
| `policy_engine_version` | `string` | The version of the policy-evaluation logic that produced the decision, for auditing changes across releases. |

`approval_policy_source` and `approval_policy_hook` are also projected onto each `PendingApproval` (exactly as `tool_kind` is), so an approval surface can answer **"why is this gated?"** before any decision is made. The `@stigmer/react` `ApprovalCard` and `@stigmer/ink` approval prompt render this as a short "why" line; the tool-call detail view shows it as post-execution provenance. The mapping from source to human phrase lives in `@stigmer/sdk`'s `describeApprovalPolicySource`, shared across web, desktop, and CLI.

`ApprovalPolicySource` values:

| Value | Meaning |
|---|---|
| `UNSPECIFIED` | Legacy execution, or no approval was required (a read-only built-in, or an MCP tool its server does not mark destructive). Clients render no provenance. |
| `AUTO_APPROVE_ALL` | The pre-armed `AgentExecutionSpec.auto_approve_all` whole-run bypass cleared the call. |
| `APPROVAL_LEASE` | A run-lifetime scoped lease (the successor to a global "approve all") cleared the call. |
| `BUILTIN_CATEGORY` | The default asked for a built-in tool of the write / delete / shell categories. |
| `ANNOTATION_DESTRUCTIVE_TIGHTEN` | The default asked for an MCP tool because its server marks it destructive (`destructiveHint: true`). |
| `UNATTENDED_SKIP` | The unattended approval mode auto-skipped this gated call — no approver exists on the creating surface (a channel, a guest share). See [Unattended Surfaces](#unattended-surfaces-channels-and-guest-shares). |
| `HOOK` | A hook decided this call: it refused it, asked a person first, or let it run without the approval the default would have asked. `approval_policy_hook` names the plugin. |

Values 1 to 3 are reserved and never reused. The field is data-compatible: old executions carry `UNSPECIFIED`, and clients fall back exactly as they do for `tool_kind`.

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
| Reject | `APPROVAL_ACTION_REJECT` | `TOOL_CALL_SKIPPED` (terminal, with the objection recorded) | Phase returns to `EXECUTION_IN_PROGRESS` — the run continues |
| Approve all | `APPROVAL_ACTION_APPROVE_ALL` | `TOOL_CALL_RUNNING` → `TOOL_CALL_COMPLETED`; every co-pending tool of the same lease scope resolves to APPROVE | Phase returns to `EXECUTION_IN_PROGRESS`; the rest of this execution does not ask again for that scope |

**On Skip:** The LLM receives a message: `"Tool '{name}' was skipped by user. Please proceed without this operation."` This allows the agent to adapt its plan and continue execution without the skipped tool's result.

**On Reject:** The tool is denied and the user's objection (the optional `comment`) is fed back to the model as the tool result, so it adapts rather than retrying. REJECT denies a SINGLE tool call — it does NOT fail the run, mirroring how interactive agent tools treat a denied tool. To stop the entire execution, use `cancel` (graceful) or `terminate` (force) — the dedicated hard-stop verbs. The distinction from SKIP is the strength of the signal, not the outcome.

**On Approve all ("approve all of this kind"):** The clicked tool is approved, and it grants a lease for the rest of this execution scoped to ONE class of call, derived from the clicked call:

- when a hook asked (`approval_policy_source = HOOK`), that hook's asks on that one tool: a later ask from the same hook on the same tool counts as the hook's allow, so the call runs without asking. Nothing else is cleared: the default keeps asking wherever the hook does not answer, another hook's ask still asks, and a hook's refusal still binds;
- otherwise, for a built-in tool, its approval category (shell commands, file edits and writes, or deletions);
- otherwise, for an MCP tool, every tool of its server.

Every co-pending call currently in `TOOL_CALL_WAITING_APPROVAL` with the same scope is resolved to APPROVE so the gate clears in one action; calls of another scope keep waiting. A category or server lease never clears a hook's ask. The lease covers sub-agent tool calls too. The scope is the current execution only; it is not persisted to the session or agent. Interactive clients may carry a session-scoped preference forward in-memory (reset on reload), but the server persists no such state.

---

## Audit Trail

Every approval decision is recorded in the `ToolCall` fields:

| Field | Description |
|---|---|
| `approval_requested_at` | When approval was requested |
| `approval_decided_at` | When the decision was submitted |
| `approved_by` | User ID who made the decision (from authentication context) |
| `approval_action` | The action taken (APPROVE, SKIP, REJECT, APPROVE_ALL) |
| `approval_policy_source` | What decided or resolved the call's approval — see [Why a Tool Is Gated](#why-a-tool-is-gated-authorization-provenance) |
| `policy_engine_version` | Version of the policy-evaluation logic that produced the decision |

When a user chooses **Approve all**, the co-pending tool calls that are auto-resolved carry `approval_action = APPROVAL_ACTION_APPROVE`, while the tool the user actually clicked carries `APPROVAL_ACTION_APPROVE_ALL`. This keeps the trail honest: every executed tool shows an explicit decision, and the single APPROVE_ALL entry marks where the user opted into trusting that class of call for the rest of the run.

This provides a complete audit trail: who approved or rejected what tool call, when, and on which execution.

---

## Bypassing Approvals for Automation

For CI/CD pipelines and trusted batch jobs where human approval is impractical, set `auto_approve_all: true` in the `AgentExecutionSpec`:

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Run automated deployment"
  auto_approve_all: true
```

Or via CLI:

```bash
stigmer run my-agent "Run automated deployment" --auto-approve
```

When `auto_approve_all` is set, all tools that would normally pause for approval execute immediately without waiting, a hook's ask included. The agent's tool lists still apply: a tool they exclude stays unavailable. The agent's hooks still run, and a call a hook refuses stays refused.

**Security considerations:**
- Restrict access to `auto_approve_all` with appropriate IAM policies
- Audit executions where this flag is used — they bypass every approval prompt (a hook's refusal and the tool lists still hold)
- In interactive sessions, the platform's own surfaces never pre-arm it: the
  gate defaults are fail-closed, and users opt in per session at a gate
  ("Approve & don't ask again")

**Embedded hosts (interactive sessions):** when Stigmer's session UI is
embedded in a product whose whole surface the *host* has already judged
trusted — e.g. a desktop app whose sessions operate on the user's own local
folder, where the apply-then-review file ledger is the safety net — the
host may pre-arm the session default via `StigmerProvider`'s
`approvalDefaults` prop (`@stigmer/react`). This is the same trust judgment
behind app-level auto-run modes in coding IDEs, made by the embedding
product rather than the platform. The user always keeps the last word: the
"Auto-approving tool calls" notice shows from the first render with its
"Turn off" control, guests never inherit the host default, and hosts on
shared or sensitive surfaces should simply not set the prop.

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

To enforce a timeout in your workflows, implement external monitoring and call `cancel` (or `terminate`) if the approval exceeds your acceptable wait window.

---

## Unattended Surfaces (Channels and Guest Shares)

Some surfaces have **no approver present at the conversation**: a WhatsApp or Slack channel user is a customer, not an org member, and a guest visiting a shared agent link is anonymous. An interactive pause would park the execution in `EXECUTION_WAITING_FOR_APPROVAL` forever — nobody on that surface is authorized to decide.

These surfaces stamp `ExecutionConfig.approval_mode = APPROVAL_MODE_UNATTENDED` when they create the execution (the channel session broker, the guest execution scope step — never the external user). In unattended mode:

- **What is gated is unchanged.** The same default decides which tools ask; only the *resolution* differs.
- A gated tool is resolved as an **automatic SKIP**: the tool does not run, the model is told the action requires an approval that is not available in this conversation, and the turn continues to normal completion. The user gets a plain-language explanation — never tool or approval vocabulary.
- The skipped call is stamped `TOOL_CALL_SKIPPED` with `approval_policy_source = APPROVAL_POLICY_SOURCE_UNATTENDED_SKIP`. `approval_action` and `approved_by` stay unset — those record **human** decisions only. No approval-request event is authored, so `pending_approvals` stays empty by construction.

The principle behind the design is that there are **two different consents**:

1. **Operator consent** — the HITL gate. It protects the org's tools and data, and is never delegated to an external user: a channel customer cannot authorize the org's destructive operations.
2. **End-user intent confirmation** — "book Monday 10 AM — shall I?". This is conversational, owned by the agent's instructions. A tool a channel customer should be able to trigger after confirming in-conversation must be one that runs without approval: an MCP tool its server does not mark destructive.

A future "park the turn and notify an org approver asynchronously" behavior would be a new `ApprovalMode` value, not a reinterpretation of unattended.
