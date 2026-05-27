# Agent Execution ID Propagation Through Error Path and Diagnostics Improvement

**Date**: May 27, 2026

## Summary

Fixed a data plumbing gap where the child agent execution ID was lost when an `agent_call` workflow task failed, making it impossible to navigate from the execution inspector to the underlying agent execution. Also improved Cursor run failure diagnostics by adding structured error logging and reducing noise from non-critical analytics endpoint failures.

## Problem Statement

When the `daily-notification-plan` workflow's `analyze_player_data` task (an `agent_call` using the Cursor harness) failed with "Cursor run failed," two problems compounded:

### Pain Points

- The execution inspector showed only Summary/Error/Events tabs -- no Agent tab appeared, so there was no way to navigate to the child agent execution (`aex_*`) to inspect the actual failure
- The error message was a bare "Cursor run failed" with no detail from the Cursor SDK, and no diagnostic context in the logs to narrow the root cause
- The `[proxy-interceptor] Cursor request failed: POST /aiserver.v1.AnalyticsService/BootstrapStatsig -> proxy status=401` warning polluted logs even though it was a non-critical analytics endpoint

## Solution

Addressed the data gap and diagnostics in three coordinated changes:

1. **Error path propagation**: Introduced `AgentCallError` -- a typed error class that carries `childExecutionId` through the orchestrator -> task builder -> do-executor error chain, ensuring the agent execution ID survives failure
2. **Error tab navigation**: Added a "View Agent Execution" button directly on the Error tab, so users don't have to discover the Agent tab manually when auto-selected to the Error tab on failure
3. **Diagnostic improvements**: Added structured logging to the error classifier and downgraded non-critical Cursor analytics endpoint failures to debug level

## Implementation Details

### AgentCallError propagation chain

New `AgentCallError` class in `types.ts` extends `Error` with a `childExecutionId` property. The propagation path:

- **Orchestrator** (`call-agent-orchestrator.ts`): When the CallAgent activity fails and a `childExecId` was received via the `child_execution_started` signal, wraps the error in `AgentCallError` instead of re-throwing raw
- **Task builder** (`call-agent.ts`): The catch block in `executeAgentCall()` checks for `AgentCallError` and extracts `childExecutionId` for the `agent_call_completed` event (previously hardcoded to `""`)
- **Do-executor** (`do-executor.ts`): The catch block sets `agent_execution_id` on task metadata when a `call:agent` task fails with `AgentCallError`, enabling the snapshot metadata fallback in `buildAgentCall()`

### Error tab navigation

`ErrorTab.tsx` accepts optional `childExecutionId` and `onNavigateToAgentExecution` props. `ExecutionInspector.tsx` passes `detail.agentCall?.childExecutionId` and the navigation callback through. When both are present, a "View Agent Execution" button renders on the Error tab.

### Fetch interceptor noise reduction

Added `NON_CRITICAL_PATHS` list (BootstrapStatsig, LogStatsigExposure, LogStatsigEvent, analytics, telemetry) in `fetch-interceptor.ts`. Failures on these paths log at `console.debug` instead of `console.warn`.

### Error classifier diagnostics

Added a diagnostic log at the entry point of `synthesizeError()` that captures all three error source values (SDK result, stream error, captured rejection) alongside model/mode context. This makes bare "Cursor run failed" errors diagnosable from logs alone.

## Benefits

- Failed `agent_call` tasks now preserve the child execution ID in both the event stream (`agent_call_completed.childExecutionId`) and task metadata (`agent_execution_id`), enabling the Agent tab and Error tab navigation
- Users land on the Error tab on failure (auto-selected) and can immediately click "View Agent Execution" without discovering the Agent tab
- Log noise from non-critical Cursor analytics endpoints is eliminated at default log levels
- Future "Cursor run failed" errors are immediately diagnosable from the structured error-classifier log line

## Impact

- **Direct users**: Workflow execution inspector now provides a clear path to inspect failed agent executions, closing a significant observability gap for the `daily-notification-plan` and similar multi-agent workflows
- **Platform builders**: Changes are in `@stigmer/react` SDK components (`ErrorTab`, `ExecutionInspector`) -- platform builders embedding `<WorkflowExecutionViewer>` get the Error tab navigation automatically
- **Operators**: Cleaner runner logs with non-critical analytics failures at debug level and structured error diagnostics for Cursor run failures

## Related Work

- `_cursor/investigations/missing-agent-tab-in-execution-inspector.md` -- the investigation that identified the root cause
- `2026-05-27-144435-execution-inspector-data-display-ux-overhaul.md` -- preceding UX overhaul of the execution inspector

---

**Status**: Production Ready
**Timeline**: Single session
