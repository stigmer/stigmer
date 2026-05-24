# Fix Tool Call Status Transitions in Cursor Harness

**Date**: May 24, 2026

## Summary

Fixed a defect where tool calls in the Cursor harness (especially MCP tools like "Execute Sql") displayed their result content correctly but the status badge remained stuck as "Running" (spinner) instead of transitioning to "Completed" (checkmark). The root cause was a cross-message lookup bug in `MessageAccumulator`, compounded by the `DeltaEnricher` not promoting status on tool completion deltas and a persist gap after stream finalization.

## Problem Statement

Tool calls executed via the Cursor harness would show results in the UI but the status indicator would remain as a spinner indefinitely. The overall agent execution completed normally — only per-tool-call status tracking was broken. This affected both direct session interactions and workflow `agent_call` tasks.

### Pain Points

- MCP tools (network I/O to databases, APIs) were disproportionately affected due to their longer execution time
- The workflow `ExecutionBadge` compounded the confusion by reporting stale tool names from completed tools
- The native harness (LangGraph) did not have this issue — architectural divergence between the two harnesses was the root cause

## Solution

Brought the Cursor harness tool call tracking into alignment with the native harness's proven `StatusBuilder` + `ExecutionState` pattern, using a defense-in-depth approach across four layers.

## Implementation Details

### FM-1 Fix: Indexed Tool Call Tracking (message-translator.ts)

Added a `toolCallIndex: Map<string, ToolCall>` to `MessageAccumulator`, mirroring `ExecutionState.toolCalls` from the native harness. On `running` events, the new ToolCall proto is registered in the index. On `completed`/`error` events, the lookup uses the index (O(1), cross-message) instead of `findOrCreateLastAiMessage().toolCalls.find()` which only searched the last AI message. The index stores the same object reference — mutations propagate directly to the proto.

**The bug**: when a slow MCP tool's completion event arrived after interleaved assistant text had created a new AI message, `findOrCreateLastAiMessage()` returned the wrong message, the lookup missed, and a duplicate completed tool call was created on the new message while the original stayed RUNNING forever.

### FM-2 Fix: DeltaEnricher Status Promotion (delta-enricher.ts)

Extended `applyTiming()` to promote `TOOL_CALL_RUNNING` -> `TOOL_CALL_COMPLETED` when a `tool-call-completed` delta provides `completedAt`. This is the second-channel safety net — if the stream's completion event is late or dropped, the delta channel still corrects the status. Terminal statuses (FAILED, SKIPPED) are never overwritten.

### FM-3 Fix: Finalization Reconciliation + Persist Gap Closure

Extended `finalize()` with a reconciliation sweep: any tool call still `RUNNING` with evidence of completion (`completedAt` set or `result` non-empty) is promoted to `COMPLETED` with observability logging. Added an unconditional `persistStatus` call immediately after finalize in `execute-cursor/index.ts`, before `run.wait()`, closing the window where the UI saw stale RUNNING statuses.

### FM-4 Fix: Workflow Progress Heuristic (call-agent-status.ts)

Changed `getAgentExecutionProgress` to report `currentToolName` only for tool calls whose status is `TOOL_CALL_RUNNING`. Previously it reported the last tool by iteration order regardless of status, causing the `ExecutionBadge` to show a tool name alongside a running spinner even after all tools had completed.

## Benefits

- Tool calls now correctly transition to "Completed" in the UI for both direct sessions and workflow agent_call tasks
- MCP tools (database queries, API calls) no longer appear stuck
- Workflow execution badges clear the tool name when no tool is actively running
- Defense-in-depth: four independent layers ensure correct status even if the Cursor SDK changes event emission patterns

## Impact

- All Cursor harness executions (direct sessions and workflow `agent_call` tasks)
- MCP tool calls are the primary beneficiary due to their longer execution windows
- No changes to protos, React SDK, gRPC server, or streaming architecture — the fix is entirely in the runner's event processing pipeline

---

**Status**: Production Ready
