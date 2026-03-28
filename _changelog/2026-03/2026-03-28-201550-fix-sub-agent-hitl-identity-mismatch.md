# Fix Sub-Agent HITL Approval Identity Mismatch

**Date**: March 28, 2026

## Summary

Fixed the root cause of sub-agent HITL approval loops where approving a tool had no effect — the card would disappear for 8 seconds then reappear indefinitely. The issue was a `tool_call_id` identity mismatch between StatusBuilder (UUID-format fallback IDs) and the LangGraph interrupt payload (Anthropic `toolu_*` IDs), compounded by a silent fresh-invocation fallback that masked the error.

## Problem Statement

Sub-agent tool approvals were stuck in an infinite loop: user clicks Approve, the card disappears (optimistic dismissal), but after 8 seconds the same approval card reappears. The execution never actually resumes. This only affected sub-agent tools — the normal (main-agent) HITL flow worked correctly.

### Pain Points

- Two `execute` tools from sub-agents kept reappearing after every approval
- The `execute_graphton.py` resume matching silently fell back to a fresh graph invocation when no interrupts matched, creating an infinite loop that wasted tokens
- The status ToolCall for the second sub-agent had `tool_call_id: 019d34c3-...` (UUID format from LangGraph `run_id` fallback), while the interrupt payload had a `toolu_*` ID — two different identity spaces that never match
- No error was logged for the mismatch, making diagnosis extremely difficult

## Solution

Established a single source of truth for `tool_call_id` by fixing the identity chain from streaming → early tool call → reconciliation → sub-agent lifecycle, and added defense-in-depth matching with explicit failure modes.

## Implementation Details

### StatusBuilder: Re-queue existing TCs on resume dedup (`status_builder.py`)

During resume, LangGraph replays the AI message from the checkpoint. `_create_early_tool_call` correctly detected replayed `tool_use` blocks as duplicates but did NOT re-queue them in `_early_tool_call_queue`. When `on_tool_start` fired later, `_reconcile_early_tool_call` found nothing in the queue, so the `task` handler fell through to the `run_id` fallback.

**Fix**: When the resume dedup triggers, the existing TC is now re-queued for reconciliation, preserving the Anthropic `toolu_*` ID through the full lifecycle.

### StatusBuilder: Resume-aware reconciliation (`status_builder.py`)

Added a fast path in `_reconcile_early_tool_call` for resumed TCs (detected via `not is_streaming`). These entries only need a `run_id` alias — their args, approval status, and other fields are preserved from the prior cycle to avoid overwriting recorded approval decisions.

### StatusBuilder: Bypass fingerprint dedup for task tools (`status_builder.py`)

The fingerprint dedup and reconciled-resume fallback at the top of `_handle_tool_start_event` returned early for ALL tools, including `task`. This prevented the task handler from running, which meant `_handle_sub_agent_start` was never called and sub-agents were never reactivated in `_active_sub_agents` during resume.

**Fix**: Task tools now bypass these early-return paths. The task handler always runs, ensuring sub-agent lifecycle management (reactivation on resume, creation on first run) is never short-circuited.

### execute_graphton.py: Bidirectional ID lookup (defense-in-depth)

After the primary matching loop, unmatched decisions are now paired with unmatched interrupts via a reverse lookup. This catches residual ID mismatches with a loud `[RESUME_ID_MISMATCH]` warning that identifies the exact divergent IDs — making future diagnosis immediate rather than requiring log archaeology.

### execute_graphton.py: Fail loudly on empty resume_dict

When all approval decisions fail to match any checkpoint interrupt, the execution is now set to `EXECUTION_FAILED` with a diagnostic error message (listing both decision and interrupt tool_call_ids) and returned immediately. No more silent fresh invocations that create infinite loops.

### Contract tests (`test_hitl_contracts.py`)

Added 8 new tests covering:
- Replayed task `tool_use` blocks are re-queued for reconciliation
- `on_tool_start` reconciles to the Anthropic ID (not UUID fallback)
- Parallel task tools reconcile independently
- Fingerprint dedup does not block the task handler
- Bidirectional ID fallback resolves direct and proxy mismatches
- Normal matching is not affected by the fallback

## Benefits

- Sub-agent tool approvals work end-to-end: approve → card disappears → sub-agent resumes → results appear
- Identity mismatches produce loud diagnostic logs instead of silent infinite loops
- Empty `resume_dict` produces an explicit FAILED state with actionable error messages
- All 1336 existing tests continue to pass

## Impact

- **Users**: Sub-agent HITL approvals no longer get stuck — the most critical user-facing bug in the agent execution flow is resolved
- **Operators**: Failed resume matching now produces clear error messages with both decision and interrupt IDs, eliminating the need for log archaeology
- **Developers**: The StatusBuilder task-tool lifecycle is now correctly isolated from generic dedup paths, making future tool-type additions safer

## Related Work

- [Sub-agent approval resume fix](2026-03-28-182909-sub-agent-approval-resume-fix.md) — prior fix for proxy payload structure
- [Sub-agent UI visibility fix](2026-03-28-191432-fix-sub-agent-ui-visibility.md) — prior fix for StatusBuilder ID assignment
- [HITL approval cleanup project](../../_projects/2026-03/20260327.01.hitl-approval-cleanup/README.md) — the broader simplification effort

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (investigation + implementation + testing)
