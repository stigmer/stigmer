# Fix API Key Authentication After FGA Operator Propagation Removal

**Date**: March 25, 2026

## Summary

Removing transitive operator propagation from all FGA types (Session 5 of the OBO impersonation project) broke API key authentication for all external callers — agent-runner, workflow-runner, CLI, and SDK. The machine account could no longer pass the `can_view` check on individual API keys during the authentication pipeline. Fixed by replacing the resource-level FGA check with a platform-level `can_manage_identity_accounts` permission, and consolidated the scattered platform resource ID into a shared constant.

## Problem Statement

After completing the "remove operator propagation" refactoring (commit `43926471` in stigmer-cloud), every agent execution immediately failed with `StatusCode.UNAUTHENTICATED` / `"invalid token"`. The error appeared to be an authentication failure, but the root cause was an authorization check embedded inside the authentication pipeline.

### Pain Points

- **All API-key-based authentication was broken** — no agent execution, no workflow execution, no CLI access
- **The error was misleading** — the server returned `UNAUTHENTICATED` (gRPC status 16), not `PERMISSION_DENIED` (status 7), because the authorization failure happened inside `RedisApiKeyIntrospector` during token validation
- **Compounded by a stale API key** — the initial investigation was further complicated by the agent-runner pod having an old API key (Kubernetes secret was updated but pod wasn't restarted)
- **Hidden dependency** — `ApiKeyGetByKeyHashHandler` had a custom authorization step that depended on operator propagation, invisible until operators were removed

## Solution

Two-part fix:

1. **Immediate**: Restarted agent-runner pod to pick up the rotated API key from the updated Kubernetes secret
2. **Root cause**: Changed `ApiKeyGetByKeyHashHandler.CheckAuthorization` from checking `can_view` on the individual `api_key` resource (which requires being the key owner) to checking `can_manage_identity_accounts` on `platform:stigmer` (which requires being a platform operator)

## Implementation Details

### The Authentication Pipeline Path

```
Agent-runner sends: Authorization: Bearer stk_xxx
  → GrpcSecurityConfigBase.authInterceptor
    → OpaqueTokenAuthenticationProvider
      → RedisApiKeyIntrospector.introspect()
        → ApiKeyHashToApiKeyCacheProxy.proxyGet(hash)
          → ApiKeyGrpcRepoImpl.getByKeyHash() via inProcessChannelAsSystem
            → ApiKeyGetByKeyHashHandler pipeline:
              1. ValidateFieldConstraints ✓
              2. LoadFromRepo ✓ (key found)
              3. CheckAuthorization ✗ (can_view on api_key — machine account is not owner)
```

### The FGA Model Before vs After

**Before (operator propagation):**
```
type api_key
  define operator: [identity_account] or operator from organization
  define can_view: owner or operator    ← machine account had access via operator
```

**After (operator removed):**
```
type api_key
  define owner: [identity_account]
  define can_view: owner                ← only the key owner, machine account excluded
```

### The Fix

Changed the `CheckAuthorization` step to use a platform-level permission:

```
// Before: identity_account:<machine_account> can_view api_key:<key_id>     → DENIED
// After:  identity_account:<machine_account> can_manage_identity_accounts platform:stigmer → ALLOWED
```

This is architecturally correct because:
- `getByKeyHash` is only called from `inProcessChannelAsSystem` during authentication
- It's a platform-level identity management operation, not a user-facing data access
- The proto already declares `is_skip_authorization = true` (framework-level auth skipped)
- Only operators should be able to introspect API keys by hash

### PlatformConstants Consolidation

Extracted a shared `PlatformConstants` class in `api-authorization` to eliminate duplicate `"stigmer"` platform resource ID strings:

| File | Before | After |
|------|--------|-------|
| `OnBehalfOfAuthorizationGuard` | `private static final String PLATFORM_ID = "stigmer"` | `PlatformConstants.PLATFORM_RESOURCE_REF` |
| `ApiKeyGetByKeyHashHandler` | `private static final String PLATFORM_RESOURCE_ID = "stigmer"` | `PlatformConstants.PLATFORM_RESOURCE_REF` |
| `U20250102_InsertBootstrapIdentityAccounts` | `private static final String PLATFORM_ID = "stigmer"` | **Not changed** — migrations are immutable |

### Blast Radius Audit

Audited all `inProcessChannelAsSystem` call sites to assess broader impact of operator removal:

| Call Site | Authorization Model | Status |
|-----------|-------------------|--------|
| `ApiKeyGrpcRepoImpl.getByKeyHash` | `can_view` on `api_key` | **Fixed** (now `can_manage_identity_accounts`) |
| `IamPolicyGrpcRepoImpl.bootstrapPolicy` | `can_bootstrap_iam` on `platform:stigmer` | OK (platform-level) |
| `IamPolicyGrpcRepoImpl.cleanupResourcePolicies` | `can_bootstrap_iam` on `platform:stigmer` | OK (platform-level) |
| `IdentityAccountGrpcRepoImpl.create` | No FGA authorize step | OK (no auth) |
| `ExecutionContextGrpcRepoImpl.createAsSystem` | Derived auth, skipped for local pipeline | OK (skipped) |
| `AgentInstanceGrpcRepoImpl.createOnBehalfOf` | `can_impersonate` + user-level FGA | OK (OBO) |
| `WorkflowInstanceGrpcRepoImpl.createOnBehalfOf` | `can_impersonate` + user-level FGA | OK (OBO) |
| `OrganizationGrpcRepoImpl.createOnBehalfOf` | `can_impersonate` + user-level FGA | OK (OBO) |

## Benefits

- **Authentication restored** for all API-key-based callers (agent-runner, workflow-runner, CLI, SDK)
- **Security preserved** — hash-based API key lookup is now gated by `can_manage_identity_accounts` instead of being implicitly open via operator propagation
- **Cleaner authorization model** — platform-level permission is semantically correct for an authentication infrastructure endpoint
- **Consolidated constants** — `PlatformConstants` prevents future drift of the platform resource ID

## Impact

- **Affected**: All API-key-authenticated gRPC calls (agent-runner, workflow-runner, CLI, SDK, web console)
- **Repos**: stigmer-cloud (3 files changed, 1 new)
- **Risk**: Low — the fix narrows the authorization check to a well-defined platform permission that the machine account already has

## Related Work

- **Parent**: OBO impersonation project (20260325.02 + 20260325.03)
- **Root cause commit**: `43926471` (stigmer-cloud) — "remove operator propagation from FGA model and Java backend"
- **Fix commit**: `14c4d252` (stigmer-cloud) — "use platform-level auth for API key hash lookup"
- **Kubernetes**: Agent-runner pod restart required after API key rotation (secret updated but pod had stale env)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (investigation + fix)
