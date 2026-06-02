# Checkpoint CP07: Session 14 — SubAgentTracker Namespace Matching Fix

**Date**: 2026-05-27
**Session**: 14
**Commit**: `46627caa6`

## What Was Accomplished

### SubAgentTracker Namespace Matching Bug Fixed

Root cause identified via source analysis of:
- `node_modules/deepagents/dist/index.js` — `createSubagentTransformer` correlation logic
- `node_modules/@langchain/langgraph/dist/pregel/algo.js` — Pregel checkpoint namespace construction
- `node_modules/@langchain/langgraph/dist/pregel/stream.js` — tool event namespace derivation
- `node_modules/@langchain/langgraph/dist/stream/convert.js` — protocol event conversion

**Two bugs fixed:**

1. **Registration gate** (`v3-status-builder.ts:84`): Changed `!event.namespace` to `namespaceDepth(event.namespace) <= 1`. Real task tool-started events arrive at depth 1 with the LangGraph tools-node Pregel segment.

2. **Routing prefix** (`subagent-tracker.ts:76`): Changed from hardcoded `tools:${callId}` (provider tool call ID) to using the actual event namespace as the routing prefix. Child events use the Pregel task UUID as their first namespace segment.

**Supporting changes:**

3. **`isSubAgentNamespace()`**: Added `!namespace.includes("|")` guard to require depth >= 2. Ensures depth-1 parent tool events (same tools-node step) stay in the parent pipeline.

4. **`namespaceDepth()`**: New utility in `v3-events.ts` — counts pipe separators + 1 (or 0 for empty).

5. **Test fixtures**: All 14 existing tests updated to use realistic depth-1 namespaces (`toolsNodeSegment(callId)` = `"tools:pregel_${callId}"`). Two new edge case tests: depth-0 backward compat, depth-1 isolation.

## Root Cause Explanation

### LangGraph Namespace Construction

```
Pregel algo.js:
  checkpointNamespace = "tools" (for the tools node)
  taskId = uuid5([checkpointNamespace, step, name, PULL, [trigger]], checkpoint.id)
  taskCheckpointNamespace = "tools:<taskId>"

stream.js handleToolStart:
  ns = metadata.langgraph_checkpoint_ns?.split("|") ?? []
  // For tool inside tools-node: ns = ["tools:<pregelUuid>"]

convert.js:
  params.namespace = ns  // passed through unchanged
```

### deepagents Sub-Agent Correlation

```javascript
// createSubagentTransformer(path = []):
depth = ns.length - path.length  // = ns.length

// Task tool-started at depth 1: registers TWO keys
toolsNodeToName.set(ns[path.length], subagentName)       // graph segment
toolsNodeToName.set(`tools:${toolCallId}`, subagentName)  // provider ID

// Child events at depth >= 2: matched by ns[path.length] = ns[0]
const parentSegment = ns[path.length]
const subagentName = toolsNodeToName.get(parentSegment)  // uses graph segment
```

### What Our Tracker Was Doing Wrong

| Step | Expected | Actual (before fix) |
|------|----------|---------------------|
| Task tool-started namespace | depth 1: `"tools:<pregelUuid>"` | Guard required depth 0 (empty) |
| Registered prefix | `"tools:<pregelUuid>"` (graph segment) | `"tools:<providerCallId>"` |
| Child event first segment | `"tools:<pregelUuid>"` | Lookup missed: wrong key |
| Result | Route to SubAgentExecution | Fall through to parent messages |

## Files Modified

| File | Lines Changed | Change |
|------|---------------|--------|
| `v3-events.ts` | +13 | `namespaceDepth()` utility |
| `v3-status-builder.ts` | +7/-3 | Registration gate fix + import |
| `subagent-tracker.ts` | +26/-12 | `onTaskToolStarted(callId, args, routingPrefix)`, `isSubAgentNamespace()` depth guard, updated header comments |
| `__tests__/subagent-tracker.test.ts` | +79/-8 | Realistic fixtures + 2 new edge case tests |

## Test Results

- 16/16 SubAgentTracker tests pass
- 17/17 V3StatusBuilder golden tests pass
- 65/65 streaming/normalizer/recorder tests pass
- 428/433 execute-deep-agent tests pass (5 pre-existing Temporal context failures)
- 0 new regressions across full 2077-test runner suite
- Runner dist rebuilt successfully

## Remaining Validation

Integration test execution requires the Java service + Temporal harness:
- `TestOffline_SubAgent_Delegation` (offline harness, mock LLM)
- `TestAgentExecution_SubAgent_Delegation` (online, real Anthropic)
- `TestAgentExecution_SubAgent_McpAccess` (online, real Anthropic)

These tests have hard assertions (`require.NotEmpty(t, subAgents, ...)`) that will confirm the fix works end-to-end.

## Next Steps

1. Run integration tests when harness is available to confirm E2E
2. Phase 6: Custom Stigmer Stream Transformers (now unblocked)
