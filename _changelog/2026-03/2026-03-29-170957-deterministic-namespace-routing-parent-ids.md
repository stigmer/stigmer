# Replace Namespace Heuristics with parent_ids-Based Deterministic Routing

**Date**: March 29, 2026

## Summary

Replaced StatusBuilder's 4-strategy heuristic namespace-to-sub-agent mapping with a single deterministic `parent_ids` lookup. This eliminates an entire class of compensating complexity — root-prefix matching, substring matching, FIFO causal correlation, and sole-active-agent fallback — replacing ~100 lines of fragile heuristics with ~25 lines of direct identity-based routing. Net result: -56 lines, zero regressions across 2,711 tests.

## Problem Statement

When LangGraph streams v2 events for sub-agent executions, each event carries a `langgraph_checkpoint_ns` (namespace) that must be mapped to the correct sub-agent's `run_id` to route status updates properly. StatusBuilder had no direct way to establish this mapping, so it relied on four increasingly desperate heuristic strategies:

### Pain Points

- **Root-prefix matching**: Assumed namespace roots uniquely identified sub-agents — false when concurrent sub-agents share a parent node
- **Substring matching**: Scanned active sub-agent run IDs for substring presence in namespace strings — fragile, could match the wrong agent
- **FIFO causal correlation**: Maintained a `_pending_sub_agent_ids` queue, assuming namespace registration events arrive in the same order as sub-agent starts — timing-dependent assumption
- **Sole-active-agent fallback**: If only one sub-agent was active, assigned all unresolved namespaces to it — wrong when agents overlap or complete out of order
- The `_pending_sub_agent_ids` list added lifecycle complexity across `__init__`, `_handle_sub_agent_start`, and `_handle_sub_agent_end`

## Solution

Use `parent_ids` — a top-level field on v2 `astream_events` — to deterministically resolve namespace ownership. When a sub-agent's tool is invoked, the task tool's `run_id` (which StatusBuilder already tracks in `_active_sub_agents`) appears in `parent_ids` for all downstream events. A single scan of `parent_ids` against `_active_sub_agents` (and `_completed_sub_agents` for late-arriving events) establishes the mapping.

## Implementation Details

**Production code** (`status_builder.py`):
- Rewrote `_register_sub_agent_namespace(self, namespace, event)` — accepts full event dict, extracts `parent_ids`, scans against active/completed sub-agents
- Added multi-segment gate (`"|" not in namespace`) as fast early-exit for main-graph nodes
- Updated call sites in `process_event` and `_handle_chat_model_stream_event` to pass full event
- Deleted `_pending_sub_agent_ids` from `__init__`, `_handle_sub_agent_start`, `_handle_sub_agent_end`
- Removed `_warned_namespaces` usage from registration method (retained in `_get_execution_context` for downstream routing)

**Tests** (`test_status_builder.py`):
- Deleted `TestNamespaceRegistrationStrategies` (6 tests) and old `TestConcurrentSubAgentNamespaceRegistration` (4 tests) — all tested heuristic strategies that no longer exist
- Created `TestParentIdsNamespaceRouting` — 5 tests covering active match, completed match, empty parent_ids, no-match diagnostics, concurrent agents with shared roots, and idempotency
- Created new `TestConcurrentSubAgentNamespaceRegistration` — 3 tests covering concurrent routing via parent_ids, tool call routing, and sub-agent end isolation
- Updated ~20 test events across 3 existing test classes to use multi-segment namespaces with `parent_ids` field
- Deleted 12 `_pending_sub_agent_ids` assertions

## Benefits

- **Deterministic routing**: No more probabilistic matching — namespace resolution is identity-based and correct by construction
- **Eliminated compensating complexity**: Removed 4 heuristic strategies, 1 FIFO queue, and associated lifecycle management
- **Net deletion**: -56 lines (273 added / 329 deleted) — mostly test rewrite volume; production code is significantly simpler
- **Concurrent sub-agent correctness**: Shared namespace roots no longer cause mis-routing
- **Simpler mental model**: "parent_ids contains the sub-agent run_id" — one sentence replaces a page of strategy documentation

## Impact

- **StatusBuilder**: Simpler namespace resolution path, fewer tracking dictionaries, reduced cognitive load for future maintainers
- **Sub-agent correctness**: Concurrent sub-agents with shared parent nodes now route deterministically
- **Test suite**: Tests now reflect actual production event shapes (multi-segment namespaces, parent_ids present)
- **agent-runner + graphton test suites**: 2,711 tests passing, zero regressions

## Related Work

- **T03 Research** (`tasks/T03_0_research.md`): Confirmed `parent_ids` feasibility, discovered shared namespace roots invalidating root-prefix matching
- **T04** (fingerprint dedup elimination): Prior task in same project that replaced SHA256 dedup with identity-based lookup
- **T02** (tool_call_id capture): Research task that established the callback handler pattern for identity capture

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
