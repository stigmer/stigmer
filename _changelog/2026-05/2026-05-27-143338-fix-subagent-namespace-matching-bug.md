# Fix SubAgentTracker Namespace Matching Bug in v3 Streaming Pipeline

**Date**: May 27, 2026

## Summary

Fixed a two-part namespace matching bug in the SubAgentTracker that prevented sub-agent events from being routed correctly in the v3 streaming pipeline. The tracker's registration gate and routing prefix were both based on incorrect assumptions about the LangGraph namespace format, causing all sub-agent events to flow through the parent pipeline instead of being captured in `SubAgentExecution.messages`.

## Problem Statement

After Phase 5 (Session 11) added SubAgentTracker to the v3 streaming pipeline, E2E validation in Session 13 revealed that `SubAgentExecution` protos were consistently empty despite successful sub-agent delegation. Sub-agent text appeared in the parent's `messages[]` array instead of being isolated in per-sub-agent message lists.

### Pain Points

- SubAgentTracker registration gate required `!event.namespace` (empty namespace), but real task tool-started events arrive at depth 1
- Routing prefix used provider tool call IDs (`tools:toolu_01HW...`) but child events arrive with LangGraph Pregel task UUIDs (`tools:<uuid5-hash>`)
- The bug was silent — no errors, no warnings, just misrouted events appearing as parent messages
- Integration tests correctly failed with hard assertions (added in Session 13) but the root cause was in the runner TypeScript code

## Solution

Aligned the SubAgentTracker's namespace handling with how deepagents' `createSubagentTransformer` actually correlates sub-agent events:

1. **Registration gate**: Accept task tool-started at depth 0 (test/edge case) OR depth 1 (real runtime), using `namespaceDepth()` utility
2. **Routing prefix**: Derive from the actual event namespace (the LangGraph tools-node segment) rather than constructing from the provider call ID
3. **Child event matching**: Require depth >= 2 (pipe character present) in `isSubAgentNamespace()` so depth-1 parent tool events stay in the parent pipeline

## Implementation Details

### Root Cause (from LangGraph/deepagents source analysis)

LangGraph's Pregel scheduler assigns each node execution a checkpoint namespace of format `"<nodeName>:<uuid5Hash>"`. When the parent agent's "tools" node executes the "task" tool, it runs within namespace `["tools:<pregelUuid>"]`. The sub-agent then runs deeper: `["tools:<pregelUuid>", "model_request:<innerUuid>"]`.

deepagents' `createSubagentTransformer` handles this by registering BOTH the graph-node segment (`ns[path.length]`) and the provider call ID (`tools:${toolCallId}`) as lookup keys. Child events correlate via `ns[0]` — the graph-node segment.

### Files Changed

| File | Change |
|------|--------|
| `v3-events.ts` | Added `namespaceDepth()` utility function |
| `v3-status-builder.ts` | Fixed registration gate: `namespaceDepth(event.namespace) <= 1`, derives routing prefix from actual event namespace |
| `subagent-tracker.ts` | `onTaskToolStarted()` accepts `routingPrefix` parameter; `isSubAgentNamespace()` requires depth >= 2 |
| `__tests__/subagent-tracker.test.ts` | Updated fixtures to use realistic depth-1 namespaces; added depth-0 compat and depth-1 isolation edge case tests |

### Key Design Decision

The fix is **format-agnostic** — it doesn't hardcode the namespace segment format. It simply uses whatever namespace the task tool-started event arrives with as the routing prefix for matching child events. This makes it resilient to changes in LangGraph's internal UUID generation or node naming.

## Benefits

- Sub-agent executions will now be populated correctly in the `AgentExecutionStatus` proto
- The SDK's `SubAgentSection.tsx` and `MessageThread.buildThreadItems()` will receive proper data for rendering sub-agent UX
- Parent message timeline stays clean (sub-agent text no longer pollutes parent messages)
- Integration tests (`TestAgentExecution_SubAgent_Delegation`, `TestOffline_SubAgent_Delegation`) should now pass

## Impact

- **Runner streaming pipeline**: v3 sub-agent event routing now works correctly
- **SDK/Console**: Sub-agent execution viewer will show messages, tool calls, and status per sub-agent
- **Integration tests**: The hardened assertions from Session 13 should now pass (pending integration run)
- **No v2 regression**: v2 streaming path is completely separate and unaffected

## Related Work

- Session 11 (`9a43b0e9b`): Phase 5 — SubAgentTracker implementation
- Session 13 (`975cb6460`): Sub-agent test hardening that exposed this bug
- Next: Phase 6 (Custom Stigmer Stream Transformers) is now unblocked

---

**Status**: Production Ready (unit tests pass; integration validation pending harness availability)
**Timeline**: Session 14 (1 session, ~30 minutes implementation + testing)
