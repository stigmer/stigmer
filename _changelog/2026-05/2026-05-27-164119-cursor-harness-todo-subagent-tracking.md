# Cursor Harness Todo and Sub-Agent Tracking Improvements

**Date**: May 27, 2026

## Summary

Fixed four interconnected issues in the Cursor harness that caused degraded sub-agent and todo UX: sub-agent messages/todos not populated on `SubAgentExecution`, sub-agent todos overwriting parent plan, `updateTodos` tool calls cluttering the message thread, and todo list instability from flat map semantics. Introduces `agent_id`-based event routing (new `CursorSubAgentRouter`) and two-layer todo tool suppression.

## Problem Statement

The Cursor harness (`execute-cursor/`) treated every `SDKMessage` as a parent-level event regardless of which agent (parent or sub-agent) emitted it. This caused:

### Pain Points

- `SubAgentSection` cards rendered empty content -- no messages, no tool calls, no todos inside sub-agent cards despite the proto and UI supporting them
- Sub-agent `updateTodos` calls with `merge: false` (the default) destroyed the parent's plan in `ExecutionProgress` sidebar, replacing it with a sub-agent's ephemeral plan
- Users saw repeated "updateTodos" tool call entries in the conversation thread, cluttering it with internal state management that should be invisible
- The todo list in the sidebar thrashed on every `updateTodos` call from any scope (parent or sub-agent)

## Solution

Addressed the root cause by introducing event ownership into the Cursor harness:

1. **`agent_id`-based event routing** via new `CursorSubAgentRouter` class -- mirrors the native harness's `SubAgentTracker` role using the Cursor SDK's `agent_id` field instead of LangGraph namespaces
2. **Scoped todo tracking** -- each sub-agent gets its own `TodoTracker` instance writing to `SubAgentExecution.todos`, protecting parent `status.todos`
3. **Two-layer todo tool suppression** -- runner-layer (`SUPPRESSED_TOOL_NAMES` in `MessageAccumulator`) prevents todo tools from entering messages for new executions; SDK-layer (`isInternalTool` + `buildThreadItems` filtering) handles historical data and cross-harness defense-in-depth
4. **Event recorder for discovery** -- env-gated `CURSOR_EVENT_RECORD_DIR` captures raw `SDKMessage` events for validating `agent_id` routing patterns

## Implementation Details

### New Files

- **`subagent-router.ts`** -- `CursorSubAgentRouter` with `agent_id` bootstrap, pending registration FIFO, per-sub-agent `MessageAccumulator` + `TodoTracker`, sync-before-persist, dirty flag lifecycle
- **`cursor-event-recorder.ts`** -- JSONL event recorder gated by `CURSOR_EVENT_RECORD_DIR`, mirrors native `v3-event-recorder.ts` pattern
- **`__tests__/subagent-router.test.ts`** -- 17 unit tests covering routing, concurrent sub-agents, scoped todos, finalization, dirty flag

### Modified Files

- **`message-translator.ts`** -- Added `SUPPRESSED_TOOL_NAMES` set; made `trackSubAgentExecution` public with `SubAgentExecution` return type; fixed `subagentType` parsing to handle both string (`"generalPurpose"`) and object (`{ kind: "generalPurpose", name: "researcher" }`) formats via new `extractSubagentName()` helper
- **`index.ts`** -- Wired `CursorSubAgentRouter` into stream loop with `isSubAgentEvent`/`routeEvent` branching, `syncToProto` before each persist, router dirty flag in persist scheduling
- **`tool-categories.ts`** -- Added `"internal"` to `ToolCategory` union; registered `updateTodos`/`TodoWrite`/`write_todos`; exported `isInternalTool()` utility
- **`MessageThread.tsx`** -- Extended `buildThreadItems` tool-call block to filter `"internal"` tools alongside existing `task` splitting
- **`SubAgentSection.tsx`** -- Added `isInternalTool` filtering to `buildSubAgentThreadItems()`

### Test Coverage

- 17 new `CursorSubAgentRouter` tests (routing, concurrent sub-agents, scoped todos, dirty flag)
- 5 new `MessageAccumulator` tests (todo suppression, `subagentType` object/string parsing)
- 6 new `buildThreadItems` tests (internal tool filtering, mixed tools, empty AI, task+internal combo)

## Benefits

- Parent plan in `ExecutionProgress` sidebar is stable -- no longer overwritten by sub-agent todos
- `SubAgentSection` cards will populate with messages and todos when Cursor SDK streams sub-agent events (pending `agent_id` validation with real event data)
- No more "updateTodos" clutter in the conversation thread for new or historical executions
- `subagentType` name extraction correctly handles the Cursor SDK's object format

## Impact

- **Cursor harness** (`execute-cursor/`): All changes are in this activity module
- **React SDK** (`@stigmer/react`): `tool-categories.ts`, `MessageThread.tsx`, `SubAgentSection.tsx` -- benefits both web and desktop consoles plus all platform builder integrations
- **Native harness**: Unaffected; SDK-layer `write_todos` filtering benefits native executions retroactively
- **No proto changes**: All proto fields (`SubAgentExecution.messages`, `SubAgentExecution.todos`) already existed

## Related Work

- v3 Streaming Migration (Sessions 11-14): Native `SubAgentTracker` with namespace-based routing
- Feb 2026 CLI Todo Blocks: Original `TodoItem` proto and streaming pipeline
- Mar 2026 Sub-Agent Todo Visibility: `SubAgentExecution.todos` proto field addition
- May 2026 Cursor TodoTracker: Initial `TodoTracker` for Cursor harness

---

**Status**: Production Ready (pending `agent_id` routing validation with live event recording)
**Timeline**: Session 17 of v3-streaming-migration project
