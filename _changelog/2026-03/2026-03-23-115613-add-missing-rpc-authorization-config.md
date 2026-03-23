# Add Missing RPC Authorization Config Across Proto Definitions

**Date**: March 23, 2026

## Summary

Added missing IAM authorization options (`rpcauthorization.config` or `is_skip_authorization`) to 20 RPC methods across 18 proto files. Without these options, the backend's `AuthorizeRequestStepV2` pipeline step rejects requests with "Authorization config not found in method options", preventing the handler from executing. This was the root cause of the GitHub OAuth callback failure — the `EnvironmentCommandController/create` RPC was missing its authorization config.

## Problem Statement

The backend authorization framework requires every RPC method to declare one of:
- `rpcauthorization.config` — specifying resource kind, permission, field path, and error message for standard proto-level authorization
- `is_skip_authorization = true` — indicating the handler performs custom authorization logic internally

RPCs missing both options cause the `AuthorizeRequestStepV2` step to fail with an INTERNAL error before the handler pipeline ever runs.

### Pain Points

- `EnvironmentCommandController/create` was the immediate blocker — it broke the GitHub OAuth flow because the token exchange handler creates a personal environment, and that RPC had no authorization config
- 19 additional RPCs had the same latent bug — they would fail if invoked without the missing config
- The gap existed because the proto definitions were added without authorization options, and the backend framework enforced their presence at runtime rather than at build time

## Solution

Two categories of fixes based on how each handler performs authorization:

### Standard proto-level authorization (1 RPC)
- **`EnvironmentCommandController.create`** — Added `rpcauthorization.config` with `resource_kind = organization`, `permission = can_create_environment`, `field_path = "metadata.org"`. This RPC uses `commonSteps.authorize` (the standard `AuthorizeRequestStepV2`), which reads authorization config from proto method options. Added new `can_create_environment = 27` permission to the `ApiResourceIamPermission` enum.

### Handler-level custom authorization (19 RPCs)
- Added `is_skip_authorization = true` for RPCs that implement custom authorization inside their handler (FGA contextual tuples, handler-constructed `RpcAuthorizationConfig`, system-only calls, or FGA-filtered list queries). Each was verified to have actual authorization logic in its Java handler.

## Implementation Details

### Proto files modified (18 files)

**Command controllers — `create` RPCs:**
- `environment/v1/command.proto` — proper config (organization-scoped)
- `agentinstance/v1/command.proto` — skip (FGA contextual tuples)
- `workflowinstance/v1/command.proto` — skip (cross-resource auth)
- `workflowexecution/v1/command.proto` — skip (execute permission on instance)
- `agentexecution/v1/command.proto` — skip (session/org scoped)
- `mcpserver/v1/command.proto` — skip (multi-scope custom auth)
- `identityaccount/v1/command.proto` — skip (system-level, `inProcessChannelAsSystem`)

**Command controllers — other RPCs:**
- `identityaccount/v1/command.proto` — `simulateSignupWebhook` skip (platform operator check in handler)

**Query controllers — `getByReference` RPCs (all skip, all have handler-level `can_view` checks):**
- `environment/v1/query.proto`
- `agent/v1/query.proto`
- `agentinstance/v1/query.proto`
- `workflow/v1/query.proto`
- `workflowinstance/v1/query.proto`
- `mcpserver/v1/query.proto`
- `project/v1/query.proto`
- `identityprovider/v1/query.proto`

**Query controllers — other RPCs:**
- `agent/v1/query.proto` — `getDefault` skip (handler resolves default agent, then authorizes `can_view`)
- `session/v1/query.proto` — `list`, `listByAgent` skip (FGA-filtered queries)
- `apikey/v1/query.proto` — `getByKeyHash` skip (loads by hash, then authorizes)

### IAM permission enum
- Added `can_create_environment = 27` to `ApiResourceIamPermission`

## Benefits

- Fixes the immediate GitHub OAuth callback failure (environment creation)
- Eliminates 19 additional latent authorization config gaps
- All handler-level custom authorization was verified to exist before adding `is_skip_authorization`
- Consistent authorization declaration across all RPC methods

## Impact

- **Immediate**: Unblocks GitHub OAuth flow (environment creation during token storage)
- **Preventive**: Fixes 19 other RPCs that would have failed at runtime
- **Scope**: 18 proto files, 143 total files including regenerated stubs (Go, Java, Python, TypeScript)
- **Requires**: OpenFGA model update to add `can_create_environment` relation to `organization` type

## Related Work

- GitHub OAuth RPC routing fix (camelCase rename) — `2026-03-23-105724-fix-github-oauth-rpc-routing-cloud.md`
- `FullMethodNameGetter` framework fix in stigmer-cloud

---

**Status**: ✅ Production Ready (requires stub regeneration + FGA model update)
