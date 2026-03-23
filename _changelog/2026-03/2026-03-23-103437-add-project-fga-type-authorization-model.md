# Add Project Type to OpenFGA Authorization Model

**Date**: March 23, 2026

## Summary

Added the missing `project` type definition to the OpenFGA authorization model and the `can_create_project` relation on the `organization` type. This resolves a production FGA validation error (`relation 'organization#can_create_project' not found`) that was blocking project creation in stigmer-service.

## Problem Statement

After the Project domain was implemented (handlers, repo, proto definitions, reconciliation service), the corresponding FGA authorization model was never created. When a user attempted to create a project, the authorization check against OpenFGA failed because neither the `can_create_project` relation on the `organization` type nor the `project` type itself existed in the model.

### Pain Points

- Project creation was completely blocked in production
- FGA check returned `validation_error` for `organization#can_create_project`
- All project CRUD operations (view, edit, delete) would also fail since the `project` type was undefined
- Error surfaced as `INTERNAL` gRPC status, masking the root cause from users

## Solution

1. Added `can_create_project: admin` relation to the `organization` type in `organization.fga`
2. Created `tenancy/project.fga` with the standard org-scoped resource pattern
3. Registered the new module in `fga.mod`
4. Wrote the updated model to the production OpenFGA store
5. Updated the model ID in the planton `openfga-config.yaml` variables group

## Implementation Details

**New file — `tenancy/project.fga`:**
- Follows the established org-scoped resource pattern (same as `agent.fga`, `workflow.fga`)
- Relations: `organization`, `operator` (transitive from org's platform), `owner`, `viewer`
- Permissions: `can_view`, `can_edit`, `can_delete`, `can_grant_access`, `can_view_access`
- Viewers include owner + all org members + direct grants

**Modified — `tenancy/organization.fga`:**
- Added `can_create_project: admin` alongside existing `can_create_agent`, `can_create_workflow`, etc.

**Modified — `fga.mod`:**
- Registered `tenancy/project.fga` in the module contents

**Modified — `openfga-config.yaml`:**
- Updated `prod.model-id` from `01KMA2XP8EHSBVRR714Y0D80J8` to `01KMCH5SGPMDA17CSGBBF59RJ6`

**Applied to production:**
- Model validated and written via `fga model write`
- Variables group applied via `planton apply -f`

## Benefits

- Project creation now works end-to-end in production
- All project CRUD operations are properly authorized via FGA
- IAM policy management (grant/view access) is supported on projects
- Consistent authorization model across all org-scoped resources

## Impact

- **stigmer-service**: After redeployment, picks up the new model ID and can authorize project operations
- **Users**: Can create, view, edit, and delete projects within their organizations
- **Platform operators**: Have superuser access to all projects via the platform link chain

## Related Work

- [Remove stigmer-service from infra stack](2026-03-23-101835-remove-stigmer-service-from-infra-stack.md) — service deployment decoupled from infrastructure

---

**Status**: ✅ Production Ready
