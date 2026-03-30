# Fix Concurrent Sub-Agent Resume Event Routing

**Date**: March 30, 2026

## Summary

Fixed a production bug where tool call events were misrouted between sub-agents after a Human-in-the-Loop (HITL) resume cycle involving concurrent sub-agents. The root cause was a combination of completed sub-agents being incorrectly reactivated, missing sub-agents in the routing table due to unreplayed `on_tool_start` events, and namespace registration falling back to completed sub-agents when active ones existed. Three targeted fixes plus a comprehensive test suite resolve the issue.

## Problem Statement

When an agent execution launches multiple concurrent sub-agents (via LangGraph's `asyncio.gather` in the tool node), some complete while others hit `interrupt()` for approval. After the user approves all pending tools and the all-or-nothing gate triggers a resume, the following bugs caused tool call events to appear under the wrong sub-agent in the UI:

### Pain Points

- **Completed sub-agent reactivation**: A sub-agent that had already finished (SA1) was being reactivated into `active_sub_agents` on resume, causing subsequent events from other sub-agents to be misrouted to it via namespace registration
- **Missing sub-agent in routing table**: LangGraph does not always replay `on_tool_start` for every concurrent task tool on resume. Sub-agents that never received this event were absent from `active_sub_agents`, leaving their events unroutable
- **Namespace fallback to completed sub-agents**: `_register_sub_agent_namespace` would map namespaces to completed sub-agents even when active sub-agents existed, causing live events to be attributed to finished sub-agents
- **UI duplication**: Users saw the same tool executions appearing in two places — under the completed sub-agent and under the correct in-progress sub-agent

## Solution

Implemented three targeted fixes addressing each root cause, plus a proactive pre-registration mechanism for resume scenarios:

1. **Guard completed reactivation** — `handle_sub_agent_start` now checks the sub-agent's status before reactivation. Terminal states (COMPLETED, FAILED, CANCELLED) route directly to `completed_sub_agents`
2. **Proactive pre-registration with deferred binding** — Before the resumed stream starts, all IN_PROGRESS sub-agents are registered as placeholders in `active_sub_agents`. When `on_tool_start` fires, the placeholder is re-keyed to the real LangGraph `run_id`. For sub-agents where `on_tool_start` never fires, a deferred-binding path in `_register_sub_agent_namespace` claims the sole remaining pending sub-agent
3. **Defensive namespace registration** — Completed sub-agents are only used for namespace resolution when no active sub-agents exist, preventing misrouting of live events

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `execution_state.py` | Added `pending_resume_sa_ids: set[str]` to track pre-registered sub-agents awaiting their real `run_id` |
| `handlers/sub_agent.py` | Added terminal-status guard in `handle_sub_agent_start`; added `pre_register_in_progress_sub_agents()` |
| `status_builder.py` | Rewrote `_register_sub_agent_namespace` with three-priority resolution: active → deferred binding → completed (gated); added delegation method |
| `hitl.py` | Added `pre_register_in_progress_sub_agents()` call after `prepare_task_tool_resume_queue()` during resume setup |
| `tests/test_status_builder.py` | Added `TestConcurrentSubAgentResumeRouting` class with 8 tests covering all three fixes |

### Key Design Decisions

- **Deferred binding only for single pending**: When exactly one unattached sub-agent remains in `pending_resume_sa_ids`, it is unambiguously bound to the first unknown `parent_id`. With multiple pending sub-agents, a warning is logged — this avoids incorrect guesses
- **Placeholder keying by `sa_id`**: Pre-registered sub-agents use their tool call ID as the key in `active_sub_agents`. This is a sentinel value that gets replaced by the real `run_id` when `on_tool_start` fires
- **No changes to Go server**: The all-or-nothing approval gate, `PreserveApprovalFields` merge, and `ComputePendingApprovals` logic are correct as-is. All fixes are in the Python agent-runner

### Investigation Findings

During analysis, confirmed that the Temporal workflow's approval gate is **all-or-nothing**: `approvalGateResolved` signal is only sent when *all* pending approvals across all sub-agents are decided (or any rejection). This means partial resumes cannot occur, which simplifies the fix — we never need to handle a scenario where only some sub-agents' decisions are available.

Also confirmed that the Go server's `UpdateExecutionStatus` activity correctly preserves SubmitApproval-owned fields (`approval_action`, `approval_decided_at`, `approved_by`) via `PreserveApprovalFields`, preventing the Python activity's `update_status` calls from overwriting user approval decisions.

## Benefits

- **Correct UI attribution**: Tool call results now appear only under the sub-agent that executed them
- **Resilient to LangGraph replay variations**: Pre-registration ensures routing works regardless of which `on_tool_start` events LangGraph replays on resume
- **No regressions**: All existing tests pass; 8 new tests provide targeted coverage for the fix including an end-to-end scenario test

## Impact

- **Agent Runner** (Python): Core event routing logic in StatusBuilder
- **End Users**: Sub-agent tool executions display correctly in the UI after approval resume cycles
- **Reliability**: Eliminates a class of misrouting bugs for any agent execution with 2+ concurrent sub-agents requiring approval

## Related Work

- Previous `execute-graphton` hardening work (PR #101) that refactored the activity structure
- The `PreserveApprovalFields` mechanism in `update_status_impl.go` that ensures field ownership between Python StatusBuilder and Go SubmitApproval

---

**Status**: Production Ready
**Timeline**: ~3 hours investigation and fix
