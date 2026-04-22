# Migrate updateStatus Authorization from Platform Operator to User-Level

**Date**: April 22, 2026

## Summary

Migrated the `updateStatus` RPC authorization for both agent execution and workflow execution from the platform-level `can_update_execution_status` operator permission to standard user-level `can_edit` on the execution resource. This aligns the authorization model with the new runner architecture where runners authenticate as the triggering user via JWT, not as a privileged machine account.

## Problem Statement

The `updateStatus` RPC was gated on `platform:stigmer#can_update_execution_status`, a permission only platform operators (machine accounts) could satisfy. This was designed for the old model where a shared agent-runner pool authenticated with `MACHINE_ACCOUNT_CLIENT_ID/SECRET` and used `on_behalf_of` impersonation.

### Pain Points

- The runner-as-resource project removes machine accounts entirely — runners authenticate as the triggering user
- A user-scoped runner with only a user JWT cannot pass a platform-level operator check
- The `updateStatus` RPC was the only write operation on `AgentExecutionCommandController` using platform-level auth — every other RPC (`update`, `delete`, `cancel`, `terminate`, `pause`, `resume`, `recover`, `submitApproval`) already used `can_edit` on the execution
- The `can_update_execution_status` permission existed solely for this purpose and was unused by any other code path

## Solution

Changed the authorization config on both `updateStatus` RPCs to use the same `can_edit` permission pattern as all other write operations on the execution resource. The user who created the execution (through session ownership) inherently has `can_edit`, so the runner — authenticating as that user — can update execution status without any special privileges.

## Implementation Details

### Proto Changes (stigmer repo)

**`agentexecution/v1/command.proto`** — `updateStatus` RPC options changed:
```
- resource_kind = platform
- permission = can_update_execution_status
- resource_id = "stigmer"
+ resource_kind = agent_execution
+ permission = can_edit
+ field_path = "execution_id"
```

**`workflowexecution/v1/command.proto`** — Same pattern:
```
- resource_kind = platform
+ resource_kind = workflow_execution
  (same permission and field_path changes)
```

**`iam/v1/enum.proto`** — Removed `can_update_execution_status = 19` from `IamPermission` enum entirely (no users, clean removal).

### FGA Model Changes (stigmer-cloud repo)

- **`platform.fga`**: Removed the `can_update_execution_status: operator` permission definition and its comment block
- **`agent_execution.fga`** and **`workflow_execution.fga`**: Removed stale comments referencing the old platform-level gating

### Java Handler Updates (stigmer-cloud repo)

- **`AgentExecutionUpdateStatusHandler.java`**: Updated pipeline comment to reflect `can_edit` on `agent_execution`
- **`PlatformConstants.java`**: Removed `can_update_execution_status` from Javadoc

### What Did NOT Change

- **Go OSS handler** (`update_status.go`): No auth step in OSS — unchanged
- **FGA tuple creation**: `agent_execution` → `session` ownership chain already existed for other `can_edit` RPCs
- **`AuthorizeRequestStepV2.java`**: Reads proto method options dynamically — no code change needed
- **Agent-runner Python code**: Just calls the RPC; server handles auth

## Benefits

- **Consistent authorization**: `updateStatus` now uses the same pattern as every other write RPC on the controller
- **No special permissions needed**: Runners work with a plain user JWT — no operator role, no machine account
- **Simpler FGA model**: One fewer platform-level permission to maintain
- **Unblocks runner-as-resource**: Runners authenticating as users can now call `updateStatus` without elevated privileges

## Impact

- **Agent execution**: Runners calling `updateStatus` now need `can_edit` on the execution (satisfied via session ownership)
- **Workflow execution**: Same pattern — runner needs `can_edit` on the workflow execution (satisfied via direct ownership or org admin)
- **Platform FGA model**: `can_update_execution_status` removed — any code referencing this permission will fail at compile time (none exists)
- **All generated stubs** regenerated across Go, Java, Python, TypeScript, and Dart

## Related Work

- [Runner as Resource project](_projects/2026-04/20260420.01.agent-runner-as-resource/) — architectural shift that motivated this change
- [Remove Operator Propagation from FGA Model](_changelog/2026-03/2026-03-25-150239-remove-operator-propagation-from-fga-model.md) — previous FGA cleanup that introduced `can_update_execution_status`
- [Fix updateStatus Authorization Resource ID](_changelog/2026-03/2026-03-25-195107-fix-update-status-authorization-resource-id-override.md) — previous bug fix for the platform-level check (now moot)

---

**Status**: Production Ready
**Scope**: 37 files (stigmer) + 33 files (stigmer-cloud), predominantly generated stubs; 3 hand-edited proto files + 5 hand-edited cloud files
