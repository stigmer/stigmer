# createFederatedAccount RPC — Explicit Federated Identity Account Creation

**Date**: April 5, 2026

## Summary

Added the `createFederatedAccount` RPC to the `IdentityAccountCommandController`, enabling platform backends to explicitly create federated identity accounts linked to an external identity provider. This replaces the previous JIT (just-in-time) provisioning model with an explicit, authorized, pre-authentication account creation flow — a foundational primitive for the multi-tenant identity provider system.

## Problem Statement

After removing JIT provisioning in Phase 2, the platform had no API for creating federated identity accounts. When a user signed up on a platform built on Stigmer, the platform backend needed to create an account *before* the user could authenticate via the IdP. Without this RPC, the federated auth flow would always return 401 for new users.

### Pain Points

- No API to create identity accounts tied to an external IdP
- Platform backends had no way to register users before their first federated login
- The system needed authorization controls (FGA) for who can create identity accounts
- No database-level uniqueness guarantee for (IdP + external subject) combinations
- The existing `create` RPC on `IdentityAccountCommandController` was a system-level operation not suitable for platform-facing use

## Solution

A new gRPC RPC (`createFederatedAccount`) with a dedicated input message, FGA authorization at the organization level, a multi-step validation pipeline, and a MongoDB partial compound unique index to guarantee federated account uniqueness.

## Implementation Details

### Proto Definitions (stigmer repo)

**`CreateFederatedAccountInput`** message in `io.proto`:
- `org` (required) — Organization slug, used as the FGA authorization scope
- `identity_provider_ref` — Reference to the IdP (org + slug)
- `external_sub` (required) — The OIDC subject identifier from the platform's IdP
- `email` (required) — User email address
- `first_name`, `last_name`, `picture_url` — Optional profile fields

**RPC in `command.proto`**:
```protobuf
rpc createFederatedAccount(CreateFederatedAccountInput) returns (IdentityAccount) {
  option (ai.stigmer.commons.rpc.config).resource_kind = organization;
  option (ai.stigmer.commons.rpc.config).permission = can_create_identity_account;
  option (ai.stigmer.commons.rpc.config).field_path = "org";
}
```

**`can_create_identity_account = 21`** added to `IamPermission` enum.

### Backend Handler (stigmer-cloud repo)

`CreateFederatedAccountHandler` extends `CustomOperationHandlerV2<CreateFederatedAccountInput, IdentityAccount>` with a 7-step pipeline:

1. **ValidateFieldConstraints** — buf.validate constraints on input
2. **Authorize** — FGA check: `can_create_identity_account` on the organization
3. **ValidateIdentityProvider** — Verifies the IdP exists and belongs to the specified org; normalizes relative refs to absolute
4. **CheckDuplicate** — Rejects with ALREADY_EXISTS if a federated account already exists for the same IdP + external_sub
5. **CreateAccount** — Builds `IdentityAccount` proto (maps `external_sub` -> `idp_id`, sets `provisioning_mode = federated`, attaches `identity_provider_ref`), delegates to `IdentityAccountGrpcRepo.create()` via `inProcessChannelAsSystem`
6. **TransformResponse** — Standard response transformation
7. **SendResponse** — Return the created `IdentityAccount` with generated ID

### FGA Model

`define can_create_identity_account: admin` added to `organization` type in `organization.fga`.

### MongoDB Migration

`U20260405_FederatedAccountUniqueness` (Mongock, order "009"):
- Creates a partial compound unique index on `(spec.identityProviderRef.org, spec.identityProviderRef.slug, spec.idpId)`
- Partial filter expression scopes the index to documents where `spec.identityProviderRef.org` exists
- Only federated accounts are constrained; direct and machine accounts are excluded
- Doubles as a performance index for the compound lookup used during federated authentication

### Key Design Decisions

- **Delegation over duplication**: The handler delegates to the existing create pipeline rather than reimplementing persistence, ID generation, and FGA tuple creation
- **`external_sub` API name, `idp_id` internal storage**: Clear API semantics for consumers while maintaining backward compatibility with the existing federated auth lookup
- **Partial index**: Elegantly scopes the uniqueness constraint to only the documents that need it, avoiding false conflicts with non-federated accounts

## Benefits

- **Platform builders can now onboard users**: The explicit creation API lets platforms register users during their own signup flow, before the first federated login
- **Authorization-controlled**: Only org admins can create identity accounts, enforced via FGA
- **Database-level uniqueness**: The partial compound unique index prevents duplicate federated accounts even under concurrent requests
- **Clean separation of concerns**: The handler focuses on federation-specific validation; all downstream persistence is delegated to the existing create pipeline
- **Performance**: The same index that enforces uniqueness also accelerates the compound lookup during authentication

## Impact

- **Platform backends**: Can now call `createFederatedAccount` via API key to pre-create accounts for their users
- **Federated auth flow**: Completes the Phase 2 -> Phase 3 transition — accounts are now explicitly created (Phase 3) rather than JIT-provisioned (removed in Phase 2)
- **IAM domain**: New permission type (`can_create_identity_account`) expands the authorization model
- **SDK clients**: All language SDKs (Go, Java, Python, TypeScript) and MCP server include the new method

## Related Work

- Phase 1: Fix MongoDB email uniqueness (`U20260405_FixEmailUniqueness.java`) — prerequisite for allowing multiple accounts with the same email across different IdPs
- Phase 2: Remove JIT provisioning — renamed `FederatedIdentityProvisioner` to `FederatedIdentityResolver`, removed auto-creation from auth flow
- Previous changelog: `2026-04-05-104847-remove-jit-provisioning-from-federated-auth.md`
- Next: Phase 4 (self-managed SSO org flag), Phase 5 (secure getByEmail)

---

**Status**: Production Ready
**Timeline**: ~2 hours (planning + implementation)
