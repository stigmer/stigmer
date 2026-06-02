# Fix Activity Handler IAM Permission Reference

**Date**: May 27, 2026

## Summary

Fixed a compilation error in `ListRecentActivityHandler` caused by referencing a non-existent `IamPermission.is_member` enum value. Replaced it with `IamPermission.can_view`, which is the correct permission for verifying organization access and is consistent with the rest of the handler's authorization checks.

## Problem Statement

The stigmer-service Bazel build was failing with a `cannot find symbol` error when compiling the `stigmer_service_lib` target (578 source files).

### Pain Points

- Build was completely blocked — the service could not be compiled or deployed
- The error was in `ListRecentActivityHandler.java:168`, referencing `IamPermission.is_member` which does not exist in the protobuf-generated `IamPermission` enum
- The `IamPermission` enum only contains computed permissions (`can_view`, `can_edit`, `can_delete`, etc.), not FGA relations like `is_member`

## Solution

Replaced `IamPermission.is_member.name()` with `IamPermission.can_view.name()` in the `isOrgMember` method. This aligns with the codebase convention: authorization checks use `IamPermission` (computed permissions), not `IamRole` (assignable relations). Any organization member inherently has `can_view` on the organization, making it an effective membership check.

## Implementation Details

Single-line change in `ListRecentActivityHandler.java`:

- **Before**: `.setRelation(IamPermission.is_member.name())`
- **After**: `.setRelation(IamPermission.can_view.name())`

The two other authorization checks in the same handler already use `IamPermission.can_view` for listing authorized session and workflow execution IDs, so this change makes the org-scoped fast path consistent with the per-resource fallback path.

## Benefits

- Unblocks the stigmer-service build
- Consistent authorization model — all checks in the handler now use `IamPermission.can_view`
- Follows established patterns (e.g., other handlers in the codebase)

## Impact

- **Backend build**: Unblocked — service compiles and packages successfully
- **Runtime behavior**: The org membership fast path in the recents sidebar now correctly checks `can_view` permission, which is granted to all org members via FGA role inheritance

---

**Status**: ✅ Production Ready
