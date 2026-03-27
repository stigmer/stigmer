# Fix HITL Post-Approval: IAM Identity Propagation, Visibility Defaulting, and Tool Call Dedup

**Date**: March 27, 2026

## Summary

Fixed three interrelated issues discovered during HITL (Human-in-the-Loop) production testing: (1) IAM delete/cleanup operations incorrectly using a machine account identity instead of propagating the caller's identity, causing `PERMISSION_DENIED` errors for resource owners; (2) omitting the `visibility` field in `apply_mcp_server` silently changing PUBLIC resources to PRIVATE; and (3) resumed tool calls appearing as duplicates in the session UI after approval.

## Problem Statement

After completing the HITL approval flow cleanup (T01–T07), production testing revealed three bugs in the end-to-end flow:

### Pain Points

- **IAM Identity Swap**: When a user updates an MCP server that triggers a visibility change (e.g., PUBLIC → PRIVATE), the internal cleanup step (`deletePolicy` / `cleanupResourcePolicies`) was using `iamChannelAsSystem`, which replaced the user's identity with a machine account. The machine account lacks `can_grant_access` on the specific resource, so the authorization check in the delete RPC handler failed — even though the user is the owner.
- **Silent Visibility Overwrite**: When an LLM calls `apply_mcp_server` to update approval policies (without specifying `visibility`), the Go `VisibilityFromString("")` defaulted to `visibility_private`. Combined with the Java update handler taking metadata directly from the request, this silently changed PUBLIC resources to PRIVATE.
- **Tool Call Duplication**: After approval and resume, the same tool call appeared twice in the session UI — once as `WAITING_APPROVAL` and once as `COMPLETED` — because the fingerprint-based dedup mechanism used different arg formats (raw vs. humanized) across invocations.

## Solution

Three targeted fixes, each addressing one failure mode:

### Issue A: IAM Identity Propagation

Changed `deletePolicy` and `cleanupResourcePolicies` in `IamPolicyGrpcRepoImpl.java` from `iamChannelAsSystem` to `iamChannel`. This ensures the caller's identity (the resource owner) reaches the RPC handler, where the `can_grant_access` check passes correctly. `createPolicy` and `bootstrapPolicy` remain on `iamChannelAsSystem` because those operations legitimately require system-level access.

### Issue B: Visibility Defaulting (Two Layers)

**Go layer**: Changed `VisibilityFromString` to return `API_RESOURCE_VISIBILITY_UNSPECIFIED` for empty/unknown input instead of defaulting to `PRIVATE`. Explicit "PUBLIC" and "PRIVATE" strings still map correctly.

**Java layer**: Extended `UpdateOperationPreserveResourceIdentifiersStepV2` to preserve the existing resource's visibility when the request sends `UNSPECIFIED` (proto zero value). This applies generically to all resource types sharing this update pipeline.

**Codegen**: Updated the visibility field description to clarify "omit to leave unchanged on updates."

### Issue C: Tool Call Dedup on Resume

Root cause: `populate_fingerprints_from_existing_tool_calls` computed fingerprints from humanized display args stored in the proto Struct, while `_handle_tool_start_event` computed from raw event args. `_humanize_args_for_display` transforms platform refs and env vars, causing the fingerprints to diverge.

Fix: Added a resume-aware dedup mechanism (`_reconciled_resume_tool_calls`) that `ResumeReconciler` populates when transitioning tool calls from `WAITING_APPROVAL` to `RUNNING`. When `_handle_tool_start_event` encounters a fingerprint miss, it checks this registry as a fallback, creating the correct run_id alias without relying on fragile fingerprint matching.

## Implementation Details

### Files Changed (stigmer-cloud)

| File | Change |
|------|--------|
| `IamPolicyGrpcRepoImpl.java` | `iamChannelAsSystem` → `iamChannel` in `deletePolicy` and `cleanupResourcePolicies` |
| `UpdateOperationPreserveResourceIdentifiersStepV2.java` | Preserve existing visibility when request visibility is UNSPECIFIED |

### Files Changed (stigmer)

| File | Change |
|------|--------|
| `mcp-server/internal/convert/convert.go` | `VisibilityFromString` returns UNSPECIFIED for empty input |
| `mcp-server/internal/convert/convert_test.go` | Updated test expectations for empty/unknown inputs |
| `mcp-server/internal/domains/*/convert_test.go` | Updated 3 domain test files for new empty-visibility behavior |
| `tools/codegen/generator/mcp.go` | Updated visibility field description |
| `worker/activities/graphton/status_builder.py` | Added `_reconciled_resume_tool_calls` deque + fallback dedup in `_handle_tool_start_event` |
| `worker/activities/graphton/hitl.py` | `ResumeReconciler.reconcile()` registers reconciled tool calls for resume dedup |

## Benefits

- **IAM fix**: Resource owners can now change visibility on their own resources without hitting `PERMISSION_DENIED`
- **Visibility fix**: Omitting `visibility` in an apply call no longer silently changes PUBLIC resources to PRIVATE
- **Dedup fix**: Resumed tool calls update the original entry instead of creating a duplicate, eliminating UI confusion

## Impact

- All resource types using the shared update pipeline benefit from the visibility preservation (agents, skills, workflows, MCP servers)
- The IAM fix unblocks the entire HITL approval flow for visibility-related operations
- The dedup fix improves UX for all HITL approval scenarios

## Related Work

- [HITL approval cleanup project](../../_projects/2026-03/20260327.01.hitl-approval-cleanup/) (T01–T07)
- [Fix early- prefix identity mismatch](2026-03-27-221901-fix-hitl-early-prefix-identity-mismatch.md)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours
