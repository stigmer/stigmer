# On-Behalf-Of gRPC Impersonation Infrastructure

**Date**: March 25, 2026

## Summary

Implemented a complete gRPC on-behalf-of impersonation infrastructure that enables the Stigmer machine account to create resources attributed to a specific user identity. The design follows industry-standard full identity override (Kubernetes Impersonate-User, AWS STS AssumeRole, Microsoft OBO) with an FGA-based authorization gate that restricts impersonation to platform operators only.

## Problem Statement

When the Stigmer platform provisions resources on behalf of users (personal organizations, execution contexts, default agent instances), the machine account authenticates the gRPC calls. Without impersonation, OpenFGA ownership tuples are created with the machine account as the owner instead of the actual user — breaking authorization for downstream operations like `get_secret_value` where only the owning user should have access.

### Pain Points

- Execution contexts with secrets owned by the machine account instead of the user who triggered the execution
- Agent instances and organizations attributed to the system rather than the user
- No mechanism to perform operations "as" a user from backend automation while maintaining correct FGA ownership
- Need to prevent arbitrary principals from impersonating others — only authorized operators should be allowed

## Solution

Full identity override at the gRPC interceptor level, gated by an FGA `can_impersonate` permission check. The machine account authenticates the call, the server-side interceptor verifies impersonation authority, then completely replaces the effective caller identity with the target user. All downstream business logic — authorization, ownership tuple creation, auditing — sees the target user.

## Implementation Details

### Phase 1: FGA Model + Core Infrastructure

**FGA model extension** (`platform.fga`): Added `can_impersonate: operator` relation to the `platform` type. Since the machine account is already bootstrapped as a platform operator, it automatically inherits impersonation permission — no migration needed.

**Metadata key constant** (`OnBehalfOfMetadata.java`): Shared `Metadata.Key<String>` for the `x-on-behalf-of` gRPC header, used by both client and server interceptors.

**Client interceptor** (`OnBehalfOfClientInterceptor.java`): Attaches `x-on-behalf-of: <identityAccountId>` to outgoing gRPC metadata. One instance per target user, not Spring-managed — created by the factory.

**Channel factory** (`ImpersonatedChannelFactory.java`): Spring `@Component` that wraps `inProcessChannelAsSystem` with an `OnBehalfOfClientInterceptor`. The resulting channel stacks machine account token injection (from base channel) + on-behalf-of header attachment.

**Authorization guard** (`OnBehalfOfAuthorizationGuard.java`): Dedicated security gate that checks the FGA tuple `identity_account:<callerId> can_impersonate platform:stigmer`. Uses `@Lazy IamPolicyGrpcRepo` to prevent circular dependency during Spring bean initialization (same pattern as `RequestAuthorizationService`). Fails closed on exceptions.

**Server-side interceptor modification** (`GrpcRequestContextBuilderInterceptor.java`): Added `applyOnBehalfOfOverride()` method after caller identity mapping. Three-gate validation:
1. Header present and non-blank
2. Caller is a machine account
3. Caller has `can_impersonate` FGA permission

On success: rebuilds `RequestCallerIdentity` with `identityAccountId` = target user, `isMachineAccount` = false. Logs impersonation at INFO with both identities. Unauthorized attempts silently discarded with WARN logs.

### Phase 2: Downstream Repos

Added `createOnBehalfOf(resource, identityAccountId)` to:
- `AgentInstanceGrpcRepo` / `AgentInstanceGrpcRepoImpl`
- `ExecutionContextGrpcRepo` / `ExecutionContextGrpcRepoImpl`

Created new:
- `OrganizationGrpcRepo` / `OrganizationGrpcRepoImpl` with both `createAsSystem()` and `createOnBehalfOf()`

All implementations use `ImpersonatedChannelFactory.forIdentity()` to create the impersonated channel.

### Files NOT Modified (by design)

- `RequestCallerIdentity.java` — no new fields; identity model stays clean
- `CreateAuthorizationTuplesStepV2.java` — already uses `getIdentityAccountId()` which becomes the target user after override
- `RequestAuthorizationService.java` — works correctly with overridden identity
- No new migration — machine account already has `operator` role

## Benefits

- **Correct FGA ownership**: Resources created via impersonation are owned by the actual user, enabling proper authorization for sensitive operations like secret retrieval
- **Security-gated**: Only FGA-authorized operators can impersonate — not any machine account or regular user
- **Zero changes to existing authorization logic**: Full identity override means all existing authorization checks and tuple creation work unchanged
- **Clean identity model**: `RequestCallerIdentity` remains a single-identity model with no dual-identity complexity
- **Audit trail**: Impersonation events logged at INFO level with both machine account and target user identities

## Impact

- **Security**: Execution context secrets are now properly owned by the user, not the machine account
- **Platform provisioning**: Temporal provisioning workflows can create resources attributed to the correct user
- **Extensibility**: Any future backend automation that needs to act as a user can use `ImpersonatedChannelFactory`
- **Architecture**: Follows industry standards (Kubernetes, AWS, Microsoft) for a maintainable, well-understood pattern

## Related Work

- Parent project: `20260325.01.auto-personal-org` — automatic personal organization provisioning
- FGA personal resources authorization model (`2026-03-19-134605`)
- Machine account identity resolution fix (`2026-03-22-203341`)

---

**Status**: Production Ready
**Timeline**: Single session (design + implementation)
