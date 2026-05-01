# Design Decision: HITL Approval for the Cursor Harness

**Date**: 2026-04-30
**Status**: ACCEPTED
**Task**: T02 — HITL Research Spike
**Scope**: How the Cursor harness integrates with Stigmer's existing HITL approval system

---

## Problem

Stigmer sessions using the Cursor harness must participate in the same HITL approval flow as LangGraph sessions. When a tool call requires approval, the user must see the same approval gate (approve/skip/reject) regardless of which harness their session uses.

The Cursor SDK does not expose a structured tool approval API. The SDK is in public beta, and the documented surface includes streaming events, agent lifecycle management, and MCP configuration — but no programmatic `approve(toolCallId)` or `reject(toolCallId)` method.

We need a mechanism to intercept Cursor tool calls, evaluate Stigmer's approval policies, and block execution until the user submits a decision.

---

## Mechanisms Evaluated

### 1. Cursor Hooks (`preToolUse`) — CHOSEN

Cursor has a [hooks system](https://cursor.com/docs/hooks) that provides file-based scripts running at defined points in the agent loop. The `preToolUse` hook fires before ANY tool execution.

**Input** (JSON on stdin):
```json
{
  "tool_name": "Shell",
  "tool_input": { "command": "rm -rf /data", "working_directory": "/project" },
  "tool_use_id": "abc123",
  "cwd": "/project"
}
```

**Output** (JSON on stdout):
```json
{
  "permission": "allow",
  "user_message": "optional message shown in client",
  "agent_message": "optional message sent to agent"
}
```

**Strengths:**
- Deterministic — intercepts ALL tool calls, not just ones the agent chooses to gate
- First-class Cursor mechanism — supported, documented, stable envelope
- Works for both local and cloud agents
- Provides full context: tool name, tool arguments, tool use ID
- Synchronous blocking — hook script blocks until it returns, Cursor waits

**Constraint:** Hooks are synchronous processes that block on stdin/stdout. For Stigmer's async approval model (user clicks approve in UI, potentially minutes later), the hook script must block and wait for the decision. This is architecturally valid — Cursor supports configurable `timeout` on hooks, and hooks are designed to take time.

### 2. SDKRequestMessage — SUPPLEMENTARY SIGNAL

```typescript
interface SDKRequestMessage {
  type: "request";
  agent_id: string;
  run_id: string;
  request_id: string;
}
```

The SDK docs describe this as "Awaiting user input or approval" but provide only a `request_id`. There is no documented response API. The `agent.send()` method sends a new user message, which is semantically different from responding to an approval request.

**Assessment:** Useful as a supplementary signal for status reporting (detecting that the Cursor agent is waiting), but not viable as the primary approval mechanism. It lacks structured tool context and has no documented response path.

### 3. MCP Bridge — DISCARDED

Register a custom MCP server that exposes a `stigmer_request_approval` tool. Instruct the agent to call this tool before destructive operations.

**Assessment:** Relies on the agent voluntarily calling the tool (prompt compliance). If the agent decides to skip it, operations execute without approval. The hooks approach is strictly superior because it is non-bypassable — hooks intercept all tool calls regardless of agent behavior.

---

## Decision: Hooks-Based HITL Bridge

The cursor-runner uses Cursor's native `preToolUse` hook to intercept tool calls, evaluate Stigmer's approval policies, and bridge to the existing `SubmitApproval` RPC flow.

### Architecture

```
Cursor Agent
  │
  ▼ (tool call)
preToolUse hook script
  │
  ▼ (HTTP POST)
Cursor Runner (local HTTP server)
  │
  ├─ Evaluate approval policy
  │   ├─ auto_approve_all? → return allow immediately
  │   ├─ requires_approval = false? → return allow immediately
  │   └─ requires_approval = true? → continue ▼
  │
  ▼
  Update execution status:
    phase = EXECUTION_WAITING_FOR_APPROVAL
    pending_approval = { tool_call_id, tool_name, args_preview, ... }
  │
  ▼
  Wait for SubmitApproval (Temporal signal or poll)
  │
  ├─ APPROVE → return { permission: "allow" }
  ├─ SKIP    → return { permission: "deny", agent_message: "Tool skipped by user..." }
  └─ REJECT  → return { permission: "deny" } + set phase = EXECUTION_FAILED
```

### How It Works

1. **Before creating the Cursor Agent**, the cursor-runner writes a `.cursor/hooks.json` file and a companion hook script into the workspace. The hook script is a small executable that communicates with the cursor-runner process.

2. **The cursor-runner starts a local HTTP server** on a random port. The port is passed to the hook script via the `sessionStart` hook's `env` injection (Cursor supports this: the `sessionStart` hook can return `{ "env": { "STIGMER_HOOK_PORT": "12345" } }` and subsequent hooks receive these env vars).

3. **When the Cursor agent calls any tool**, Cursor fires the `preToolUse` hook. The hook script reads the tool call JSON from stdin, sends it to the cursor-runner's HTTP server, and waits for a response.

4. **The cursor-runner evaluates Stigmer's approval policy chain** for this tool:
   - If `auto_approve_all` is set on the execution → allow
   - Match tool name against approval policies (MCP tools use `mcp_server_slug/tool_name`, Cursor built-in tools use their name directly: `Shell`, `Write`, `Delete`, etc.)
   - If no policy requires approval → allow
   - If approval required → pause and wait

5. **When approval is required**, the cursor-runner:
   - Reports `EXECUTION_WAITING_FOR_APPROVAL` to the Stigmer server via `updateStatus`
   - Populates `pending_approval` with tool call details
   - Blocks the HTTP response, waiting for the approval decision

6. **The user sees the approval gate** in CLI or web (same `ApprovalCard` component, same `useSubmitApproval` hook). They submit their decision via the existing `SubmitApproval` RPC.

7. **The Stigmer server records the decision** and signals the cursor-runner (via Temporal `approvalGateResolved` signal or polling — same mechanism as LangGraph).

8. **The cursor-runner returns the HTTP response** to the hook script with the appropriate permission. The hook script writes it to stdout. Cursor proceeds or skips the tool.

### Mapping: Stigmer Approval to Cursor Hook Response

| Stigmer Concept | Cursor Hook Behavior |
|---|---|
| `requires_approval = false` | Return `{ "permission": "allow" }` immediately |
| `requires_approval = true` | Block, report WAITING_FOR_APPROVAL, wait for SubmitApproval |
| `auto_approve_all = true` | Return `{ "permission": "allow" }` for all tools |
| `ApprovalAction.APPROVE` | Return `{ "permission": "allow" }` |
| `ApprovalAction.SKIP` | Return `{ "permission": "deny", "agent_message": "Tool '{name}' was skipped by user. ..." }` |
| `ApprovalAction.REJECT` | Return `{ "permission": "deny" }`, runner sets execution phase to FAILED |
| `ToolApprovalPolicy.message` | Resolved by cursor-runner using hook input `tool_input`, sent as `approval_message` on `PendingApproval` |

### Cursor Built-in Tools

Cursor has built-in tools (Shell, Read, Write, Grep, Delete, Glob, Task, etc.) that are not MCP tools. These don't exist in Stigmer's `ToolApprovalPolicy` model, which is defined per-MCP-server.

**Approach:** The cursor-runner maps Cursor built-in tools to a built-in policy that the runner evaluates locally:

- **Require approval by default:** Shell, Delete (destructive operations)
- **Allow by default:** Read, Grep, Glob, SemanticSearch (read-only operations)
- **Configurable:** Write, Task (depends on context)

These defaults live in the cursor-runner configuration, not in protos. They can be overridden via session or agent-level configuration in the future if needed.

### What the User Sees

From the user's perspective, nothing changes. Whether their session uses LangGraph or Cursor:

- They see the same approval card in the CLI or web UI
- They click the same approve/skip/reject buttons
- They get the same audit trail
- The same `PendingApproval` fields are populated

The hooks-based bridge is entirely internal to the cursor-runner. No new proto types, no new RPCs, no new UI components.

---

## Open Questions (for T03)

### 1. Hook Timeout Limits

Cursor hooks have a configurable `timeout` per hook definition. For HITL approval, the timeout must accommodate human response time (minutes to hours in some cases). Need to verify:
- Does Cursor enforce a hard maximum timeout?
- If so, can the hook script implement long-polling (return a "still waiting" response and re-register)?
- What happens when a hook times out — does Cursor fail-open or fail-closed?

### 2. Cloud Agent Hook Deployment

For Cursor Cloud agents (VMs with cloned repos), hooks are loaded from `.cursor/hooks.json` in the repo. The cursor-runner needs to inject this file. Options:
- Write `.cursor/hooks.json` to the workspace before creating the Cursor Agent (works for local)
- For cloud: explore whether the SDK allows passing hooks configuration inline, or whether the file must exist in the cloned repo
- Worst case: the hook file is committed to the repo temporarily (undesirable but functional)

### 3. Sub-agent Tool Calls

Cursor's Task tool spawns subagents. Questions:
- Do `preToolUse` hooks fire for tool calls made by subagents?
- If yes, the hook input should include context about which subagent is calling (for mapping to `PendingApproval.from_sub_agent`)
- If no, subagent tool calls would bypass approval — this would be a limitation to document

### 4. IPC Reliability

The hook script communicates with the cursor-runner via HTTP localhost. Edge cases:
- What if the cursor-runner process crashes while a hook is waiting?
- The hook script should have a local timeout and return `deny` (fail-closed) if the runner is unreachable
- Health check before blocking on approval

### 5. Multiple Pending Approvals

The LangGraph harness handles batch approval (multiple tool calls pending at once). Cursor's model is sequential — one tool call at a time, each gated by `preToolUse`. This means:
- Cursor harness will never have multiple simultaneous pending approvals
- The `pending_approvals` list on `AgentExecutionStatus` will always have 0 or 1 entries for Cursor harness sessions
- This is simpler, not a limitation

---

## Risks

1. **Cursor SDK is in public beta.** Hook APIs may change before GA. The hook envelope (input/output JSON schema) is the main dependency. If Cursor changes the schema, the hook script needs updating. Mitigation: the hook script is small and self-contained.

2. **Hook timeout enforcement.** If Cursor enforces a hard timeout shorter than typical human response time, the blocking approach breaks. This needs empirical validation in T03.

3. **Cloud agent hook injection.** If there's no way to inject hooks into cloud agents programmatically, cloud Cursor harness sessions won't support HITL. This would be a documented limitation until Cursor adds SDK-level hook configuration.

---

## Decision Record

| Aspect | Decision |
|---|---|
| Primary mechanism | Cursor `preToolUse` hooks |
| Supplementary signal | `SDKRequestMessage` for status observation |
| Discarded approach | MCP bridge (fragile, bypassable) |
| IPC | HTTP localhost (cursor-runner serves, hook script calls) |
| Proto changes | None — hooks bridge is internal to cursor-runner |
| UI changes | None — same approval UX for both harnesses |
| Built-in tool policy | Runner-local configuration, not proto-driven |
