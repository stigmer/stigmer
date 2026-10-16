# Human-in-the-Loop (HITL) Approvals

How a turn waits at a tool call until a person allows or denies it, and how the answer is given on the session.

---

## What Is HITL?

Human-in-the-Loop (HITL) holds a tool call before it runs and waits for a person's answer. It keeps an agent from taking irreversible actions — deleting repositories, sending emails, force-pushing branches — without explicit consent.

When the agent is about to call a tool that asks for approval:

1. The session's log holds the call as an `agent.tool_use` (or `agent.mcp_tool_use`) with `evaluated_permission` `ask`, followed by a `stigmer.permission.asked` that says what to show the person and which rule asked
2. The session goes idle with `stop_reason` `requires_action`, whose `event_ids` name every call still waiting, oldest first
3. The run's phase is `RUN_WAITING_FOR_APPROVAL`; nothing else runs in the turn
4. A person answers each waiting call with `confirmToolUse` or `grantPermission` on the session
5. Once every waiting call is answered, the session reads running and the turn resumes

The session's events are described in the [Session docs](../../session/docs/README.md).

---

## What Asks for Approval

By default there is nothing to configure. Stigmer asks before:

- shell commands;
- file writes and deletes;
- any MCP tool whose server marks it destructive (`destructiveHint: true` in the tool's MCP annotations, read from the live server at the start of each turn), and every tool of a server whose tools cannot be listed when the turn starts.

Nothing else asks by default; an agent's hooks can change that (below). An MCP tool's approval message reads `Execute <tool>`.

To keep an agent away from a tool rather than asking about it, leave the tool out with the agent's `tools` and `disallowed_tools` lists (see the Agent resource's `plugin-integration.md`). The lists hold under every bypass below: a run that approves everything still cannot call a tool its lists exclude.

An agent's hooks also decide which tools ask (`AgentSpec.hooks`, a plugin's hooks or a block written in the agent, in Claude Code's or Cursor's format). Before a call runs, a `PreToolUse` hook can refuse it, ask a person first, or let it run; whichever it answers replaces the default for that call. A hook that gives no answer leaves the call to the default. When several hooks answer, a refusal wins over an ask, and an ask over an allow. Both engines run hooks in both formats; on the Cursor engine a hook sees no subagent identity, and web fetch and web search, which reach no hook there, are left out of an agent whose `PreToolUse` hooks would match them (a `PostToolUse` hook on them does not run there). Hooks are the agent author's policy: a hook that lets a call run skips the approval the default would have asked of whoever runs the agent, so an agent shared with others carries that choice to them, and a hook's command runs in that person's workspace with their run values, without a prompt. An allow from a handler whose condition the runner cannot read for sure is not honoured; the call falls to the default.

`RunSpec.auto_approve_all`, an "approve all" grant, and the unattended mode decide only how a required approval is resolved, never which tools ask. None of them opens a call a hook refuses.

---

## Why a Call Asks

`stigmer.permission.asked` follows the waiting tool use and carries its `tool_use_id`, the `message` to show, an `args_preview` with secret values redacted, and the rule that asked or resolved the call as one word in `policy_source`:

| `policy_source` | Meaning |
|---|---|
| `builtin_category` | The default asked for a built-in tool that writes, deletes or runs a shell. |
| `annotation_destructive_tighten` | The default asked for an MCP tool its server marks destructive, or whose server's tools could not be listed. |
| `hook` | A hook decided the call. `policy_hook` names the plugin; it is empty for the agent's own hooks block. |
| `approval_lease` | An "approve all" grant for the call's class resolved it. |
| `auto_approve_all` | The run approves every call (`RunSpec.auto_approve_all`). |
| `unattended_skip` | No one can answer on this turn, so the call was skipped. See [Unattended Surfaces](#unattended-surfaces-channels-and-guest-shares). |

---

## Answering a Call

A waiting call is answered on its session, by the tool use id the newest `session.status_idle` names in `stop_reason.event_ids`:

- `SessionCommandController.confirmToolUse` with `allow` or `deny`, recorded as a `user.tool_confirmation`. A deny may carry a `deny_message`; the agent reads it and adapts instead of retrying.
- `SessionCommandController.grantPermission` allows the call and every call of its class for the rest of the turn ([Approve All](#approve-all)), recorded as the call's confirmation, a `stigmer.permission.grant` and a confirmation for each other waiting call of the class.
- `SessionCommandController.interrupt` stops the session's unfinished turns instead, a waiting turn included; each ends `RUN_CANCELLED`.

Each needs `can_edit` on the session. An answer already recorded is answered again without a second event; a different answer to the same call is refused. A deny never fails the run; to stop the turn, interrupt the session (or `terminate` the run to force the stop).

From the CLI, `stigmer runs approve` answers a call the run waits on; `--tool-call` takes the tool use id `stigmer runs logs` shows, and may be left out when the run waits on one call:

```bash
# Allow the call
stigmer runs approve run_abc123 --tool-call <tool-use-id>

# Deny it; the agent reads the comment
stigmer runs approve run_abc123 --tool-call <tool-use-id> \
  --action deny --comment "Wrong repository — this looks like a mistake"

# Allow it and every waiting call of its class for the rest of the turn
stigmer runs approve run_abc123 --tool-call <tool-use-id> --action allow-all
```

### Several Calls at Once

When the model asks for several tools in one response and more than one asks for approval, all of them wait together: the idle's `event_ids` name each. Answering some of them re-states the idle with the rest; the turn resumes only after every waiting call has an answer.

```
The agent calls tools A, B and C in one response. A and C ask; B does not.

session.status_idle  stop_reason: requires_action, event_ids: [A, C]

confirmToolUse(tool_use_id: A, result: allow)
  → session.status_idle  event_ids: [C]
confirmToolUse(tool_use_id: C, result: deny, deny_message: "not now")
  → session.status_running; the turn resumes with both answers
```

### Approve All

`grantPermission` allows the clicked call and, for the rest of the turn, one class of call derived from it:

- when a hook asked (`policy_source` `hook`), that hook's asks on that one tool: a later ask from the same hook on the same tool counts as the hook's allow, so the call runs without asking, where the hook's condition names the call for sure (an ask behind a condition the runner cannot read for sure still asks). Nothing else is cleared: the default keeps asking wherever the hook does not answer, another hook's ask still asks, and a hook's refusal still binds;
- otherwise, for a built-in tool, its approval category (shell commands, file edits and writes, or deletions);
- otherwise, for an MCP tool, every tool of its server.

Every other call of the same class waiting in the turn is allowed with it; calls of another class keep waiting. A category or server grant never clears a hook's ask. The grant covers subagent tool calls too. It lasts for the current turn only and is not saved to the session or the agent. Interactive clients may carry a session-scoped preference forward in memory (reset on reload); the server saves no such state. A call no rule asks about is allowed alone, with no grant.

---

## Audit Trail

Every answer is an event in the session's log: a `user.tool_confirmation` for each call answered, with its result and, for a deny, its reason, and a `stigmer.permission.grant` where a person allowed a class of calls. Each event carries its time, its run and its thread. Together with the `stigmer.permission.asked` before it, the log says what asked, why, and how it was answered.

---

## Bypassing Approvals for Automation

For CI/CD pipelines and trusted batch jobs where a person's answer is impractical, set `auto_approve_all: true` in the `RunSpec`:

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
stigmer run my-agent -m "Run automated deployment" --auto-approve
```

When `auto_approve_all` is set, every call that would ask runs without waiting, a hook's ask included. The agent's tool lists still apply: a tool they exclude stays unavailable. The agent's hooks still run, and a call a hook refuses stays refused.

**Security considerations:**
- Restrict access to `auto_approve_all` with appropriate grants
- Audit runs where this flag is used — they bypass every approval prompt (a hook's refusal and the tool lists still hold)
- In interactive sessions, the platform's own surfaces never pre-arm it: the
  gate defaults are fail-closed, and users opt in per session at a gate
  ("Approve & don't ask again")

**Embedded hosts (interactive sessions):** when Stigmer's session UI is
embedded in a product whose whole surface the *host* has already judged
trusted — e.g. a desktop app whose sessions operate on the user's own local
folder, where file review is the safety net — the host may pre-arm the
session default via `StigmerProvider`'s `approvalDefaults` prop
(`@stigmer/react-sdk`). This is the same trust judgment behind app-level auto-run
modes in coding IDEs, made by the embedding product rather than the platform.
The user always keeps the last word: the "Auto-approving tool calls" notice
shows from the first render with its "Turn off" control, guests never inherit
the host default, and hosts on shared or sensitive surfaces should simply not
set the prop.

---

## Subagent Approvals

A subagent's call that asks waits in the same session and is answered the same way. Its `agent.tool_use` carries the subagent's `session_thread_id` (empty for the primary thread), and the idle names it beside the primary thread's waiting calls, so one approval surface answers both.

---

## Approval Timeout

A waiting call is never answered on a timer: the turn stays in `RUN_WAITING_FOR_APPROVAL` until a person answers. Approval requests may legitimately wait for hours while reviewers are offline.

To enforce a timeout, watch the session and call its `interrupt` (or the run's `terminate`) when the wait exceeds your acceptable window.

---

## Unattended Surfaces (Channels and Guest Shares)

Some surfaces have **no approver present at the conversation**: a WhatsApp or Slack channel user is a customer, not an org member, and a guest visiting a public chat link is anonymous. A turn that waited for an answer there would wait forever — nobody on that surface is authorized to decide.

The server records `status.approval_mode = APPROVAL_MODE_UNATTENDED` on these turns (the hosted edition's channel and shared-agent guest turns), and on every schedule fire, where nobody is present either. The mode is a fact of the lane the turn came through: no request field sets it, so neither the external user nor any other caller can choose it. Every other turn is `APPROVAL_MODE_INTERACTIVE`. In unattended mode:

- **What asks is unchanged.** The same default decides which tools ask; only the *resolution* differs.
- A call that asks is **skipped**: the tool does not run, the model is told the action requires an approval that is not available in this conversation, and the turn continues to normal completion. The user gets a plain-language explanation — never tool or approval vocabulary.
- The skip is recorded with the rule word `unattended_skip`. No person's answer is recorded, and the session never waits on the call.

The principle behind the design is that there are **two different consents**:

1. **Operator consent** — the HITL gate. It protects the org's tools and data, and is never delegated to an external user: a channel customer cannot authorize the org's destructive operations.
2. **End-user intent confirmation** — "book Monday 10 AM — shall I?". This is conversational, owned by the agent's instructions. A tool a channel customer should be able to trigger after confirming in-conversation must be one that runs without approval: an MCP tool its server does not mark destructive and the agent's hooks do not ask about.

A future "park the turn and notify an org approver asynchronously" behavior would be a new `ApprovalMode` value, not a reinterpretation of unattended.
