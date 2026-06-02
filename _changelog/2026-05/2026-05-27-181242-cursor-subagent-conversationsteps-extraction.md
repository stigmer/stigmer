# Cursor Sub-Agent: Replace Dead `agent_id` Router with `conversationSteps` Extraction

**Date**: May 27, 2026

## Summary

Empirical validation disproved the hypothesis that the Cursor SDK streams sub-agent events with distinct `agent_id` values. The SDK returns sub-agent work as a complete blob in the task tool's completed result. Replaced the dead `CursorSubAgentRouter` with `extractConversationSteps()` which parses the task tool result into `SubAgentExecution.messages`, and fixed sub-agent naming to use the `description` field as fallback.

## Problem Statement

Session 17 built `CursorSubAgentRouter` based on the assumption that sub-agent events would stream with a different `agent_id` than the parent. This was never validated against real Cursor SDK behavior.

### Pain Points

- `CursorSubAgentRouter` was 148 lines of dead code with 274 lines of tests testing behavior that doesn't exist
- Sub-agent naming returned "unspecified" because the SDK uses `{ kind: "unspecified" }` for all sub-agents
- The streaming loop in `index.ts` had unnecessary complexity from the `isSubAgentEvent` branching
- Integration tests for Cursor sub-agent delegation were failing because the naming didn't match

## Solution

1. Ran `TestAgentExecution_SubAgent_Delegation/cursor` with `CURSOR_EVENT_RECORD_DIR` to capture raw SDK events
2. Analyzed 1,034 events across 2 runs — confirmed only 1 `agent_id` (Outcome 3: sub-agent events don't flow)
3. Discovered sub-agent data is in `result.value.conversationSteps` of the task tool's completed event
4. Replaced the dead router with result-blob extraction

## Implementation Details

**New: `extractConversationSteps()`** in `message-translator.ts`
- Parses the Cursor SDK's `ConversationStep` discriminated union: `thinkingMessage`, `assistantMessage`, `toolCall`
- Handles both typed format (`type` field) and legacy format (direct key names)
- Defensively skips unknown step types for forward compatibility with future SDK versions
- Called from `trackSubAgentExecution()` when the task tool completes

**Fixed: `extractSubagentName()`**
- Treats `kind: "unspecified"` as absent (the SDK's default for all sub-agents)
- Falls back to the `description` field which is always populated by the SDK

**Removed: `CursorSubAgentRouter`**
- Deleted `subagent-router.ts` (148 lines) and `subagent-router.test.ts` (274 lines)
- Removed all wiring from `index.ts`: instantiation, `isSubAgentEvent` branching, `registerSubAgent`, `finalizeSubAgent`, `syncToProto`, `markPersisted`

**Simplified: `index.ts` streaming loop**
- Removed the `if/else` branch for sub-agent vs parent events
- All events flow through the parent `MessageAccumulator`; task tool calls trigger `trackSubAgentExecution` which handles extraction
- Net -30 lines in the streaming loop

## Benefits

- Eliminated 422 lines of dead code and tests for non-existent behavior
- Sub-agent messages now populate from the actual data the SDK provides
- Streaming loop is simpler and easier to maintain
- Sub-agent naming uses meaningful descriptions instead of "unspecified"

## Impact

- **Runner**: Cleaner streaming pipeline, fewer moving parts
- **UI**: `SubAgentExecution.messages` will now populate for Cursor harness (previously always empty)
- **Tests**: 12 new unit tests covering extraction and naming; 77/77 execute-cursor tests pass

## Related Work

- Session 17: Built the (now-removed) `CursorSubAgentRouter`
- Session 11/14: Native harness sub-agent tracking via namespace routing (unaffected)
- WA03: Wrong assumption documented in project knowledge base

---

**Status**: Production Ready
**Timeline**: Session 18 (single session)
