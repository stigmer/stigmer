# Agent Call Live Progress -- Pipeline Fix and Periodic Progress

**Date**: May 24, 2026

## Summary

Fixed the broken agent call live experience pipeline where `childExecutionId` never reached the frontend event store, leaving the execution viewer stuck on "Waiting for agent to start..." for the entire duration of agent_call tasks. Added periodic progress reporting from the runner orchestrator, live agent activity badges on graph nodes, approval tool name wiring, and an Approvals tab in the bottom panel.

## Problem Statement

When a workflow executes an `agent_call` task, the execution viewer showed nothing happening -- just "Running" on the graph node and a spinner in the inspector. This was despite the "Agent Call Live Experience" session having implemented the backend signals and frontend components.

### Pain Points

- `AgentCallTab` showed "Waiting for agent to start..." forever because `childExecutionId` was empty
- Graph nodes showed generic "Running" badge with no indication of agent activity
- `approvalToolName` was defined on `CanvasTaskNodeData` and supported by `ExecutionBadge` but never populated
- No periodic progress updates -- only one empty progress event emitted when the child ID first became known
- Approval cards only visible in the inspector's Approval tab, not in the bottom panel

## Solution

Three-phase fix: pipeline repair (frontend), periodic progress (runner), and approval surfacing (bottom panel).

## Implementation Details

### Phase 1: Fix the Broken Pipeline (SDK -- 8 files)

**Root cause**: The event store's `deriveTaskStates()` had no `case "agentCallProgress"` handler. The `agent_call_started` event always carries `childExecutionId: ""` (ID not known at emit time). The `agent_call_progress` event from the orchestrator carries the real ID but was silently ignored.

- **Event store** (`workflow-execution-event-store.ts`): Added `agentCallProgress` handler that propagates `childExecutionId`, `currentToolName`, `messagesCount`, `toolCallsCount`. Extended `DerivedTaskState` with `agentSlug`, `currentToolName`, `messagesCount`, `toolCallsCount`.
- **derive-task-detail.ts**: Fixed `buildAgentCall()` to read `childExecutionId` from `agentProgress` bucket as fallback when `agentStarted` has empty ID. Added `childExecutionId` to the progress bucket type.
- **useWorkflowExecutionGraph.ts**: Wired `agentActivity` from `DerivedTaskState` to `CanvasTaskNodeData` on running agent_call nodes. Wired `approvalToolName` from `execution.status.pendingApprovals` matched by `childAgentExecutionId`.
- **ExecutionBadge.tsx**: Added `AgentActivityInfo` type and `agentActivity` prop. Running agent_call nodes show current tool name or message count instead of generic spinner.
- **workflow-graph-conversions.ts**: Added `agentActivity` field to `CanvasTaskNodeData`.
- **WorkflowNode.tsx**: Passes `data.agentActivity` to `ExecutionBadge`.

### Phase 2: Periodic Progress from Runner (2 files)

Used Approach A (orchestrator timer with `condition(fn, "15s")` timeout):

- **call-agent-status.ts**: Added `GetAgentExecutionProgress` local activity that queries `AgentExecution.Get()` and extracts message count, last tool name, and token consumption.
- **call-agent-orchestrator.ts**: Restructured the main loop with `condition(fn, PROGRESS_POLL_INTERVAL)`. On timeout, fetches child progress via the new activity and emits `agent_call_progress` with real data. Extracted `emitProgress()` helper.

### Phase 3: Approval Cards in Bottom Panel (1 file)

- **WorkflowExecutionViewer.tsx**: Added "Approvals" tab to `ExecutionBottomPanel`. Tab appears only when `pendingApprovals.length > 0`, auto-switches when new approvals arrive, returns to Waterfall when resolved. Reuses existing `WorkflowExecutionApprovalCard` components.

### Tests (4 files)

- 8 new tests in `agent-call-live-experience.test.ts` (event store handler, badge logic)
- 1 new test in `derive-task-detail.test.ts` (childExecutionId fallback from progress bucket)
- Updated `derive-execution-overlays.test.ts` and `execution-graph.test.ts` for `DerivedTaskState` shape change

## Benefits

- Agent call tasks now show live progress: current tool name, message count, token consumption
- `AgentCallTab` immediately shows live `MessageThread` transcript when childExecutionId arrives (no more eternal spinner)
- Graph badges show what the agent is doing ("web-search", "12 msgs") instead of generic "Running"
- Approval tool names visible on graph badges during `waiting_approval` state
- Approval cards surfaced in bottom panel for quick action without navigating to inspector
- Progress updates every ~15s so the graph and waterfall stay current

## Impact

- **Desktop + Web app users**: Both consume the same SDK `WorkflowExecutionViewer` -- zero client-app changes needed (DD-016)
- **Platform builders**: New `agentActivity` and `approvalToolName` fields on `CanvasTaskNodeData` + `AgentActivityInfo` type exported from SDK
- **Runner**: Periodic progress polling adds ~1 gRPC call per 15s per running agent_call task (best-effort, non-blocking)

## Related Work

- Agent Call Live Experience (earlier session today -- laid the backend foundation)
- T05: Runtime Inspector Panel (foundation this builds on)
- Runner Task Status Enrichment (agent_call_started/completed events)

---

**Status**: Production Ready (requires rebuild of runner + SDK)
**Timeline**: Single session implementation
