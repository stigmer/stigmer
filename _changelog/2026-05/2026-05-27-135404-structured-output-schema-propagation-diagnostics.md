# Structured Output Schema Propagation — Diagnostic Logging & Root Cause Confirmation

**Date**: May 27, 2026

## Summary

Added diagnostic logging at two critical points in the CallAgent pipeline to trace whether `output.schema` survives the Temporal serialization boundary between the workflow sandbox and the activity. Confirmed the root cause of the persistent `daily-notification-plan` structured output failures: the runner's compiled JavaScript (`dist/`) was stale, causing the schema propagation code to not execute.

## Problem Statement

The `daily-notification-plan` workflow consistently failed with "Agent did not return structured output" despite four previous fix sessions. All fixes were in the source code (`src/`) and verified by tests, but the production failure persisted.

### Pain Points

- MongoDB showed `structuredOutputSchema` intermittently missing from agent execution specs
- The same workflow definition produced executions with and without the schema
- Integration tests (91 unit tests + 9 full-stack integration tests) all passed
- Unable to reproduce the issue in the test environment
- Naming scheme divergence (`aex-wf-notification-analyst-*` vs `aex-wf-wex_*-analyze_player_data-*`) correlated with schema presence but root cause was unclear

## Solution

**Diagnostic Logging**: Added two log lines that capture the schema propagation state at the serialization boundary:

1. **Orchestrator side** (workflow sandbox, `call-agent-orchestrator.ts`): Logs `hasOutput`, `hasOutputSchema`, `configKeys`, and `hasTaskName` before sending to the Temporal activity
2. **Activity side** (`activities/call-agent.ts`): Logs `hasOutputSchema`, `configKeys`, `hasOutput`, `outputKeys`, `__taskName`, and `wfExecId` after receiving from Temporal

**Root Cause Confirmation**: The diagnostic logging immediately revealed that after rebuilding the runner and restarting the desktop app, the schema propagated correctly. The previous failures were caused by the desktop app's embedded runner process running stale compiled JavaScript from `dist/` that predated the schema propagation features.

## Implementation Details

### Orchestrator diagnostic (`call-agent-orchestrator.ts`)

```typescript
log.info("[CallAgent orchestrator] sending to activity", {
  taskName, hasOutput, hasOutputSchema, configKeys, hasTaskName,
});
```

### Activity diagnostic (`activities/call-agent.ts`)

```typescript
console.log(
  `[CallAgent] schema propagation diagnostic: ` +
  `hasOutputSchema=${hasOutputSchema}, hasModel=${hasModel}, ` +
  `configKeys=[...], hasOutput=${...}, outputKeys=${...}, ` +
  `__taskName=${...}, wfExecId=${...}`,
);
```

## Benefits

- Immediate visibility into schema propagation state without needing MongoDB queries
- Catches stale runner builds instantly — `hasOutputSchema=false` in logs vs digging through DB
- Distinguishes Temporal serialization failures (orchestrator shows true, activity shows false) from upstream issues (orchestrator already shows false)
- Zero-cost in normal operation (single log line per agent call)

## Impact

- **Observability**: Schema propagation is now visible in runner logs for every workflow agent call
- **Debugging**: Future schema issues can be diagnosed from logs alone, without MongoDB access
- **Operational**: The stale-build root cause is now documented; `make desktop-dev` prevents recurrence

## Related Work

- `2026-05-26-145309-fix-structured-output-callback-and-billing.md` — Fixed callback pipeline
- `2026-05-26-121306-fix-structured-output-extraction-pipeline-v3.md` — Fixed extraction tiers
- `2026-05-25-232524-structured-output-cursor-path-fix.md` — Fixed Cursor path
- `2026-05-25-153147-structured-output-pipeline-test-suite.md` — Test suite

---

**Status**: Production Ready
**Timeline**: Single session
