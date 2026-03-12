# Post-Stream Checkpoint Validation

**Date**: March 12, 2026

## Summary

Introduced a post-stream checkpoint validation layer that cross-references StatusBuilder's stream-derived execution state against the LangGraph checkpoint's ground truth after every agent execution. This replaces the ad-hoc orphaned sub-agent check (PR5) with a systematic, general-purpose validation framework that detects graph termination anomalies, unmatched tool calls, sub-agent completion mismatches, and AI message count divergence.

## Problem Statement

StatusBuilder represents execution state as "what the stream told us happened" — a derived view built from `astream_events()` callbacks. Callers (the orchestrator, the CLI) treat this as ground truth, but it can silently diverge from the actual graph state persisted in the checkpoint DB.

### Pain Points

- The orphaned sub-agent check (PR5) was stream-derived state checking stream-derived state — if `on_tool_start` was missed, the sub-agent was never tracked, leading to false negatives
- The checkpoint DB (the authoritative record written after every graph step) was only queried for interrupt IDs during approval flows — the message history was never accessed
- Sub-agents that actually completed but whose `on_tool_end` event was missed by StatusBuilder were incorrectly marked as FAILED
- No detection mechanism for "ghost sub-agents" (tool calls that happened in the graph but were never tracked by StatusBuilder)
- No general-purpose check for tool calls that the model requested but that never completed

## Solution

A post-stream validation step that uses the LangGraph checkpoint as a **validation oracle** — not to reconstruct StatusBuilder's state, but to verify the most critical assertions about execution correctness. The system now unconditionally calls `aget_state()` after every execution and runs four validation checks (V1–V4) against the returned `StateSnapshot`.

## Implementation Details

### New Module: `checkpoint_validator.py`

Pure validation module with no side effects:

- `Discrepancy` frozen dataclass — categorized finding with severity (error/warning)
- `CheckpointValidationResult` — aggregated result with `has_errors`/`has_warnings` properties and counts for unmatched tool calls, confirmed orphans, and missed events
- `validate_against_checkpoint()` — pure function implementing V1–V4:
  - **V1 (Graph Termination)**: Detects when `graph_state.next` is non-empty but stream ended without WAITING_FOR_APPROVAL or PAUSED phase
  - **V2 (Unmatched Tool Calls)**: Walks checkpoint messages to find AIMessage tool calls with no corresponding ToolMessage — generalizes orphaned sub-agent detection to ALL tools
  - **V3 (Sub-Agent Cross-Reference)**: Cross-references unmatched "task" tool calls against StatusBuilder's active sub-agent count to distinguish confirmed orphans, missed events, and ghost sub-agents
  - **V4 (AI Message Count)**: Compares AI message counts as a canary for systematic event loss (warning-only)
- `build_error_from_validation()` — builds user-facing error string from ERROR-severity discrepancies

### StatusBuilder Enhancement

- `finalize_sub_agents_from_checkpoint_validation()` — checkpoint-aware sub-agent finalization:
  - All missed events (checkpoint says completed) → `SUB_AGENT_COMPLETED` (correctness improvement — these sub-agents actually succeeded)
  - Confirmed orphans → `SUB_AGENT_FAILED` (mid-execution) or `SUB_AGENT_CANCELLED` (zero-message)
  - Mixed case → conservative differentiation with logged ambiguity

### Orchestrator Refactoring (`execute_graphton.py`)

- `aget_state()` moved from conditional (only WAITING_FOR_APPROVAL) to **unconditional** — cost is <10ms
- Checkpoint validation runs after `aget_state()`, logging all discrepancies with severity-appropriate log levels
- Interrupt capture reuses the same `graph_state` object — no second DB call
- Phase decision now uses `CheckpointValidationResult`:
  - `validation.has_errors` → `EXECUTION_FAILED` with checkpoint-informed sub-agent finalization
  - `validation.missed_event_count > 0` (no errors) → `EXECUTION_COMPLETED` with sub-agents marked as completed
  - `has_orphaned_sub_agents` retained as defense-in-depth fallback (only fires when checkpoint query fails)

### Tests

25 tests across 8 test classes covering all V1–V4 scenarios:
- Graph termination (4 tests), unmatched tool calls (4 tests), sub-agent cross-reference (5 tests including confirmed orphans, missed events, ghost sub-agents, mixed case), AI message count (3 tests), happy path (1 test), edge cases (4 tests), multiple discrepancies (1 test), error builder (3 tests)

## Benefits

- **Correctness**: Sub-agents that completed but whose events were missed are now correctly marked COMPLETED instead of FAILED
- **Coverage**: Detects tool call failures for ALL tools, not just the "task" tool (sub-agents)
- **Visibility**: Graph termination anomalies (pending nodes at stream end) are now detected and logged
- **Observability**: Every discrepancy is logged with category, severity, and details — structured for monitoring and alerting
- **Robustness**: Defense-in-depth design — checkpoint validation as primary signal, stream-derived check as fallback

## Impact

- **Agent Runner**: Post-stream flow in `execute_graphton.py` now validates execution correctness against the checkpoint before making the phase decision
- **End Users**: More accurate execution status — sub-agents that actually completed are no longer incorrectly shown as failed
- **Operators**: Checkpoint validation logs provide structured observability into execution consistency

## Related Work

- PR5 (Session 4): Orphaned sub-agent detection — now superseded by checkpoint validation as the primary signal
- D5 (Session 8): EXECUTION_TERMINATED phase — complements the three-way phase taxonomy (FAILED/TERMINATED/CANCELLED)
- Project: `20260312.01.agent-execution-consistency-guardrails`

---

**Status**: ✅ Production Ready
**Timeline**: Session 9 (March 12, 2026)
