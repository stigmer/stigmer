# Cursor Harness HITL Research Spike — Design Decision

**Date**: April 30, 2026

## Summary

Completed the HITL research spike (T02) for the Cursor Harness project. Investigated how the Cursor TypeScript SDK handles tool approval, evaluated three candidate mechanisms, and produced design decision documents that define the HITL strategy for the Cursor harness and document a strategic extensibility concept for the future.

## Problem Statement

Stigmer sessions using the Cursor harness must participate in the same HITL approval flow as LangGraph sessions — same approval gate, same approve/skip/reject actions, same UI. The Cursor SDK does not expose a structured tool approval API (no programmatic `approve(toolCallId)`), so we needed to find an alternative mechanism.

### Pain Points

- Cursor SDK is in public beta with no documented approval response path
- `SDKRequestMessage` carries only a `request_id` — no tool context, no response mechanism
- The original plan proposed an MCP bridge approach that relies on agent cooperation (bypassable)
- Cursor has built-in tools (Shell, Write, Delete) outside Stigmer's MCP-based approval policy model

## Solution

### Primary Mechanism: Cursor Hooks (`preToolUse`)

Discovered that Cursor has a Hooks system — a first-class extensibility mechanism that intercepts ALL tool calls before execution. The `preToolUse` hook receives structured JSON (tool name, arguments, tool use ID) and returns a permission decision (allow/deny).

The cursor-runner deploys a hook script into the workspace that communicates with a local HTTP server on the runner process. The runner evaluates Stigmer's approval policies and bridges to the existing `SubmitApproval` RPC flow.

### Strategic Finding: Execution Interceptors

Research revealed that Cursor's hooks system is a general extensibility pattern that enables governance, audit, security scanning, and policy enforcement — capabilities Stigmer doesn't have today. Documented as a strategic concept ("Execution Interceptors") for future consideration, not MVP.

## Implementation Details

### Design Decision Documents Produced

1. **`hitl-cursor-hooks-approach.md`** — The Cursor harness HITL bridge design:
   - Architecture diagram: Cursor Agent → Hook Script → Cursor Runner → Stigmer Server → User
   - Approval mapping: Stigmer APPROVE/SKIP/REJECT → Cursor hook allow/deny with agent_message
   - Built-in tool policy defaults (Shell/Delete require approval, Read/Grep allow)
   - 5 open questions for T03 implementation (hook timeouts, cloud deployment, sub-agents, IPC, batch approvals)

2. **`execution-interceptors-concept.md`** — Strategic future reference:
   - Comparison table: Cursor capabilities vs Stigmer capabilities
   - Rough proto sketch for `ExecutionInterceptor` message
   - Decision: shelved until customer demand materializes

### Key Technical Decisions

- **Hooks over MCP bridge**: Hooks are deterministic and non-bypassable; MCP bridge relies on agent cooperation
- **No proto changes**: The hooks bridge is entirely internal to the cursor-runner service
- **No UI changes**: Same `ApprovalCard`, same `useSubmitApproval`, same `SubmitApproval` RPC
- **Built-in tool policy**: Runner-local configuration, not proto-driven
- **Interceptors shelved**: No customer demand; approval chain covers the critical use case

## Benefits

- De-risked the HITL design before building the cursor-runner (T03)
- Identified a strictly superior mechanism to the originally proposed MCP bridge
- Documented 5 specific open questions that T03 must resolve during implementation
- Captured a strategic platform extensibility concept for future evaluation
- No proto changes, no UI changes, no breaking changes — the bridge is self-contained

## Impact

- **T03 (Cursor Runner)**: Can now implement the HITL bridge with a clear, validated design
- **T04 (Go Workflow)**: Unaffected — same Temporal signal pattern works for both harnesses
- **Users**: Same approval experience regardless of harness — no new concepts to learn
- **Future**: Execution interceptors concept documented as a reference for when extensibility demand materializes

## Related Work

- [Cursor Harness Proto Foundation](2026-04-30-130933-cursor-harness-proto-foundation.md) — T01 proto changes (Harness enum, MESSAGE_THINKING)
- Design decision: `_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md`
- Design decision: `_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md`
- Design decision: `_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md`

---

**Status**: ✅ Production Ready (design documents complete, ready for T03 implementation)
**Timeline**: 1 session (~2 hours research + design)
