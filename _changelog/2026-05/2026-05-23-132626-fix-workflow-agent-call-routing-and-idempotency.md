# Fix Workflow agent_call Routing and CallAgent Idempotency

**Date**: May 23, 2026

## Summary

Fixed two critical issues in the workflow execution flow discovered during first live testing of the unified runner with desktop app: (1) child agent executions spawned by workflow `agent_call` tasks were stuck because `StripActivityTaskQueueStep` cleared the sandbox affinity queue override for non-sandbox-token callers, and (2) the `CallAgent` activity created duplicate agent executions on retries due to non-idempotent naming and `maximumAttempts: 3`.

## Problem Statement

When a workflow with `agent_call` tasks ran via the desktop app (manager mode, `STIGMER_ACTIVITY_ROUTING=session`), child agent executions hung indefinitely. The `EnsureThread` activity hit ScheduleToStart timeout after 5 minutes, and the `CallAgent` retry created duplicate sessions and agent executions.

### Pain Points

- Workflow `agent_call` tasks could never complete under session/execution routing (desktop and production)
- Each retry attempt created orphan sessions and agent executions (up to 3 duplicates)
- Integration tests all used `global` routing, hiding this entire class of routing bugs

## Solution

Three-part fix addressing the root cause, preventing duplicates, and adding regression coverage:

1. **StripActivityTaskQueueStep exemption** (stigmer-cloud): When the execution has `parentWorkflowId` set (indicating a workflow-child agent call), preserve the `activityTaskQueue` field instead of stripping it. The TS runner's `CallAgent` activity sets this to the parent's `wfexec:{id}` queue for sandbox affinity.

2. **CallAgent idempotent naming** (stigmer): Generate deterministic session/execution names from `workflowExecutionId + taskName` instead of timestamps. Handle `ALREADY_EXISTS` errors gracefully.

3. **CallAgent retry reduction** (stigmer): Set `maximumAttempts: 1` on the `CallAgent` activity proxy. Async-completion activities with side effects should not be automatically retried at the Temporal level.

4. **Routing integration test** (stigmer): New `TestAgentCallAffinity_ChildRoutesToParentQueue` in the wfexec-routing suite verifies the child agent execution's activity queue memo matches the parent's `wfexec:{id}` queue under session/execution routing.

## Implementation Details

### StripActivityTaskQueueStep (stigmer-cloud)

The `StripActivityTaskQueueStep` in `AgentExecutionCreateHandler` was designed to prevent external API callers from routing executions to arbitrary queues. However, it also stripped the field from desktop runner calls (PKCE auth, not sandbox tokens). The fix adds an exemption when `parentWorkflowId` is set — a strong signal that this is a workflow-initiated child agent call from a legitimate runner context.

### CallAgent Idempotent Naming (stigmer)

Previous naming: `wf-{slug}-{timestamp}` / `aex-wf-{slug}-{Date.now()}`
New naming: `ses-wf-{wfExecId}-{taskName}` / `aex-wf-{wfExecId}-{taskName}`

The `taskName` is threaded from the orchestrator through `__taskName` on the enriched config. Falls back to timestamp-based naming for direct/ad-hoc calls (backward compatible).

### Activity Retry Policy

Changed from `maximumAttempts: 3` with backoff to `maximumAttempts: 1`. The idempotent naming makes it safe to increase this later if needed for transient gRPC failures.

## Benefits

- Workflow `agent_call` tasks now complete under session/execution routing (desktop + production)
- No duplicate agent executions on failures
- Integration test catches this class of routing bugs going forward
- Safe foundation for future retry policy tuning

## Impact

- **Desktop app**: Workflow execution with agent calls now works end-to-end
- **Cloud production**: Same routing config (`session` + `execution`) benefits from the fix
- **Integration tests**: New test in wfexec-routing suite prevents regression

## Related Work

- Unified runner migration (20260518.01)
- Workflow runner TypeScript rewrite (20260519.01)
- Cloud workflow sandbox affinity (20260521.02)
- Pre-deploy integration test expansion (20260521.01)

---

**Status**: ✅ Production Ready
