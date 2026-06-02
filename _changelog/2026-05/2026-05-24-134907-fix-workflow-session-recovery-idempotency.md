# Fix Workflow Session Recovery: Switch to Idempotent Apply

**Date**: May 24, 2026

## Summary

Workflow executions using `agent_call` tasks were failing during Temporal recovery because the runner's session creation depended on parsing resource IDs from gRPC error messages -- a fragile pattern that broke when the cloud Java service's error format diverged from the OSS Go server. Replaced the `create + error-parsing` recovery pattern with the server's built-in `apply` RPC (get-or-create by slug), and aligned the cloud service's duplicate-check error format with the OSS server.

## Problem Statement

The `daily-notification-plan` workflow for Tiny Tactics was failing intermittently: the agent execution would complete successfully (producing full DAU/retention analysis), but the workflow would be marked as failed. The root cause was a Temporal recovery scenario where the `CallAgent` activity re-ran after the agent had already completed, hitting a session-name collision that the runner couldn't recover from.

### Pain Points

- Workflow marked FAILED despite agent execution completing successfully with valid output
- The runner's `extractExistingResourceId()` regex `/(id:\s*(\S+))/` failed on the cloud Java error format which omits resource IDs
- Error message divergence between OSS Go server (`(id: ses_abc)`) and cloud Java service (no ID) violated the cross-edition error contract
- Session recovery depended entirely on parsing error message strings -- inherently fragile

## Solution

Two-pronged fix addressing both the immediate bug and the underlying architectural fragility:

1. **Cloud Java service**: Aligned the `CreateOperationCheckDuplicateStepV2` error message format with the OSS Go server to include `(id: ...)` in ALREADY_EXISTS errors -- a platform-wide improvement benefiting all resource types.

2. **Runner**: Switched `CallAgent` from `client.createSession()` (which requires error-message parsing on conflict) to `client.applySession()` (the server's built-in idempotent get-or-create). This eliminates the fragile error-parsing recovery path entirely.

## Implementation Details

### Runner (stigmer repo)

- **`call-agent.ts`**: Replaced the 15-line `createSession + catch ALREADY_EXISTS + parse ID from error` block with a single `applySession` call. Removed the now-unused `extractExistingResourceId` function. The `apply` RPC returns the session (with ID) whether it's new or existing.
- **`stigmer-client.ts`**: Added `applySession()` method wrapping `SessionCommandController.apply`.
- **Tests**: Rewrote session idempotency tests to verify apply-based behavior. The reproduction test (cloud Java error format without ID) confirmed the bug before the fix.

### Cloud (stigmer-cloud repo)

- **`CreateOperationCheckDuplicateStepV2.java`**: Error message changed from `"{kind} with org '{org}' and slug '{slug}' already exists"` to `"{kind} with slug '{slug}' already exists in org '{org}' (id: {existingId})"` -- matching the Go server format.
- **`CreateOperationCheckDuplicateStepV2Test.java`** (new): Unit tests verifying error message format includes resource ID and matches the Go server contract.

## Benefits

- Workflow recovery now works correctly on both OSS and cloud
- Session handling is architecturally sound: no more error-message parsing for recovery
- The `apply` pattern is the same one the CLI uses for resource management, aligning runner behavior with platform conventions
- Cloud ALREADY_EXISTS errors now include resource IDs, benefiting any future client that needs to recover from duplicates
- Test-first approach: reproduction test confirmed the bug before any fix was applied

## Impact

- **Tiny Tactics workflows**: The `daily-notification-plan` scheduled workflow will no longer fail spuriously during Temporal recovery
- **All cloud users**: Any workflow with `agent_call` tasks that hits Temporal recovery will now recover gracefully
- **Platform error contract**: Cloud Java duplicate-check errors are now aligned with the OSS Go server, as required by the dual-implementation consistency mandate

## Related Work

- `2026-05-23-132626-fix-workflow-agent-call-routing-and-idempotency.md` -- Prior work that introduced deterministic session naming for idempotency but left the cloud error-format gap
- `TestWorkflowAgentCall_IdempotentSessionReuse` integration test -- Existing coverage that will pass more reliably after this fix

---

**Status**: Production Ready
**Timeline**: ~1 hour (investigation + fix + tests)
