# Strategic Finding: Execution Interceptors

**Date**: 2026-04-30
**Status**: DOCUMENTED — Not planned for MVP
**Origin**: T02 HITL Research Spike — discovered while studying Cursor SDK
**Revisit when**: A platform builder asks for extensibility beyond approval policies

---

## What Was Found

Cursor has a system they call "hooks" — extension points in the agent execution lifecycle where external scripts can observe, gate, or enrich what's happening. Stigmer has one of these extension points today (the approval gate before tool execution). Cursor has many:

- Before/after any tool call (observe, allow/deny, modify arguments, inject context)
- Before/after shell commands specifically
- Before/after MCP tool calls specifically
- On session start/end (inject environment, context)
- On agent completion (trigger follow-up actions)
- On context compaction (observe summarization)

The key insight: **Stigmer's HITL approval system is a special case of a more general pattern.** That general pattern — extension points where external logic can plug in — enables governance, audit, security scanning, compliance, formatting, and custom automation.

## What Cursor Offers That Stigmer Doesn't

| Capability | Cursor | Stigmer |
|---|---|---|
| Gate tool calls (approve/deny) | `preToolUse` hook | Approval policy chain |
| Modify tool arguments before execution | `preToolUse` returns `updated_input` | Not possible |
| Custom deny message back to agent | `preToolUse` returns `agent_message` | Fixed "Tool skipped" text |
| Show custom message to user on deny | `preToolUse` returns `user_message` | Not possible |
| Post-tool context injection | `postToolUse` returns `additional_context` | Not possible |
| Post-tool output redaction | `postToolUse` can modify MCP output | Not possible |
| Gate sub-agent creation | `subagentStart` hook | Not possible |
| Auto-continue after completion | `stop` hook returns `followup_message` | Not possible |
| Fail-open vs fail-closed per policy | `failClosed` flag per hook | Always fail-closed |
| Tool-type filtering | `matcher` pattern per hook | Per-MCP-server policies only |
| Third-party integrations | Semgrep, Snyk, 1Password, Endor Labs ship hook integrations | No extension mechanism |

## Why Not Now

1. **No customer demand yet.** No platform builder has asked for extensibility beyond approval policies.
2. **Approval covers the critical use case.** The ability to gate destructive tool calls is the highest-value extension point, and Stigmer already has it.
3. **Design needs real-world iteration.** The right set of extension points, the right contract (what goes in, what comes out), and the right registration model all need customer feedback.
4. **Adds API surface to maintain.** Every proto type and RPC added now is a commitment.

## What It Would Look Like (Sketch)

If Stigmer were to add this in the future, the concept in Stigmer's domain language would be **Execution Interceptors** — not "hooks" (too implementation-specific).

A rough proto sketch (NOT a proposal, just for understanding):

```
message ExecutionInterceptor {
  InterceptorEvent event = 1;    // BEFORE_TOOL_USE, AFTER_TOOL_USE, etc.
  string webhook_url = 2;        // HTTP endpoint that receives/returns JSON
  repeated string tool_filter = 3; // optional: only fire for these tools
  bool fail_open = 4;            // if webhook fails, block or continue?
}
```

Interceptors would attach to `AgentSpec` (agent-level) or `SessionSpec` (session-level), and optionally at the organization level for enterprise governance.

## When to Revisit

- A platform builder says "I need to run my security scanner before every tool call"
- A platform builder says "I need to inject compliance context after tool results"
- Enterprise customers need audit/governance hooks beyond what approval policies provide
- Stigmer wants to enable a partner ecosystem (like Cursor's Semgrep/Snyk integrations)

## Relationship to Cursor Harness

The Cursor harness uses Cursor's native hooks internally (see `hitl-cursor-hooks-approach.md`). This is entirely contained within the cursor-runner service — no Stigmer-level interceptor system needed. If Stigmer adds interceptors in the future, the Cursor harness would participate in them alongside the LangGraph harness.
