# Federation Provisioner Domain Boundary Refactoring

**Date**: February 20, 2026

## Summary

Refactored `FederatedIdentityProvisionerImpl` and `CreateIdentityAccountFromAuth0ActivitiesImpl` to respect modular monolith domain boundaries. All identity account creation now flows through a new `create` RPC on `IdentityAccountCommandController`, eliminating direct cross-domain repo access and duplicated creation logic.

## Problem Statement

`FederatedIdentityProvisionerImpl` (in the `identityprovider` domain) directly accessed two resources owned by other domains:

### Pain Points

- **Cross-domain repo access**: Directly used `IdentityAccountRepo` (owned by the `identityaccount` domain) to save identity accounts
- **Bypassed domain boundary**: Directly called `IamPolicyCreationService` to write FGA tuples, bypassing the IAM policy domain's RPC boundary
- **Duplicated creation logic**: Identity account creation was implemented independently in both `FederatedIdentityProvisionerImpl` (federation JIT) and `CreateIdentityAccountFromAuth0ActivitiesImpl` (Auth0 webhook), with no shared code path
- **No pipeline benefits**: Neither creation path went through the standard handler pipeline (validation, ID generation, audit fields, FGA tuples), making them inconsistent with the rest of the system

## Solution

Introduced a `create` RPC on `IdentityAccountCommandController` with a standard handler pipeline, then routed all identity account creation through it via an in-process gRPC downstream client — the same pattern used by `IamPolicyGrpcRepoImpl` and `AgentInstanceGrpcRepoImpl`.

## Implementation Details

### Proto change (stigmer OSS)

Added `create` RPC to `IdentityAccountCommandController` in `command.proto`. No FGA authorization options — this is a system-level RPC called via `inProcessChannelAsSystem` (machine account). The handler's `createAuthorizationTuples` step writes the self-ownership tuple after creation.

### IdentityAccountCreateHandler (stigmer-cloud)

New handler extending `CreateOperationHandlerV2<IdentityAccount>` with a lean pipeline:
1. `validateFieldConstraints` — proto buf.validate
2. `buildNewState` — ID generation, metadata, audit fields
3. `persist` — MongoDB save
4. `createAuthorizationTuples` — platform link + self-owner FGA tuples
5. `transformResponse` + `sendResponse`

No `authorize` step: identity accounts have a bootstrap problem (the account being created IS the principal).

### IdentityAccountGrpcRepo interface + implementation

- **Interface** in `api-authentication` lib (alongside `IdentityAccountMongoRepo` and `FederatedIdentityProvisioner`)
- **Implementation** in `downstream/iam/identityaccount/` using `inProcessChannelAsSystem`

### FederatedIdentityProvisionerImpl refactoring

Removed direct `IdentityAccountRepo` and `IamPolicyCreationService` dependencies. The `provision()` method now builds an `IdentityAccount` with just spec fields and delegates to `identityAccountGrpcRepo.create()`. Read-only lookups still use `IdentityAccountMongoRepo` (shared auth-lib interface) and `IdentityAccountRedisCacheRepo`.

### Auth0 webhook migration

`CreateIdentityAccountFromAuth0ActivitiesImpl.createIdentityAccount()` now delegates to the gRPC client. `writeFgaTuples()` is a no-op since the create handler's pipeline already creates FGA tuples.

## Benefits

- **Single source of truth**: All identity account creation goes through one handler pipeline
- **Domain boundary respect**: `identityprovider` domain no longer directly accesses `identityaccount` domain repos
- **Consistent behavior**: Validation, ID generation, audit fields, and FGA tuples are handled uniformly
- **Microservice-ready**: When splitting services, only the channel configuration changes (in-process to network gRPC)
- **Reduced duplication**: Eliminated two independent implementations of account creation logic

## Impact

- **identityprovider domain**: Cleaner dependencies, no cross-domain repo access
- **identityaccount domain**: New `create` RPC and handler — standard pipeline for all creation
- **Auth0 webhook flow**: Simplified from repo+FGA direct calls to single gRPC call
- **Federation JIT flow**: Same simplification, consistent with established downstream client patterns

## Related Work

- Follows the same in-process gRPC pattern established by `IamPolicyGrpcRepoImpl` and `AgentInstanceGrpcRepoImpl`
- Part of the broader federated identity provider feature (`feat/add-identity-provider-resource`)
- Prerequisite: federation authentication interceptor extension (see `2026-02-20-181208`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
