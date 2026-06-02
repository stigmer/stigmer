# Phase 5: Sub-Agent Execution Tracking Pipeline

**Date**: May 27, 2026

## Summary

Implemented the SubAgentTracker that populates `SubAgentExecution` protos during v3 streaming in the ExecuteDeepAgent activity. Sub-agent messages now route to dedicated per-sub-agent message lists instead of polluting the parent's flat timeline, enabling the existing SDK `SubAgentSection` component to render delegation cards automatically.

## Problem Statement

The v3 streaming pipeline (Phases 0-3) treated sub-agent events as namespace-separated messages within the parent's flat `status.messages` array. The proto model already defined `SubAgentExecution` with its own `messages`, `todos`, and lifecycle fields, and the SDK's `SubAgentSection.tsx` already rendered this data — but the runner never populated it for the native (deepagents) harness. Only the Cursor harness had this capability via `trackSubAgentExecution()` in `message-translator.ts`.

### Pain Points

- Sub-agent internal messages (thinking, tool calls, intermediate responses) polluted the parent conversation timeline
- No lifecycle tracking (started/completed/failed/cancelled) for sub-agent delegations
- SDK's delegation tree UI was data-starved for native harness executions
- No per-sub-agent tool call visibility for debugging failed delegations

## Solution

Created a `SubAgentTracker` class that correlates `task` tool invocations with namespace-scoped protocol events, routing sub-agent activity to dedicated `SubAgentExecution` proto instances while keeping the parent timeline clean.

## Implementation Details

**New file: `subagent-tracker.ts`**
- `SubAgentTracker` class with per-sub-agent state tracking
- Namespace correlation via `tools:<callId>` prefix matching (derived from deepagents `createSubagentTransformer` source analysis)
- Per-sub-agent message accumulation, tool call tracking, thinking block handling
- Lifecycle management: IN_PROGRESS → COMPLETED/FAILED/CANCELLED
- Subject and name extraction from task tool args (`subagent_type`, `description`)

**Modified: `v3-status-builder.ts`**
- Sub-agent event routing: `task` tool_started triggers tracker + parent tool call creation
- Namespace check intercepts sub-agent-scoped events before parent routing
- `syncSubAgentExecutions()` API for streaming orchestrator
- `cancelSubAgents()` for parent cancellation propagation

**Modified: `streaming-v3.ts`**
- Sync sub-agent executions before each status persist
- Cancel sub-agents on parent cancellation (before returning paused state)
- Final sync before function exit

**Key design decisions:**
- Parent-only routing: sub-agent messages live exclusively in `sub_agent_executions[].messages`
- Correlation by tool_call_id (not namespace name) — uniqueness guaranteed per invocation
- Internal namespace resolution: sub-agent graph node names (`model_request`) flatten to canonical `""` key
- No `run.subagents` consumption — raw protocol events provide all needed data per DD01

## Benefits

- Sub-agent delegation visible as cards in the UI (immediately, no SDK changes needed)
- Parent timeline is clean: shows delegation intent (task tool call) and result, not internal noise
- Per-sub-agent debugging: messages, tool calls, and errors scoped to each delegation
- Cancellation propagation: all active sub-agents marked CANCELLED when parent is cancelled
- Server and SDK already handle this data — zero changes needed downstream

## Impact

- **Runner**: 4 files changed (1 new module, 1 new test, 2 modified)
- **Server**: No changes (replace semantics already implemented)
- **SDK**: No changes (SubAgentSection already renders this data)
- **Proto**: No changes (SubAgentExecution already defined)
- **Tests**: 14 new unit tests, 86/86 Phase 5 tests pass, 0 regressions

## Related Work

- Phase 0-3: v3 streaming migration foundation (Sessions 1-8)
- ExecuteCursor `trackSubAgentExecution()`: existing pattern adapted for native harness
- `SubAgentSection.tsx` + `MessageThread.buildThreadItems()`: SDK rendering (already implemented)

---

**Status**: Production Ready
**Timeline**: 1 session (Phase 5 of v3 streaming migration project)
