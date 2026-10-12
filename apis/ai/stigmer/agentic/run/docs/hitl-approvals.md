# Human-in-the-Loop (HITL) Approvals

How Run gates destructive tool calls behind human approval — approve, skip, or reject per tool.

---

## What Is HITL?

Human-in-the-Loop (HITL) is an approval mechanism that pauses a run before a specific tool call executes and waits for a human decision. It prevents autonomous agents from taking irreversible actions — deleting repositories, sending emails, force-pushing branches — without explicit user consent.

When an agent is about to invoke a tool that requires approval:

1. The tool call's status changes to `TOOL_CALL_WAITING_APPROVAL`
2. The run phase changes to `RUN_WAITING_FOR_APPROVAL`
3. The session's log holds the call as an `agent.tool_use` (or `agent.mcp_tool_use`) with `evaluated_permission` `ask`, and the session goes idle with `stop_reason` `requires_action` naming it; `status.pending_approvals` describes every call awaiting an answer
4. Run pauses — no further processing occurs
5. A human answers with `confirmToolUse` or `grantPermission` on the session (or the run-scoped `submitApproval`)
6. Once every waiting call is answered, run resumes

---

## What Asks for Approval

By default there is nothing to configure. Stigmer asks before:

- shell commands;
- file writes and deletes;
- any MCP tool whose server marks it destructive (`destructiveHint: true` in the tool's MCP annotations, read from the live server at the start of each turn), and every tool of a server whose tools cannot be listed when the turn starts.

Nothing else asks by default; an agent's hooks can change that (below). An MCP tool's approval card reads `Execute <tool>`.

To keep an agent away from a tool rather than asking about it, leave the tool out with the agent's `tools` and `disallowed_tools` lists (see the Agent resource's `plugin-integration.md`). The lists hold under every bypass below: a run that approves everything still cannot call a tool its lists exclude.

An agent's hooks also decide which tools ask (`AgentSpec.hooks`, a plugin's hooks or a block written in the agent, in Claude Code's or Cursor's format). Before a call runs, a `PreToolUse` hook can refuse it, ask a person first, or let it run; whichever it answers replaces the default for that call. A hook that gives no answer leaves the call to the default. When several hooks answer, a refusal wins over an ask, and an ask over an allow. Both engines run hooks in both formats; on the Cursor engine a hook sees no sub-agent identity, and web fetch and web search, which reach no hook there, are left out of an agent whose `PreToolUse` hooks would match them (a `PostToolUse` hook on them does not run there). Hooks are the agent author's policy: a hook that lets a call run skips the approval the default would have asked of whoever runs the agent, so an agent shared with others carries that choice to them, and a hook's command runs in that person's workspace with their run values, without a prompt. An allow from a handler whose condition the runner cannot read for sure is not honoured; the call falls to the default.

`Run.auto_approve_all`, a lease, and the unattended mode decide only how a required approval is resolved, never which tools ask. None of them opens a call a hook refuses.

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
    ├── Run.status.phase → RUN_WAITING_FOR_APPROVAL
    ├── status.pending_approvals populated with:
    │   - tool_call_id: "call_abc123"
    │   - tool_name: "delete_repository"
    │   - message: "Execute delete_repository"
    │   - args_preview: {"repository": "acme/important-repo"}
    │   - requested_at: "2026-02-28T10:00:00Z"
    │
    ├── the session's log holds the agent.tool_use (evaluated_permission
    │   "ask") and goes idle: stop_reason requires_action, event_ids
    │   naming the call
    │
    └── Human answers via confirmToolUse (or grantPermission)
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

Human answers (the tool use ids the requires_action idle names):
  confirmToolUse(tool_use_id: "<run>.call_A", result: "allow")
  confirmToolUse(tool_use_id: "<run>.call_C", result: "deny")

All decisions collected → graph resumes with both decisions in one Command.
```

---

## PendingApproval Fields

Each entry in `status.pending_approvals` is a `PendingApproval` message:

| Field | Type | Description |
|---|---|---|
| `tool_call_id` | `string` | ID of the tool call awaiting approval. Pass this to `submitApproval`; `confirmToolUse` takes the call's tool use id from the session's log. |
| `tool_name` | `string` | Name of the tool. Example: `"delete_repository"`. |
| `message` | `string` | Human-readable approval prompt with resolved argument placeholders. |
| `args_preview` | `string` | Sanitized JSON preview of tool arguments. Sensitive values are redacted. |
| `requested_at` | `string` | ISO 8601 timestamp when approval was requested. |
| `from_sub_agent` | `bool` | `true` if this approval originates from a sub-agent tool call. |
| `sub_agent_name` | `string` | Name of the sub-agent when `from_sub_agent == true`. |
| `approval_policy_source` | `ApprovalPolicySource` | **Why-gated provenance:** what is holding this call for approval. Projected from the tool call so a client can explain the gate (e.g. "required: marked destructive by the server") while the tool is still waiting. See [Why a Tool Is Gated](#why-a-tool-is-gated-authorization-provenance). |
| `approval_policy_hook` | `string` | The plugin whose hook asked for this approval; empty when no hook asked, or when the agent's own hooks block did. |
| `interrupt_id` | `string` | LangGraph interrupt ID for targeted resume. Used internally — do not modify. |

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
| `UNSPECIFIED` | Legacy run, or no approval was required (a read-only built-in, or an MCP tool its server does not mark destructive). Clients render no provenance. |
| `AUTO_APPROVE_ALL` | The pre-armed `RunSpec.auto_approve_all` whole-run bypass cleared the call. |
| `APPROVAL_LEASE` | A run-lifetime scoped lease (the successor to a global "approve all") cleared the call. |
| `BUILTIN_CATEGORY` | The default asked for a built-in tool of the write / delete / shell categories. |
| `ANNOTATION_DESTRUCTIVE_TIGHTEN` | The default asked for an MCP tool because its server marks it destructive (`destructiveHint: true`). |
| `UNATTENDED_SKIP` | The unattended approval mode auto-skipped this gated call — no approver exists on the creating surface (a channel, a guest share). See [Unattended Surfaces](#unattended-surfaces-channels-and-guest-shares). |
| `HOOK` | A hook decided this call: it refused it, asked a person first, or let it run without the approval the default would have asked. `approval_policy_hook` names the plugin. |

Values 1 to 3 are reserved and never reused. The field is data-compatible: old runs carry `UNSPECIFIED`, and clients fall back exactly as they do for `tool_kind`.

---

## Answering a Call

A waiting call is answered on its session, by the tool use the session's log names (`stop_reason.event_ids` of the newest `session.status_idle`):

- `SessionCommandController.confirmToolUse` with `allow` or `deny`, recorded as a `user.tool_confirmation`. A deny may carry a `deny_message`; the agent reads it and adapts instead of retrying.
- `SessionCommandController.grantPermission` allows the call and every call of its class for the rest of the turn ("approve all of this kind", below), recorded as the call's confirmation, a `stigmer.permission.grant` and a confirmation for each other waiting call of the class.
- `SessionCommandController.interrupt` stops the session's unfinished turns instead, a waiting turn included; each ends cancelled.

Each needs `can_edit` on the session. An answer already recorded is answered again without a second event; a different answer to the same call is refused. When every waiting call of the turn is answered, the turn resumes.

The run-scoped `submitApproval` RPC remains for the clients that send it, an adapter onto the same answers: the run ID, the tool call ID and one of the decisions below.

```bash
# Approve — tool executes normally
stigmer runs approve run_abc123 \
  --tool-call call_abc123 \
  --comment "Verified the target repository is safe to delete"

# Skip — the tool does not run, and the agent adapts its plan
stigmer runs skip run_abc123 \
  --tool-call-id call_abc123 \
  --comment "Will handle this operation manually"

# Reject — the tool does not run; the run continues with your objection
stigmer runs reject run_abc123 \
  --tool-call-id call_abc123 \
  --comment "Wrong repository — this looks like a mistake"
```

### Four Possible Decisions

| Decision | `ApprovalAction` | The session's answer | Effect |
|---|---|---|---|
| Approve | `APPROVAL_ACTION_APPROVE` | `allow` | The tool runs |
| Skip | `APPROVAL_ACTION_SKIP` | `deny`, the comment as `deny_message` | The tool does not run; the run continues and the agent reads the comment |
| Reject | `APPROVAL_ACTION_REJECT` | `deny`, the comment as `deny_message` | The same as Skip: one call is denied, the run continues |
| Approve all | `APPROVAL_ACTION_APPROVE_ALL` | `grantPermission` | The tool runs; every waiting call of the same lease scope is allowed with it, and the rest of the turn does not ask again for that scope |

Skip and Reject are one answer, a deny: the denied call's result tells the agent the person refused it, with their reason when one was given, so it adapts rather than retrying. A deny never fails the run; to stop the turn, interrupt the session (or `cancel` the run, or `terminate` it to force the stop).

**On Approve all ("approve all of this kind"):** The clicked tool is approved, and it grants a lease for the rest of this run scoped to ONE class of call, derived from the clicked call:

- when a hook asked (`approval_policy_source = HOOK`), that hook's asks on that one tool: a later ask from the same hook on the same tool counts as the hook's allow, so the call runs without asking, where the hook's condition names the call for sure (an ask behind a condition the runner cannot read for sure still asks). Nothing else is cleared: the default keeps asking wherever the hook does not answer, another hook's ask still asks, and a hook's refusal still binds;
- otherwise, for a built-in tool, its approval category (shell commands, file edits and writes, or deletions);
- otherwise, for an MCP tool, every tool of its server.

Every co-pending call currently in `TOOL_CALL_WAITING_APPROVAL` with the same scope is resolved to APPROVE so the gate clears in one action; calls of another scope keep waiting. A category or server lease never clears a hook's ask. The lease covers sub-agent tool calls too. The scope is the current run only; it is not persisted to the session or agent. Interactive clients may carry a session-scoped preference forward in-memory (reset on reload), but the server persists no such state.

---

## Audit Trail

Every answer is a `user.tool_confirmation` in the session's log (and a `stigmer.permission.grant` for an approve-all), with its time, its thread and, for a deny, its reason. The decision is also stamped on the `ToolCall` fields:

| Field | Description |
|---|---|
| `approval_requested_at` | When approval was requested |
| `approval_decided_at` | When the decision was submitted |
| `approved_by` | User ID who made the decision (from authentication context) |
| `approval_action` | The action taken: APPROVE for an allow, REJECT for a deny, APPROVE_ALL on the call a grant was given on |
| `approval_policy_source` | What decided or resolved the call's approval — see [Why a Tool Is Gated](#why-a-tool-is-gated-authorization-provenance) |
| `policy_engine_version` | Version of the policy-evaluation logic that produced the decision |

When a user chooses **Approve all**, the co-pending tool calls that are auto-resolved carry `approval_action = APPROVAL_ACTION_APPROVE`, while the tool the user actually clicked carries `APPROVAL_ACTION_APPROVE_ALL`. This keeps the trail honest: every executed tool shows an explicit decision, and the single APPROVE_ALL entry marks where the user opted into trusting that class of call for the rest of the run.

This provides a complete audit trail: who approved or rejected what tool call, when, and on which run.

---

## Bypassing Approvals for Automation

For CI/CD pipelines and trusted batch jobs where human approval is impractical, set `auto_approve_all: true` in the `RunSpec`:

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
- Audit runs where this flag is used — they bypass every approval prompt (a hook's refusal and the tool lists still hold)
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

When a sub-agent's tool requires approval, the approval is surfaced in the **parent** Run's `status.pending_approvals`, with `from_sub_agent: true` and the sub-agent's name in `sub_agent_name`.

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

Stigmer does not automatically reject pending approvals after a timeout — runs remain in `RUN_WAITING_FOR_APPROVAL` indefinitely until a decision is submitted. This is intentional: approval requests may legitimately wait for hours while reviewers are offline.

To enforce a timeout, implement external monitoring and call `cancel` (or `terminate`) if the approval exceeds your acceptable wait window.

---

## Unattended Surfaces (Channels and Guest Shares)

Some surfaces have **no approver present at the conversation**: a WhatsApp or Slack channel user is a customer, not an org member, and a guest visiting a shared agent link is anonymous. An interactive pause would park the run in `RUN_WAITING_FOR_APPROVAL` forever — nobody on that surface is authorized to decide.

The server records `status.approval_mode = APPROVAL_MODE_UNATTENDED` on these turns (the hosted edition's channel and shared-agent guest turns), and on every schedule fire, where nobody is present either. The mode is a fact of the lane the turn came through: no request field sets it, so neither the external user nor any other caller can choose it. Every other turn is `APPROVAL_MODE_INTERACTIVE`. In unattended mode:

- **What is gated is unchanged.** The same default decides which tools ask; only the *resolution* differs.
- A gated tool is resolved as an **automatic SKIP**: the tool does not run, the model is told the action requires an approval that is not available in this conversation, and the turn continues to normal completion. The user gets a plain-language explanation — never tool or approval vocabulary.
- The skipped call is stamped `TOOL_CALL_SKIPPED` with `approval_policy_source = APPROVAL_POLICY_SOURCE_UNATTENDED_SKIP`. `approval_action` and `approved_by` stay unset — those record **human** decisions only. The call does not ask, so `pending_approvals` stays empty and the session never waits on it.

The principle behind the design is that there are **two different consents**:

1. **Operator consent** — the HITL gate. It protects the org's tools and data, and is never delegated to an external user: a channel customer cannot authorize the org's destructive operations.
2. **End-user intent confirmation** — "book Monday 10 AM — shall I?". This is conversational, owned by the agent's instructions. A tool a channel customer should be able to trigger after confirming in-conversation must be one that runs without approval: an MCP tool its server does not mark destructive and the agent's hooks do not ask about.

A future "park the turn and notify an org approver asynchronously" behavior would be a new `ApprovalMode` value, not a reinterpretation of unattended.
