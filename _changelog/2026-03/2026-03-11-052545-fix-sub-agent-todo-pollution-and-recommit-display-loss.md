# Fix Sub-Agent Todo Pollution and Re-Commit Display Loss

**Date**: March 11, 2026

## Summary

Fixed two bugs affecting sub-agent display in the CLI TUI. Sub-agent `write_todos` calls were polluting the main agent's todo list (replacing the parent plan with sub-agent plan items), and active sub-agent spinners were vanishing whenever a screen re-commit was triggered (by subject updates, Ctrl+O toggles, or AI stream markdown rendering).

## Problem Statement

After completing the Sub-Agent Execution Streamline project (PRs 1-5) and the parallel sub-agent display fix, two interacting bugs remained that degraded the sub-agent UX.

### Pain Points

- When sub-agents called `write_todos`, their internal plan items overwrote the main agent's todo list entirely — the CLI showed "Plan: 1/8 todos completed" with sub-agent tasks instead of the parent agent's plan
- Active sub-agent spinners (all 4 in a parallel scan) would appear briefly then vanish when any re-commit trigger fired, leaving the user with no visibility into running sub-agents
- The root cause of the todo pollution was that `PLANNING_TOOLS` were handled before namespace routing in the Python status_builder, so all `write_todos` calls — regardless of origin — wrote to `current_status.todos`
- The root cause of the display loss was that `performReCommit` created a new Bubbletea program without transferring `activeSubAgentEntries`, and the `SubAgentStartedEvent` that originally populated them was a one-shot event already consumed

## Solution

Two independent fixes across the Python agent-runner and Go CLI layers:

1. **Namespace-aware planning tool routing**: Moved namespace registration before the `PLANNING_TOOLS` handler in `_handle_tool_start_event`, then added a sub-agent guard that detects sub-agent context via `_get_execution_context()` and silently discards sub-agent `write_todos` calls.

2. **Sub-agent entry transfer on re-commit**: Added `transferSubAgentEntries()` method that derives display entries from the renderer's `activeSubAgents` map during `performReCommit` and `performReCommitWithApproval`, then bootstraps the spinner tick chain with a `subAgentTickMsg`.

## Implementation Details

### Python: Namespace Registration Reorder

In `status_builder.py`, the event processing order in `_handle_tool_start_event` was:

1. Fingerprint dedup
2. PLANNING_TOOLS check (write_todos) — **no namespace awareness**
3. Task tool handler
4. Namespace registration
5. Regular tool routing

The fix moves namespace registration to position 2, before PLANNING_TOOLS:

1. Fingerprint dedup
2. Namespace registration (`_register_sub_agent_namespace`)
3. PLANNING_TOOLS check — now calls `_get_execution_context(namespace)` to detect sub-agent origin
4. Task tool handler
5. Regular tool routing

`_register_sub_agent_namespace` is idempotent (returns immediately for already-registered or single-segment namespaces), so the reorder is safe for all callers.

### Design Decision: No `todos` field on `SubAgentExecution` proto

Sub-agent todos are ephemeral internal state that carry no value after the sub-agent completes. Rather than adding a `todos` field to the `SubAgentExecution` message (which would require proto changes, CLI rendering for N concurrent sub-agent plans, and display real estate for data users don't need), the fix silently discards sub-agent `write_todos` calls. The tool still executes in LangGraph — the sub-agent gets its todos — but the status_builder does not record them in the parent execution's snapshot.

### Go CLI: transferSubAgentEntries

The new method derives `subAgentDisplayEntry` structs from the renderer's `activeSubAgents` map (the canonical source of truth that survives re-commits). The `activity` field resets to empty (renders as "Working" by default) and `spinnerStart` resets to `time.Now()` — both acceptable since the screen was just cleared and the next sub-agent event will update them.

After creating the new program, a `subAgentTickMsg{}` is sent to bootstrap the spinner animation chain, which normally starts in `handleSubAgentShow` (not triggered during re-commit since the sub-agents are already known).

## Benefits

- Main agent's plan/todo list is no longer corrupted by sub-agent `write_todos` calls
- Active sub-agent spinners persist across all re-commit triggers (subject updates, Ctrl+O toggles, AI stream markdown re-renders)
- No proto surface area increase — clean separation without modeling ephemeral sub-agent state

## Impact

- **CLI users**: Sub-agent progress indicators remain visible throughout execution; plan display shows only the main agent's actual plan
- **Correctness**: Eliminates a class of data pollution where sub-agent internal state leaked into the parent execution's status
- **Architecture**: Establishes the principle that PLANNING_TOOLS must be namespace-aware, preventing similar routing bypass bugs for future planning tools

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display`
- Changelog: `2026-03-11-035511-fix-sub-agent-subject-shows-full-prompt`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
