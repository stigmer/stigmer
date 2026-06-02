# Stale Runner Build Guard and Error Propagation Fix

**Date**: May 27, 2026

## Summary

Added a build fingerprint mechanism to detect stale runner builds at startup, fixed the agent execution naming pattern to survive Temporal serialization reliably, and fixed the Java service's error handling to preserve the runner's rich execution status (AI messages, classified errors, tool calls) instead of overwriting it with a minimal status on failure.

## Problem Statement

Three interrelated issues were causing silent failures and poor error diagnostics in the workflow execution pipeline:

### Pain Points

- The embedded runner process could silently run stale compiled JavaScript from `dist/` after source code changes, with no mechanism to detect the mismatch
- Agent execution naming fell through to the timestamp-based fallback pattern (`aex-wf-{agent}-{timestamp}`) because `__stigmer_execution_id` was lost at the Temporal serialization boundary, breaking session reuse on retry
- When an agent execution failed, the Java service's catch block overwrote the runner's persisted MongoDB status (classified errors, AI messages, tool calls) with a minimal 2-message status, destroying all diagnostic detail

## Solution

**Build fingerprint guard**: At build time, compute a SHA-256 hash of all `src/**/*.ts` files and write it to `dist/.build-fingerprint`. At runner startup, compare the stored hash against the current source. If they diverge, log a prominent warning. Best-effort, never blocks startup.

**Naming resilience**: Enrich `__wfExecId` onto the Temporal activity config alongside `__taskName` in the orchestrator. The activity reads the config-enriched value first, falling back to `runtimeEnv`. This makes naming deterministic regardless of which Temporal serialization path delivers the workflow execution ID.

**Error propagation fix**: In the Java service's catch block, send only `phase=EXECUTION_FAILED` with zero messages, so the merge logic flips the phase without triggering the replace-all message behavior. The runner's already-persisted classified error, AI messages, and tool calls survive in MongoDB.

## Implementation Details

### Build fingerprint (3 files, stigmer OSS)

- `backend/services/runner/scripts/build-fingerprint.js`: Generates `dist/.build-fingerprint` with `{hash, builtAt, fileCount}`
- `backend/services/runner/package.json`: Build script now runs `tsc && node scripts/build-fingerprint.js`
- `backend/services/runner/src/main.ts`: `checkBuildFreshness()` at the top of `main()`, runs before config loading. Computes current src hash and compares with stored fingerprint.

### Naming fix (2 files, stigmer OSS)

- `backend/services/runner/src/workflows/call-agent-orchestrator.ts`: Added `__wfExecId: input.workflowExecutionId` to enriched config
- `backend/services/runner/src/activities/call-agent.ts`: Reads `__wfExecId` from config first, falls back to `runtimeEnv["__stigmer_execution_id"]`

### Error propagation fix (1 file, stigmer-cloud)

- `InvokeAgentExecutionWorkflowImpl.java`: Catch block now sends phase-only status update, preserving runner messages

### Tests (1 file, stigmer OSS)

- `call-agent-contracts.test.ts`: Two new tests verifying config-enriched `__wfExecId` takes priority and works standalone

## Benefits

- Stale runner builds are instantly detectable from runner logs without production failures or MongoDB queries
- Agent execution naming is deterministic and survives all Temporal serialization paths
- Failed agent executions preserve the full conversation history and classified error for debugging

## Impact

- **Observability**: Stale build warnings appear in runner stderr at startup, before any workflows execute
- **Reliability**: Naming resilience prevents session fragmentation and enables proper retry reuse
- **Debugging**: Failed executions retain all AI messages, tool calls, and classified error categories instead of being replaced with generic system messages

---

**Status**: Production Ready
**Timeline**: Single session
