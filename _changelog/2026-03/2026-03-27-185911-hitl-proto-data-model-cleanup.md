# HITL Proto Data Model Cleanup — Eliminate Duplication Sources

**Date**: March 27, 2026

## Summary

Cleaned up the HITL approval proto data model by removing the flat `tool_calls` duplication, eliminating `pending_approvals` from sub-agents, deleting the `ApprovalLifecycleState` distributed state machine, and adding `args_preview` to `ToolCall`. This is T02 of the HITL approval flow cleanup project — the proto foundation that unblocks the Python, Java/Go, and React cleanup tasks.

## Problem Statement

The HITL approval flow maintained approval state in 6 places across 4 languages. Every bug traced back to keeping them in sync.

### Pain Points

- `AgentExecutionStatus.tool_calls` was a flat denormalized copy of tool calls already embedded in `messages[].tool_calls`, requiring dual writes and merge logic
- `SubAgentExecution` duplicated both `tool_calls` and `pending_approvals`, adding another sync surface
- `ApprovalLifecycleState` was a 4-stage distributed state machine (REQUESTED -> INTERRUPT_CAPTURED -> DECISION_RECORDED -> RESUME_RECONCILED) with forward-only enforcement across Python, Go, and Java — complexity that existed only to coordinate the sync
- `PendingApproval` carried 4 lifecycle fields (`interrupt_id`, `lifecycle_state`, `decision_action`, `decision_recorded_at`) that duplicated data already authoritative on `ToolCall`
- Four cascading HITL bug fixes in a single day (March 26) all traced to these sync surfaces

## Solution

Established two sources of truth instead of six:
1. **Messages** — tool calls live exclusively in `messages[].tool_calls`
2. **LangGraph checkpoint** — interrupt IDs resolved at resume time

`pending_approvals` becomes a server-computed projection recomputed on every `UpdateStatus` write, eliminating merge logic entirely.

## Implementation Details

### approval.proto
- Deleted `ApprovalLifecycleState` enum (5 values, ~50 lines of documentation)
- Removed fields 9-12 from `PendingApproval`: `interrupt_id`, `lifecycle_state`, `decision_action`, `decision_recorded_at`
- Rewrote `PendingApproval` doc comment from "single source of truth with merge semantics" to "UI-facing projection computed server-side"
- Removed now-unused `enum.proto` import

### api.proto
- Removed `repeated ToolCall tool_calls = 3` from `AgentExecutionStatus`
- Rewrote `pending_approvals` field documentation from merge-based to computed-projection semantics

### subagent.proto
- Removed `repeated ToolCall tool_calls = 10` from `SubAgentExecution`
- Removed `repeated PendingApproval pending_approvals = 14` from `SubAgentExecution`
- Removed now-unused `approval.proto` import
- Sub-agent approval provenance preserved via `PendingApproval.from_sub_agent` + `sub_agent_name` on the root-level computed list

### message.proto
- Added `string args_preview = 18` to `ToolCall` — enables the server-side `ComputePendingApprovals` projection to source the preview directly from the tool call

### Stubs regenerated
- `make protos` run in both stigmer (OSS) and stigmer-cloud repositories
- Go, Java, Python, TypeScript, Dart stubs all regenerated
- `buf lint` passed cleanly

## Benefits

- **Net deletion**: ~3,300 lines removed across generated stubs, ~110 lines removed from hand-written proto definitions
- **Eliminated complexity surfaces**: `ApprovalLifecycleState` state machine, `PendingApprovalMerger`, forward-only enforcement logic — all become unnecessary
- **Single write path**: Tool calls write to messages only; no flat list to keep in sync
- **Simpler resume flow**: `interrupt_id` resolved from LangGraph checkpoint at resume time rather than stored in proto and matched across services
- **Unblocks T03-T07**: Proto foundation is in place for Python, Java/Go, React, and test cleanup

## Impact

- **Proto API**: Breaking change to `AgentExecutionStatus`, `SubAgentExecution`, and `PendingApproval` wire format. No backward compatibility concern — HITL approval flow is pre-GA.
- **Downstream**: Go, Java, Python, and TypeScript code referencing removed fields will not compile until T03/T05/T06 are complete. This is expected — work continues on the `hitl-flow-simplification` branch.

## Related Work

- [HITL tool_call_id Research and Interrupt Payload Design](2026-03-27-174225-hitl-tool-call-id-research-and-interrupt-payload-design.md) — T01 research that confirmed tool_call_id availability
- [HITL tool_call_id Interrupt Injection](2026-03-27-183939-hitl-tool-call-id-interrupt-injection.md) — T04 implementation that eliminated fuzzy matching
- [HITL Approval Flow Hardening](2026-03-26-201753-hitl-approval-flow-hardening.md) — The lifecycle state machine this change removes
- [HITL Frontend Approval Resilience](2026-03-27-094233-hitl-frontend-approval-resilience.md) — UI polling workarounds that T06 will remove

---

**Status**: ✅ Production Ready (proto layer complete, downstream tasks pending)
**Project**: `_projects/2026-03/20260327.01.hitl-approval-cleanup`
**Task**: T02 — Proto changes
