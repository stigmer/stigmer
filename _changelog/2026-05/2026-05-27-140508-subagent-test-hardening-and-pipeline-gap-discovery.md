# Sub-Agent Test Hardening and Pipeline Gap Discovery

**Date**: May 27, 2026

## Summary

Hardened all sub-agent integration tests from soft-logging assertions to hard structural assertions with LLM non-determinism retry. Added reusable `AssertSubAgentExecution` harness helper for full proto field contract validation. E2E validation immediately exposed a SubAgentTracker namespace matching bug — the tracker silently fails to detect real deepagents event namespaces, causing all tests to correctly fail.

## Problem Statement

The sub-agent integration tests (`agent_execution_05_subagent_test.go`) used soft assertions (`t.Logf` / `t.Log`) that silently passed even when no `SubAgentExecution` data was returned. This meant the tests were not actually testing the sub-agent pipeline — they were no-ops that gave false confidence.

### Pain Points

- `TestAgentExecution_SubAgent_Delegation` passed without any sub-agent data
- `TestAgentExecution_SubAgent_ParentCancelCascade` only checked active sub-agents (never verified they existed)
- `TestAgentExecution_SubAgent_McpAccess` logged sub-agent data but never asserted on it
- Offline golden test (`TestOffline_SubAgent_Delegation`) logged "not yet populated" and moved on
- `AssertSubAgents` harness helper existed but was never called from any test

## Solution

Converted all soft assertions to hard structural assertions following the established `TestAgentExecution_ToolCall_ProtoFieldContract` pattern from `agent_execution_13`, with retry loops for LLM non-determinism.

## Implementation Details

**Harness helpers** (`test/integration/harness/agent_execution_waiter.go`):
- `AssertSubAgentExecution(t, sa)` — validates full proto contract: id, name, subject, started_at, completed_at, and status-dependent output/error fields
- `FindSubAgent(exec, name)` — lookup by name, returns nil if not found
- `HasSubAgentDelegation(exec)` — boolean check for any SubAgentExecution presence
- `LogSubAgentExecutions(t, exec)` — diagnostic dump of all sub-agent fields

**Online tests** — all three tests now use retry loops (2 attempts, matching `_13` pattern):
- Delegation: require researcher sub-agent COMPLETED with messages > 0
- Cancel cascade: require sub-agents exist, assert CANCELLED status
- MCP access: require tooluser sub-agent COMPLETED

**Offline test** — deterministic mock LLM, no retry needed:
- `require.NotEmpty` on sub-agent executions (mock always delegates)

## Benefits

- Tests now catch real pipeline gaps (proven immediately by discovering the namespace matching bug)
- Reusable assertion helper prevents future tests from using soft assertions
- Retry pattern handles LLM non-determinism without masking infrastructure bugs
- Diagnostic logging provides full field dump on failure for debugging

## Impact

The hardened tests exposed a real bug: the SubAgentTracker's `isSubAgentNamespace()` fails to match the namespace format produced by the real deepagents runtime. Sub-agent events silently flow through the parent pipeline, appearing as parent messages instead of being routed to `SubAgentExecution.messages`. This was confirmed across 6+ runs, both native and cursor harnesses.

Investigation ruled out stale runner dist (rebuilt today) and Java persistence issues (explicit merge logic, full-document storage confirmed). The fix is isolated to namespace pattern matching in `subagent-tracker.ts`.

## Related Work

- Session 11 (`9a43b0e9b`): Added SubAgentTracker to v3 streaming pipeline (86/86 unit tests pass)
- Session 12 (`89a3340ac`): Schema propagation tests
- Next: Fix SubAgentTracker namespace matching (item #7 in project tracker)

---

**Status**: Production Ready (test code) / Blocked (tests correctly fail pending runner fix)
**Commit**: `975cb6460`
