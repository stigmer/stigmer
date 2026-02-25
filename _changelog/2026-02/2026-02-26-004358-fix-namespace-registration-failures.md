# Fix Namespace Registration Failures in StatusBuilder

**Date**: February 26, 2026

## Summary

Added a fourth namespace registration strategy ("sole-active-agent fallback") to the StatusBuilder, resolving a gap where sub-agent events from multiple distinct LangGraph namespace roots were misrouted to the main agent context. Also improved diagnostic logging to use WARNING level with deduplication, eliminating the flood of `[NS_DIAG]` INFO messages.

## Problem Statement

When a sub-agent's internal LangGraph graph produces events from multiple namespace roots (a normal behavior for complex sub-graphs), only the first namespace root was successfully registered via causal correlation. All subsequent events from different namespace roots failed all three existing registration strategies, producing a continuous flood of `[NS_DIAG] Namespace registration failed` log lines.

### Pain Points

- Sub-agent tool calls and LLM messages were silently misattributed to the main agent context
- Sub-agent sections in the UI showed incomplete activity while the main agent showed activity that didn't belong to it
- Token usage from sub-agent LLM calls was counted against the main agent
- INFO-level diagnostic logs fired on every event with no deduplication, flooding operational logs

## Solution

Added **Strategy 4: Sole-active-agent fallback** to `_register_sub_agent_namespace()`. When exactly one sub-agent is active and all three prior strategies fail, the multi-segment namespace is mapped to that sole sub-agent -- there is no other candidate, making this a zero-ambiguity heuristic.

The remaining diagnostic log (which now only fires in the genuinely ambiguous multi-sub-agent case) was promoted to WARNING and deduplicated via `_warned_namespaces`.

## Implementation Details

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

- Inserted Strategy 4 between the existing Strategy 3 (causal correlation) and the diagnostic log block
- Strategy 4 checks `len(self._active_sub_agents) == 1` and maps via `next(iter(self._active_sub_agents))`
- Logs at DEBUG level since the mapping is unambiguous
- The diagnostic block now checks `namespace not in self._warned_namespaces` before logging, and uses `self.logger.warning` instead of `self.logger.info`

**File**: `backend/services/agent-runner/tests/test_status_builder.py`

- Added `TestNamespaceRegistrationStrategies` class with 4 tests:
  - `test_sole_active_agent_fallback_registers_different_root` -- verifies Strategy 4 maps a second namespace root after causal correlation is consumed
  - `test_sole_active_agent_routes_events_to_sub_agent` -- verifies correct event routing (tool calls land in sub-agent, not main)
  - `test_fallback_does_not_apply_with_multiple_sub_agents` -- verifies Strategy 4 is skipped when 2+ sub-agents are active
  - `test_diagnostic_warning_deduplicated` -- verifies `_warned_namespaces` prevents repeated log output

## Benefits

- Correct sub-agent event routing for the common single-sub-agent case
- Accurate token attribution and status tracking in the UI
- Eliminates log flooding from repeated namespace registration failures
- No changes to existing strategies or the event processing pipeline

## Impact

- **Agent Runner**: All agent executions with sub-agents benefit from correct namespace routing
- **CLI/UI**: Sub-agent sections now display complete tool call and message activity
- **Observability**: Operational logs are significantly less noisy; remaining warnings indicate genuine multi-sub-agent ambiguity worth investigating

---

**Status**: ✅ Production Ready
