# Design Decision 001: Single Source of Truth for Tool Calls and Approvals

**Date**: 2026-03-27
**Status**: Approved
**Context**: HITL approval flow had 6 places storing approval state, causing 4 cascading bugs in one day

## Decision

### 1. Tool calls live in `messages[].tool_calls` ONLY

- Remove `repeated ToolCall tool_calls` (field 3) from `AgentExecutionStatus`
- Remove `repeated ToolCall tool_calls` (field 10) from `SubAgentExecution`
- All tool call mutations (status transitions, results, approval fields) update the message-embedded copy
- Python agent-runner is the single writer

### 2. `pending_approvals` is a server-computed materialized projection

- Python NEVER writes to `pending_approvals`
- Java/Go `UpdateStatus` handler has a `ComputePendingApprovals` step
- Scans `messages[].tool_calls` and `sub_agent_executions[].messages[].tool_calls`
- Collects ToolCalls with `status == WAITING_APPROVAL && requires_approval == true`
- Projects into `PendingApproval` entries, stores in DB
- Recomputed on every UpdateStatus — single logic, single location, always consistent

### 3. Interrupt matching uses `tool_call_id` directly

- Add `tool_call_id` to the LangGraph interrupt value payload in `graphton/core/tool_wrappers.py`
- At resume time: query checkpoint -> read `tool_call_id` from interrupt value -> direct mapping
- Delete all fuzzy matching: run_id aliases, fingerprint maps, name-based fallback

### 4. `ApprovalLifecycleState` is deleted

- No distributed lifecycle tracking needed when there's a single source of truth
- The approval flow becomes: tool call created with WAITING_APPROVAL -> user submits decision -> ToolCall.approval_action set -> agent resumes from checkpoint
- No REQUESTED / INTERRUPT_CAPTURED / DECISION_RECORDED / RESUME_RECONCILED states

## Rationale

Every HITL bug traced back to maintaining parallel state:
- Stale idempotency: ToolCall.approval_action from previous cycle confused the handler
- Wrong interrupt matching: Phase 2 matched the wrong tool_call_id across cycles
- Race condition: pending_approvals deleted before Python could read them
- Argument swap: regression from fixing the race condition

With this design, there is nothing to sync. Tool calls have one copy (in messages). Pending approvals are computed from that single copy. Interrupts carry the tool_call_id so matching is trivial.

## Consequences

- CLI `run_stream_snapshot.go` and `run_display_summary.go` will break (accepted: CLI revamp planned separately)
- Proto field removal is a breaking change (fields will be marked `reserved`)
- `ChildApprovalNotification` signal still carries `PendingApproval` entries (notification payload, not stored status)
