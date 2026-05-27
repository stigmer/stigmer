# Cursor Sub-Agent E2E Validation and Harness-Aware Test Assertions

**Date**: May 27, 2026

## Summary

Validated the full Cursor sub-agent pipeline end-to-end, confirming that `conversationSteps` extraction (Session 18) correctly populates `SubAgentExecution.messages` via the Cursor SDK's task-tool completed result blob. Discovered and fixed a sub-agent name mismatch that prevented test assertions from passing on the cursor harness, introducing harness-aware assertion logic to handle the fundamental difference in how native and cursor harnesses derive sub-agent names.

## Problem Statement

Session 18 implemented `extractConversationSteps()` to parse the Cursor SDK's task-tool completed result into `SubAgentExecution.messages`, but the implementation was only validated with unit tests. The full E2E pipeline — Cursor SDK task event through proto persistence through gRPC query through test assertion — had never been exercised.

### Pain Points

- No live E2E confirmation that the `conversationSteps` blob extraction works in the real Cursor SDK environment
- Integration tests used exact sub-agent name matching (`FindSubAgent(result, "researcher")`) which silently fails for the cursor harness
- The Cursor SDK passes `subagentType: { kind: "unspecified" }` for all sub-agents, so `extractSubagentName()` falls back to the LLM's Task tool `description` arg — a non-deterministic value that never matches the blueprint name

## Solution

Harness-aware assertion pattern (Option A): native path keeps exact name matching via `FindSubAgent`, cursor path uses positional access via new `FindFirstSubAgent` helper with structural assertions (`NotEmpty` on name, full `AssertSubAgentExecution` contract, `messages` populated).

## Implementation Details

**New harness helper** (`test/integration/harness/agent_execution_waiter.go`):
- `FindFirstSubAgent(exec)` — returns `subAgentExecutions[0]` or nil, for use when the sub-agent name is non-deterministic

**Restructured tests** (`test/integration/agent_execution_05_subagent_test.go`):
- `TestAgentExecution_SubAgent_Delegation`: native branch uses `FindSubAgent(result, "researcher")`, cursor branch uses `FindFirstSubAgent(result)` + `assert.NotEmpty(sa.GetName())`
- `TestAgentExecution_SubAgent_McpAccess`: same pattern applied for `"tooluser"` name mismatch
- Shared assertions (both harnesses): `AssertSubAgentExecution`, status `SUB_AGENT_COMPLETED`, `len(sa.GetMessages()) > 0`

## Benefits

- Full E2E confidence that the Cursor sub-agent pipeline works: task event → `trackSubAgentExecution()` → `extractConversationSteps()` → proto persistence → gRPC query → `SubAgentExecution.messages` populated
- Integration tests now correctly exercise both harnesses without false positives from name matching
- Clear architectural documentation of the name mismatch: native harness gets blueprint names from LangGraph namespace metadata, cursor harness gets LLM-determined descriptions

## Impact

- **Integration test suite**: Both sub-agent delegation and MCP access tests now work correctly for cursor harness
- **v3 streaming migration**: Item #13 (E2E validation) complete — all non-deferred items in the migration are now done
- **Runner dist**: Rebuilt with fingerprint `c63d29c036d29861`

## Related Work

- Session 18: `extractConversationSteps()` implementation (`8206c0bbd`)
- Session 17: Original `CursorSubAgentRouter` (disproved in Session 18)
- WA03: Wrong assumption about `agent_id` routing
- CP08: Session 15 integration validation (native harness)

---

**Status**: Production Ready
**Timeline**: Session 19 of v3 streaming migration project
