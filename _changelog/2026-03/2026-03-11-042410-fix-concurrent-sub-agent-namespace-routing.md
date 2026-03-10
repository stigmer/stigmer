# Fix Concurrent Sub-Agent Namespace Routing

**Date**: March 11, 2026

## Summary

Fixed a critical routing bug where tool calls from concurrently launched sub-agents leaked to the parent agent level, making sub-agent blocks appear empty and their tool calls show as top-level entries in the CLI. The root cause was a scalar `_pending_sub_agent_id` field that only tracked the last sub-agent when multiple launched in parallel.

## Problem Statement

When an agent launched multiple sub-agents in parallel (e.g., "scan all 4 services using subagents"), only one sub-agent's namespace got registered via causal correlation. The remaining sub-agents' tool calls, thinking events, and AI messages were misrouted to the main agent's execution context.

### Pain Points

- Sub-agent blocks appeared briefly with 0 tools, then vanished from the CLI
- All sub-agent tool calls (Find, Search, List, etc.) rendered at the top level
- "Thinking" entries from sub-agents appeared at the parent level without sub-agent grouping
- Impossible to tell which sub-agent was doing what — the parallel execution UX was broken

## Solution

Two-layer fix in the backend status_builder, no CLI or proto changes needed:

1. **FIFO queue for causal correlation**: Replaced the scalar `_pending_sub_agent_id` with a `_pending_sub_agent_ids` list. Each `task` tool start appends to the queue; Strategy 3 pops from the front, correctly mapping each sub-agent's first namespace in order.
2. **Namespace-aware early tool call reconciliation**: Added sub-agent context to `_early_tool_call_queue` entries so that reconciliation matches by both tool name and execution context, preventing cross-contamination when concurrent sub-agents invoke the same tool.

## Implementation Details

### Backend (`status_builder.py`)

- **`_pending_sub_agent_id: str | None`** changed to **`_pending_sub_agent_ids: list[str]`** — 6 touch points updated across declaration, `_handle_sub_agent_start` (append), `_register_sub_agent_namespace` Strategy 3 (pop front), `_handle_sub_agent_end` (remove by value), and diagnostic logging
- **`_early_tool_call_queue: list[str]`** changed to **`list[tuple[str, str | None]]`** — each entry now carries `(temp_id, sub_agent_id)` so `_reconcile_early_tool_call` matches by both `tool_name` and sub-agent context
- Updated docstrings for `_register_sub_agent_namespace` and `_reconcile_early_tool_call` to document the concurrent behavior

### Tests (`test_status_builder.py`)

- Updated 4 existing tests that referenced the old scalar API (`_pending_sub_agent_id is None` → `_pending_sub_agent_ids == []`)
- Added 5 new tests in `TestConcurrentSubAgentNamespaceRegistration`:
  - `test_fifo_causal_correlation_maps_all_four` — 4 parallel sub-agents all get mapped
  - `test_fifo_tool_calls_routed_to_correct_sub_agents` — end-to-end routing verification
  - `test_root_prefix_cascading_after_fifo` — Strategy 1 handles subsequent namespaces after FIFO maps the first
  - `test_handle_sub_agent_end_removes_from_pending_queue` — early completion doesn't disrupt queue
  - `test_early_reconciliation_no_cross_contamination` — same tool name from different sub-agents reconciles correctly

## Benefits

- Concurrent sub-agent launches (2, 4, or more) now correctly route all tool calls and messages to their respective sub-agent executions
- CLI renders sub-agent blocks with accurate tool counts and nested tool call display
- Defense-in-depth: even if namespace registration is delayed, early reconciliation won't cross-contaminate between sub-agents
- All 252 tests pass with zero regressions

## Impact

- **CLI users**: Sub-agent blocks now show their actual tool calls nested underneath instead of appearing empty while tools render at the top level
- **Backend**: No performance impact — the FIFO queue is O(1) append / O(1) pop-front for the common case
- **Compatibility**: Fully backward-compatible — sequential sub-agent launches (1 at a time) behave identically to before

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5 — this fix addresses a gap discovered after that project completed)
- Changelog: `2026-03-11-035511-fix-sub-agent-subject-shows-full-prompt` (complementary sub-agent UX fix)

---

**Status**: Production Ready
**Timeline**: Single session
