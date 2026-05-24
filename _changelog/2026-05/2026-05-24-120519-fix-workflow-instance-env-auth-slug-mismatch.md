# Fix Workflow Instance Environment Authorization (Slug-vs-ID Mismatch)

**Date**: May 24, 2026

## Summary

Fixed a bug where creating a workflow instance with environment references always failed with "You don't have permission to access environment" — even for the environment's own creator. The root cause was the authorization check using the environment slug instead of the resource ID when querying FGA.

## Problem Statement

When a user created a workflow instance and bound environments to it (e.g., a `postgres` environment), the create handler rejected the request with a permission denied error regardless of whether the user owned the environment.

### Pain Points

- Environment creators could not bind their own environments to workflow instances
- The error message ("You don't have permission to access environment: postgres") was misleading — it implied a permissions problem when the real issue was an identifier mismatch
- The `resolveEnvId` method was a known placeholder (its own comment said "In production, you might want to look up the actual ID from the repo") that was never completed

## Solution

Replaced the broken manual FGA check in `WorkflowInstanceCreateHandler.AuthorizeCreation` with a downstream gRPC call to `EnvironmentQueryGrpcRepo.getByReferenceAsCaller(org, slug)`. This delegates both slug-to-ID resolution and FGA authorization to the environment domain's own handler pipeline, following the established cross-domain boundary pattern.

## Implementation Details

**Root cause**: FGA tuples are written with resource IDs (e.g., `environment:env_abc123#owner@identity_account:usr_xyz`), but the authorization check was querying FGA with the slug (`environment:postgres`). These never matched.

**Fix in `WorkflowInstanceCreateHandler.AuthorizeCreation`**:

1. Injected `EnvironmentQueryGrpcRepo` alongside the existing `IamPolicyGrpcRepo`
2. Replaced the environment authorization loop to call `getByReferenceAsCaller(org, slug)` for each environment ref — this single call resolves the slug to the real resource ID via `EnvironmentRepo.findByOrgAndSlug()` and runs the FGA `can_view` check with the correct ID
3. Removed the dead `resolveEnvId()` and `authorizeEnvironmentAccess()` methods
4. Added proper error mapping: `StatusRuntimeException(NOT_FOUND)` → "Environment not found: {slug}", `StatusRuntimeException(PERMISSION_DENIED)` → "You don't have permission to access environment: {slug}"
5. Handled empty org on relative references by defaulting to the instance's org

**Files changed**: `WorkflowInstanceCreateHandler.java` (1 file, net reduction in code)

**FGA model**: No changes — the `environment.fga` model was correctly designed as a personal resource.

## Benefits

- Environment creators can now bind their own environments to workflow instances
- Authorization respects cross-domain boundaries — the workflow instance domain delegates to the environment domain's handler pipeline instead of bypassing it
- Error messages remain user-friendly (showing slugs, not internal IDs)
- Net code reduction — removed ~50 lines of manual FGA check code and replaced with a ~15-line downstream gRPC call

## Impact

- **Users**: Unblocks workflow instance creation with environment bindings
- **Architecture**: Aligns with the established downstream gRPC pattern for cross-domain authorization, making future microservice extraction cleaner

---

**Status**: ✅ Production Ready
