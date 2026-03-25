# Fix updateStatus Authorization: Custom AuthorizeStep Overriding Proto Config

**Date**: March 25, 2026

## Summary

Fixed an authorization bug in `AgentExecutionUpdateStatusHandler` where a custom `AuthorizeStep` was overwriting the static `resource_id = "stigmer"` from the proto config with the agent execution's metadata ID. This caused all `updateStatus` calls from agent-runner to fail with `PERMISSION_DENIED`, since no identity has `can_update_execution_status` permission on `platform:aex_<id>` — only on `platform:stigmer`.

## Problem Statement

Agent executions were failing with authorization errors when the backend service attempted to update execution status via the `updateStatus` RPC.

### Pain Points

- Error: `Authorization denied: identity_account:ida_... principal does not have can_update_execution_status permission on platform:aex_... object`
- The proto config correctly defines `resource_kind = platform`, `resource_id = "stigmer"`, `permission = can_update_execution_status`
- But the authorization check was hitting `platform:aex_01kmjmfmf8ry7xjm3daggmagbj` instead of `platform:stigmer`
- All agent executions were failing — the execution phase was set to `EXECUTION_FAILED`

## Solution

Removed the custom `AuthorizeStep` inner class from `AgentExecutionUpdateStatusHandler` and replaced it with the standard `commonSteps.authorize` (`AuthorizeRequestStepV2`), which correctly respects the proto config: if `resource_id` is already set in the method options, it uses it as-is without overriding.

## Implementation Details

**File changed**: `AgentExecutionUpdateStatusHandler.java`

- Removed the custom `AuthorizeStep` static inner class (45 lines) that was unconditionally overwriting `authConfig.resource_id` with `target.getMetadata().getId()`
- Replaced `private final AuthorizeStep authorizeStep` with `private final RequestOperationCommonSteps<...> commonSteps`
- Changed pipeline from `.addStep(authorizeStep)` to `.addStep(commonSteps.authorize)`
- Removed unused `RequestAuthorizationService` import
- Cleaned up duplicate Javadoc on `LoadExistingStep`
- Corrected pipeline doc comment from `can_edit` to `can_update_execution_status`

**Root cause**: The custom step was copied from a handler where `resource_id` is derived from the entity (e.g., `update` or `submitApproval`). But `updateStatus` uses a static platform-level permission (`platform:stigmer`), so the override was incorrect.

## Benefits

- Agent executions can now complete successfully — status updates from agent-runner are authorized correctly
- Aligns with the standard authorization pattern used by `AgentExecutionUpdateHandler`, `AgentExecutionDeleteHandler`, and other handlers
- Less custom code to maintain — one fewer inner class

## Impact

- **Agent-runner**: Can now call `updateStatus` to send progressive status updates during execution
- **End users**: Agent executions will no longer fail at the status-update step with `PERMISSION_DENIED`
- **Operators**: Machine accounts with `can_update_execution_status` on `platform:stigmer` will work as intended

## Related Work

- Proto authorization config: `apis/ai/stigmer/agentic/agentexecution/v1/command.proto` (updateStatus RPC)
- Common authorization step: `AuthorizeRequestStepV2.java` — handles static `resource_id` vs `field_path` extraction

---

**Status**: ✅ Production Ready
