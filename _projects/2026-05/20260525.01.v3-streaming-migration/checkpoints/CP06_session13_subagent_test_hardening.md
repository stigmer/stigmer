# Checkpoint CP06: Session 13 — Sub-Agent Test Hardening + E2E Pipeline Gap

**Date**: 2026-05-27
**Session**: 13

## What Was Accomplished

### 1. Sub-Agent Test Hardening (Code Complete)

Converted all soft-logging assertions in sub-agent integration tests to hard assertions with LLM non-determinism retry.

**Harness additions** (`test/integration/harness/agent_execution_waiter.go`):
- `AssertSubAgentExecution(t, sa)` — validates full proto field contract (id, name, subject, started_at, completed_at, output/error per status)
- `FindSubAgent(exec, name)` — find SubAgentExecution by name
- `HasSubAgentDelegation(exec)` — check if any SubAgentExecution present
- `LogSubAgentExecutions(t, exec)` — diagnostic logging of all sub-agent details

**Online tests** (`test/integration/agent_execution_05_subagent_test.go`):
- `TestAgentExecution_SubAgent_Delegation`: retry loop (2 attempts), require delegation, assert researcher COMPLETED + messages > 0
- `TestAgentExecution_SubAgent_ParentCancelCascade`: require sub-agents exist, assert CANCELLED status (time.Sleep flagged as TODO)
- `TestAgentExecution_SubAgent_McpAccess`: retry loop (2 attempts), require tooluser delegation + COMPLETED

**Offline test** (`test/integration-offline/subagent_offline_test.go`):
- `TestOffline_SubAgent_Delegation`: require sub-agent executions populated (deterministic mock, no retry)

### 2. E2E Pipeline Gap Discovered

The hardened tests exposed a real bug: `SubAgentExecution` protos are consistently empty across all runs despite successful delegation.

**Investigation results:**

| Component | Status | Evidence |
|-----------|--------|----------|
| Runner dist | Fresh | Rebuilt today, SubAgentTracker in dist |
| Stream version | v3 | Runner log: `streamVersion=v3` |
| Sub-agent compilation | Working | Log: `Compiled sub-agent 'researcher'` |
| LLM delegation | Working | Parent messages show `tool_call=task` |
| Java UpdateStatus handler | Correct | Explicit `subAgentExecutions` merge logic |
| Java GET query | Correct | Full document, no field projection |
| **SubAgentTracker** | **FAILING** | 0 SubAgentExecution entries consistently |

**Root cause**: `SubAgentTracker.isSubAgentNamespace()` does not match the namespace format produced by real deepagents runtime. The tracker was built and unit-tested against assumed namespace patterns (`tools:<callId>|...`), but the actual events from the deepagents runtime use a different format. Sub-agent events silently flow through the parent pipeline, appearing as parent messages instead of being routed to `SubAgentExecution.messages`.

**Evidence**: Diagnostic output shows sub-agent responses appearing in the parent's `messages[]` array (msg[2], msg[3]) rather than in `SubAgentExecution.messages`.

## Files Modified

| File | Change |
|------|--------|
| `test/integration/harness/agent_execution_waiter.go` | +4 assertion/utility functions |
| `test/integration/agent_execution_05_subagent_test.go` | All 3 tests hardened with retry + structural assertions |
| `test/integration-offline/subagent_offline_test.go` | Hard assertions on SubAgentExecution |

## Compilation Verification

- `go vet -tags integration ./...` passes for both `test/integration/` and `test/integration-offline/`
- `gofmt` clean on all modified files

## Next Steps

1. **FIX SubAgentTracker namespace matching**: Enable V3 event recording (`V3_EVENT_RECORD_DIR`), run a sub-agent delegation, capture the actual namespace format from deepagents, fix `isSubAgentNamespace()` / `extractFirstSegment()` pattern matching
2. Once fixed, re-run the hardened tests — they should pass
3. Then proceed to Phase 6 or other deferred items
