# Promote ExecutionContext to First-Class FGA-Authorized Resource

**Date**: March 27, 2026

## Summary

Promoted `ExecutionContext` from an unauthenticated resource (`AUTHORIZATION_SCOPE_TYPE_NONE`) to a first-class FGA-authorized resource (`AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY`), and changed its `id_prefix` from `exec` to `ectx` for clarity. This resolves authorization failures during MCP server discovery and ensures all ExecutionContext operations are FGA-protected.

## Problem Statement

The `ExecutionContext` resource relied on derived authorization — looking up a parent `AgentExecution` or `WorkflowExecution` and checking FGA permissions on that parent. This broke for MCP server discovery, which creates standalone ExecutionContexts with synthetic execution IDs that have no corresponding parent resource.

### Pain Points

- MCP server discovery failed with `PERMISSION_DENIED` because `ExecutionContextDerivedAuthorization` could not find a parent resource for discovery-generated execution IDs
- The derived authorization model was inherently fragile — any new use case without a parent resource would break
- The `exec` id_prefix on `ExecutionContext` was ambiguous and easily confused with `AgentExecution` or `WorkflowExecution` resources

## Solution

Leveraged the existing `ApiResourceKind` authorization configuration framework to promote `ExecutionContext` to an owner-scoped FGA resource. This is the same pattern used by `api_key` — a simple owner-only model where the creator owns the resource and no scope hierarchy is needed.

## Implementation Details

### ApiResourceKind Configuration (`api_resource_kind.proto`)

- Changed `id_prefix` from `"exec"` to `"ectx"` to avoid confusion with execution resources
- Changed `scope_type` from `AUTHORIZATION_SCOPE_TYPE_NONE` to `AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY`
- Changed `owner_type` from `OWNER_ATTRIBUTION_TYPE_NONE` to `OWNER_ATTRIBUTION_TYPE_DIRECT`

### Authorization Comments (`authorization_config.proto`)

- Moved `execution_context` from the `NONE` usage comment to the `OWNER_ONLY` usage comment
- Keeps documentation accurate for future developers

### Stub Regeneration

Regenerated all language stubs (Go, Java, Python, TypeScript) to reflect the proto changes.

## Benefits

- **Discovery works**: MCP server discovery no longer hits authorization failures
- **Simpler model**: Owner-based authorization is straightforward — no derived lookups, no parent resource resolution
- **Framework-native**: Uses the same `CreateAuthorizationTuplesStepV2` and `DeleteOperationCleanupIamPoliciesStep` pipeline steps that all other FGA resources use
- **Clear ID prefix**: `ectx-` prefix is unambiguous and won't be confused with agent/workflow execution IDs

## Impact

- **MCP server discovery**: No longer blocked by authorization failures
- **Agent/workflow execution**: ExecutionContext create and delete now go through FGA-checked OBO (on-behalf-of) gRPC pipelines in the cloud service
- **OSS server**: Unaffected — the Go OSS server has no FGA, so the authorization config metadata is informational only; the Go Temporal activities continue to use direct store operations

## Related Work

- [Secure Discovery with ExecutionContext](2026-03-27-102916-secure-discovery-with-execution-context.md) — the original work that introduced ExecutionContext for MCP discovery
- [OBO Impersonation Infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — the infrastructure enabling on-behalf-of gRPC calls used for EC create/delete
- [ExecutionContext Derived Authorization](2026-03-25-144412-execution-context-derived-authorization-and-runner-obo-fixes.md) — the previous derived authorization model that this change replaces

---

**Status**: ✅ Production Ready
