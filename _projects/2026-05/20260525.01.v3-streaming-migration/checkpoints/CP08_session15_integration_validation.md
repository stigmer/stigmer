# Checkpoint CP08: Session 15 — Integration Validation + Model Migration

**Date**: 2026-05-27
**Session**: 15

## What Was Accomplished

### 1. SubAgentTracker Namespace Fix — Validated End-to-End

The namespace matching fix from Session 14 (commit `46627caa6`) is confirmed working in the full integration environment with real LLM calls.

**Tests passed:**

| Test | Time | Events | Result |
|------|------|--------|--------|
| `TestAgentExecution_SubAgent_Delegation/native` | 53.0s | 408 | Sub-agent COMPLETED, messages populated |
| `TestAgentExecution_SubAgent_McpAccess/native` | 13.1s | — | Sub-agent with MCP tool access COMPLETED |

**Assertions validated:**
- `SubAgentExecution` entries populated (not empty)
- Proto field contract: id, name, subject, timestamps, status, output, messages
- `SubAgentStatus_SUB_AGENT_COMPLETED` when parent execution completes
- `sa.GetMessages() > 0` — sub-agent messages correctly routed via namespace

### 2. Default Model Migrated

**Root cause of initial test failure:** The deprecated model `claude-sonnet-4-20250514` caused sub-agent LLM calls to fail inside deepagents, producing:
```
Error in handler StreamToolsHandler, handleToolError: TypeError [ERR_INVALID_STATE]: Controller is already closed
Unhandled rejection: Error: Subagent researcher failed
```

**Fix:** Updated `setup.ts` default from `claude-sonnet-4-20250514` to `claude-sonnet-4-6`.

Per Anthropic's deprecation schedule:
- `claude-sonnet-4-20250514`: Deprecated April 14, 2026. **Hard retirement June 15, 2026.**
- `claude-sonnet-4-6`: Active, no retirement before February 17, 2027.

### 3. Offline Mock Proxy Gap Documented

`TestOffline_SubAgent_Delegation` showed that the SubAgentTracker registration works (1 sub-agent detected with correct metadata), but sub-agent LLM calls don't route through the mock proxy. The sub-agent failed with "Anthropic API key not found". This is a test infrastructure gap, not a SubAgentTracker bug.

## File Modified

| File | Change |
|------|--------|
| `backend/services/runner/src/activities/execute-deep-agent/setup.ts` | Default model: `claude-sonnet-4-20250514` → `claude-sonnet-4-6` |

## Test Results

- `TestAgentExecution_SubAgent_Delegation/native`: PASS (53.0s)
- `TestAgentExecution_SubAgent_McpAccess/native`: PASS (13.1s)
- Runner dist rebuilt with model change (fingerprint: `80f0c4301f702e2b`)
- Zero deprecation warnings with `claude-sonnet-4-6`

## Remaining Work

1. **Offline mock proxy routing**: Sub-agents in offline tests don't inherit the mock LLM proxy. Separate infra improvement for `UnifiedRunnerManager`.
2. **Broader model migration**: Update remaining `claude-sonnet-4-20250514` references in test fixtures and `context-tracker.ts` before June 15 deadline.
3. **Phase 6**: Custom Stigmer Stream Transformers (now unblocked).

## Investigation Notes

### Why the Deprecated Model Caused Crashes

The deprecated `claude-sonnet-4-20250514` (with 9 deprecation warnings) caused the researcher sub-agent's LLM call to fail inside deepagents. This triggered `createSubagentTransformer`'s `pending.rejectOutput(new Error("Subagent researcher failed"))` at `index.js:7175`, which:

1. Became an unhandled Promise rejection (deepagents doesn't surface this through the stream cleanly)
2. Triggered `StreamToolsHandler.handleToolError` after the stream controller was already closed
3. Crashed the Temporal activity with `Activity task failed`

With `claude-sonnet-4-6`, the sub-agent executes cleanly: 408 events, `run.output` resolves with all expected keys, execution completes in 53 seconds.
