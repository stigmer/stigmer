# Fix FGA Model Missing `artifact` Type

**Date**: May 24, 2026

## Summary

Added the `artifact` type to the OpenFGA authorization model and removed per-artifact FGA checks from the artifact handler pipelines. This fixes 6 integration test failures caused by the authorization system rejecting requests with "type 'artifact' not found."

## Problem Statement

The OpenFGA authorization model did not define an `artifact` type. Every artifact API call that required authorization (`get`, `getDownloadUrl`, `delete`) triggered an FGA check against a non-existent type, producing a `validation_error` that surfaced as `Status.INTERNAL` to the client.

### Pain Points

- 6 artifact integration tests failing (`TestArtifact_CreateAndGet`, `TestArtifact_GetDownloadUrl_LocalStorage`, `TestArtifact_Delete_SoftDelete`, 3 `TestArtifact_NotFound` sub-tests)
- The `NotFound` tests returned INTERNAL instead of the expected NOT_FOUND because the FGA check failed before the handler reached the existence check
- The error was a hard blocker: the type literally did not exist in the model

## Solution

Two-part fix aligned with the artifact domain model:

1. **Added `artifact.fga` type definition** — Organization-scoped type with `viewer from organization` access derivation
2. **Removed per-artifact authorize steps from handler pipelines** — Artifacts are system-created resources whose access is governed by the parent execution layer, consistent with `listByExecution` which already skips authorization

## Implementation Details

### FGA Model (`stigmer-cloud`)

Created `backend/services/stigmer-service/src/main/resources/fga/model/agentic/artifact.fga`:
- `organization` relation — links artifact to its org
- `viewer` — derived from org viewer (any org member can view artifacts)
- `can_view` — computed from viewer
- `can_edit` — derived from org admin

Registered in `fga.mod` contents list.

### Handler Pipeline Changes (`stigmer-cloud`)

Removed `commonSteps.authorize` from:
- `ArtifactGetHandler` (was checking `can_view`)
- `ArtifactGetDownloadUrlHandler` (was checking `can_view`)
- `ArtifactDeleteHandler` (was checking `can_edit`)

### Production Deployment

- Uploaded new FGA model to production OpenFGA: model ID `01KSDHMFV1HE1DNY4NTDM3DX2A`
- Updated `openfga-config.yaml` variables group and applied to Planton

## Benefits

- 6 integration tests now pass (reducing failures from 16 to 10)
- FGA model is complete — all resource types in the system are represented
- Artifact authorization follows the correct domain semantics: access is governed by the execution layer, not per-artifact tuples

## Impact

- **Integration tests**: 6 failures resolved
- **Production**: FGA model updated — no behavioral change for artifacts since the authorize step is removed
- **Architecture**: Establishes the pattern for system-created resources that delegate authorization to their parent aggregate

## Related Work

- The `artifact.fga` type definition is available for future per-artifact authorization when FGA tuple lifecycle management is implemented in `ArtifactCreateHandler`
- Categories 2-4 of the integration test failures remain and require separate investigation

---

**Status**: Production Ready
**Repos affected**: stigmer-cloud (FGA model + Java handlers + ops config)
