# Fix: Visibility FGA Permissions and Default Visibility

**Date**: May 22, 2026

## Summary

Fixed 3 failing visibility integration tests (`TestWorkflowUpdateVisibility`, `TestWorkflowInstanceUpdateVisibility`, `TestAgentInstanceUpdateVisibility`) caused by two independent issues: missing `can_grant_access` permissions in the FGA authorization model for instance-type resources, and newly created resources having `visibility_unspecified` instead of `visibility_private` in their metadata.

## Problem Statement

When toggling resource visibility back to PRIVATE (e.g., from ORG or PUBLIC), the `UpdateVisibility` handler needs to delete the old viewer tuple from OpenFGA. The tuple deletion path calls `IamPolicyGrpcRepo.deletePolicy()` which routes through the user channel to the `IamPolicyDeleteHandler`. That handler checks `can_grant_access` on the target resource — a permission that was never defined in the `workflow_instance` and `agent_instance` FGA models.

### Pain Points

- `TestWorkflowInstanceUpdateVisibility` and `TestAgentInstanceUpdateVisibility` failed with `PERMISSION_DENIED: unauthorized to revoke access` when transitioning from ORG/PUBLIC back to PRIVATE
- All 3 visibility tests additionally failed with `expected: 1, actual: 0` because newly created resources had `visibility = 0` (unspecified) instead of `visibility = 1` (private)
- The `IamPolicyGrpcRepo.deletePolicy()` interface javadoc incorrectly stated it requires `can_bootstrap_iam` when it actually requires `can_grant_access`

## Solution

Two targeted fixes:

1. **Complete the FGA model** — Added `can_grant_access: owner` and `can_view_access: viewer` to `workflow_instance.fga` and `agent_instance.fga`, matching the pattern already established by `workflow.fga`, `agent.fga`, `skill.fga`, and `mcp_server.fga`.

2. **Default visibility on creation** — Added a `CreateOperationSetDefaultVisibilityStepV2` pipeline step that sets `visibility_private` when the visibility field is unspecified during resource creation.

## Implementation Details

### FGA Model Fix (stigmer-cloud)

Added IAM POLICY MANAGEMENT section to both instance FGA models:

| File | Added |
|------|-------|
| `workflow_instance.fga` | `define can_grant_access: owner` and `define can_view_access: viewer` |
| `agent_instance.fga` | Same |

These complete the FGA model contract — every resource type with a visibility handler now defines the permissions required by the `deletePolicy` authorization check.

### Default Visibility Fix (stigmer-cloud)

Created `CreateOperationSetDefaultVisibilityStepV2` in the shared `grpc-request` library. The step runs as part of the `BuildNewState` pipeline during resource creation, after audit fields are set. It checks if `metadata.visibility` is `api_resource_visibility_unspecified` and sets it to `visibility_private`.

Wired into the pipeline via `CreateOperationNewStateSteps` and `CreateOperationBuildNewStateStepV2`.

### Documentation Fix (stigmer-cloud)

Corrected `IamPolicyGrpcRepo.deletePolicy()` javadoc from "Requires can_bootstrap_iam permission on platform:stigmer" to "Requires can_grant_access permission on the resource referenced in the policy".

## Impact

- **4 visibility tests now pass**: `TestWorkflowUpdateVisibility`, `TestWorkflowInstanceUpdateVisibility`, `TestAgentInstanceUpdateVisibility`, `TestVisibilityOrgEnumValue`
- Default visibility is now explicit (`visibility_private`) for all newly created resources, rather than relying on consumers to treat unspecified as private

## Files Changed

### stigmer-cloud repo

| File | Change |
|------|--------|
| `.../fga/model/agentic/workflow_instance.fga` | Add `can_grant_access: owner`, `can_view_access: viewer` |
| `.../fga/model/agentic/agent_instance.fga` | Same |
| `.../api-authorization/.../IamPolicyGrpcRepo.java` | Fix `deletePolicy()` javadoc |
| `.../grpc-request/.../CreateOperationSetDefaultVisibilityStepV2.java` | **New** — default visibility pipeline step |
| `.../grpc-request/.../CreateOperationNewStateSteps.java` | Register new step |
| `.../grpc-request/.../CreateOperationBuildNewStateStepV2.java` | Wire new step into pipeline |

## Related Work

- Session 5: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md` (RC7b: visibility test workflow specs)
- Session 4 triage: `_changelog/2026-05/2026-05-22-025000-integration-test-suite-session4-failure-report.md` (RC7c: FGA permission identified)

---

**Status**: ✅ Production Ready — All 4 visibility tests pass
**Timeline**: ~1 hour (analysis, FGA model fix, default visibility fix, test verification)
