# Sub-Agent Test Coverage Completion

**Date**: March 10, 2026

## Summary

Added 15 new tests across Python and Go to fill the specific test coverage gaps left by PRs 2–4 of the sub-agent execution streamlining project. Tests exercise multi-step feature interactions (approval lifecycle, concurrent sub-agents, finalization, alias resolution) and verify previously untested CLI rendering behaviors (cancelled status, output display, approval name prefix, JSON payloads).

## Problem Statement

PRs 2–4 introduced ~20 unit tests alongside their features, but two categories of gaps remained:

### Pain Points

- No scenario-level tests exercised *interactions* between sub-agent features (e.g., approval sync → clear → complete as a single flow)
- CLI rendering for `SUB_AGENT_CANCELLED` status had zero test coverage
- Sub-agent output display in collapsed/expanded views was untested
- Approval prompt sub-agent name prefix (`Sub-agent 'name': ...`) was only tested for gutter wrapping, not the prefix itself
- JSON event payloads for `sub_agent_started` and `sub_agent_completed` had no field-level assertions

## Solution

Added tests at the same abstraction level as existing tests — `StatusBuilder` with mock events in Python, `renderCommittedItem` / `renderInline` / `renderJSON` in Go — rather than introducing new test infrastructure.

## Implementation Details

### Python: `TestSubAgentScenarios` (4 tests)

| Test | Coverage |
|------|----------|
| `test_approval_lifecycle_within_sub_agent` | Full round-trip: start → tool → PendingApproval dual-surface → clear → complete with output |
| `test_concurrent_sub_agents_interleaved_events` | Two sub-agents with interleaved tools, verify isolation, sequential completion, late-event routing |
| `test_finalization_clears_sub_agent_pending_approvals` | `finalize_active_sub_agents` with pending approval — verifies terminal status without implicit approval cleanup |
| `test_remove_from_pending_resolves_run_id_aliases` | `_run_id_aliases` reconciliation path: temp_id → real_id resolution in `_remove_from_pending` |

### Go: History rendering (4 tests)

- `TestRenderSubAgentBlockItem_Collapsed_Cancelled` — `⊘ Cancelled` badge
- `TestRenderSubAgentBlockItem_Collapsed_WithOutput` — dim output suffix
- `TestRenderSubAgentBlockItem_Expanded_WithInputAndOutput` — Prompt/Result ordering around children
- `TestRenderSubAgentBlockItem_Expanded_Cancelled` — cancelled footer in expanded view

### Go: Approval (1 test)

- `TestHandleApproval_SubAgentNameInPrompt` — `Sub-agent 'code-reviewer'` prefix in output

### Go: JSON payloads (3 tests)

- `TestJSONRenderer_SubAgentStartedPayload` — `id`, `name`, `description` field assertions
- `TestJSONRenderer_SubAgentCompletedPayload` — `id`, `status` (enum string), `tool_count`, `output`
- `TestJSONRenderer_SubAgentCompletedPayload_Cancelled` — `SUB_AGENT_CANCELLED` string rendering

### Go: Pipeline (3 tests)

- `TestInlineRenderer_SubAgentFailure` — `✗ Failed` badge + history status
- `TestInlineRenderer_SubAgentCancelled` — `⊘ Cancelled` badge
- `TestInlineRenderer_SubAgentWithOutput` — output captured in `saBlock.output`

## Benefits

- Complete test coverage for all sub-agent rendering states (completed, failed, cancelled)
- Scenario-level confidence that feature interactions hold across realistic event sequences
- JSON consumers can rely on documented payload contracts
- Future refactors of sub-agent lifecycle have regression protection

## Impact

- 246 Python tests pass (was 242 before this project)
- Full Go `cmd/stigmer/root` package green
- No new test infrastructure needed — all tests use existing patterns and fixtures
- Completes the 5-PR sub-agent execution streamlining project

## Related Work

- [Sub-Agent Execution Proto Enhancements](2026-03-10-040540-sub-agent-execution-proto-enhancements.md) (PR1)
- [Sub-Agent Subject Simplification and Approval Dual-Surfacing](2026-03-10-043512-sub-agent-subject-simplification-and-approval-dual-surfacing.md) (PR2)
- [Sub-Agent Lifecycle Hardening](2026-03-10-082456-sub-agent-lifecycle-hardening.md) (PR3)
- [CLI Sub-Agent Rendering Improvements](2026-03-10-084417-cli-sub-agent-rendering-improvements.md) (PR4)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
