# Task T01: Identity Provider Flow — Analysis and Implementation Plan

**Created**: 2026-04-05
**Status**: Planning (pending review)

## Problem Statement

The identity provider flow has several critical gaps that prevent it from being production-ready:

1. **MongoDB email uniqueness bug**: A `unique(true).sparse(true)` index on `spec.email` in `U20250101_IdentityAccountIndexes.java` will cause `E11000 duplicate key` errors when a federated user shares an email with a direct Stigmer user. The `FederatedIdentityProvisionerImpl` does not handle this error.

2. **JIT provisioning is the wrong model**: Currently, federated identity accounts are created automatically during authentication (JIT). But a JIT-provisioned user has **zero permissions** — they can authenticate but can't access anything. The platform has no way to learn the identity account ID from JIT, so it can't grant roles. This is a chicken-and-egg problem.

3. **No explicit account creation for platforms**: Platforms need an authorized API to create federated identity accounts, get back the ID, and then grant roles on their organizations. This RPC and the corresponding FGA permission do not exist.

4. **Self-managed SSO gap**: The `identity_provider_ref` field on `OrganizationSpec` is only for `platform_managed` orgs. A self-managed org wanting corporate SSO (team members authenticate via their Okta/Auth0) has no path.

5. **getByEmail security leak**: If a platform queries identity accounts by email, they might get back a different user's direct Stigmer account that shares the same email. This crosses trust boundaries.

6. **No web app UI**: The React SDK has no `identity-provider/` feature folder, and the web app has no IdP management pages.

## Decided Design Principles

From brainstorming sessions:

- **Remove JIT provisioning entirely.** The platform is fully responsible for explicitly creating federated identity accounts via the API before those users can authenticate.
- **Keep identity accounts separate by design.** A direct Stigmer user (`auth0|abc123`) and a federated user with the same email are different accounts. Never auto-merge by email.
- **Store external subject identifiers as-is.** No `federated:` prefix, no compound key. The platform provides the raw OIDC `sub` claim (e.g., `google-oauth2|109876543210`), and Stigmer stores it directly in `external_sub`. Uniqueness is enforced by a compound index on `(identity_provider_ref, external_sub)`. During authentication, the identity account is resolved by looking up the IdP + `sub` together. The old compound key format (`federated:{provider_id}:{external_sub}`) is removed.
- **Operator role stays out of the IAM role enum.** It's a platform-level concern, not something granted via IAM policies.

## Revised Identity Provider Flow

### Platform-Managed Organization Flow

```
Step 1 (One-time setup via Stigmer web app):
  Platform Admin → Stigmer: Create Organization (self-managed)
  Platform Admin → Stigmer: Create IdentityProvider in their org
  Platform Admin → Stigmer: Create API Key
  Platform Admin → Stigmer: Create platform-managed Organization (linked to IdP)

Step 2 (Ongoing — when user signs up on the platform):
  Platform Backend → Stigmer API (API key auth):
    Create federated identity account (org context, IdP ref, email, name, external_sub)
  Stigmer → Platform Backend: Returns identity_account_id
  Platform Backend → Stigmer API:
    Grant member role to identity_account_id on platform-managed org

Step 3 (Runtime — user uses platform features backed by Stigmer):
  End User → Platform: Authenticate via platform OIDC
  End User → Stigmer API: API call with platform Bearer JWT
  Stigmer: Validate JWT via IdP JWKS
  Stigmer: Resolve existing federated identity account (created in Step 2)
  Stigmer: FGA check — user has access (granted in Step 2)
  Stigmer → End User: Success
```

### Key difference from current implementation

Currently: Authenticate → JIT creates account → user has no access (broken)
Proposed: Platform creates account → grants role → user authenticates → has access (correct)

## Detailed Changes Required

### Phase 1: Fix MongoDB Email Uniqueness

**File**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/U20250101_IdentityAccountIndexes.java`

**Change**: Remove the `unique(true)` constraint from the `spec.email` index. Keep it as a non-unique index for query performance. Add a compound unique index for federated account lookups.

**New migration**: Create `U20260405_FederatedAccountIndexes.java` that:
1. Drops the existing `spec.email_1` unique index
2. Creates a new non-unique index on `spec.email` (for query performance only)
3. Creates a compound unique index on `(spec.identity_provider_ref, spec.external_sub)` for federated account uniqueness
4. Verifies `spec.idp_id` index remains for direct/legacy account lookups

**Risk**: Production data may have the unique email index. The migration must handle the case where the index doesn't exist (idempotent).

### Phase 2: Remove JIT Provisioning

**Files to modify**:
- `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/FederatedIdentityProvisionerImpl.java` — Remove JIT account creation logic
- `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/RequestCallerIdentityMapper.java` — Change federated auth to resolve-only (no provisioning)
- `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/federation/FederatedIdentityProvisioner.java` — Rename to `FederatedIdentityResolver`, remove provisioning from interface

**New behavior for federated auth**:
1. JWT arrives → validate via IdP JWKS (unchanged)
2. Extract `sub` claim from the validated JWT (simplified — no compound key construction)
3. Look up identity account by `identity_provider_ref` + `external_sub` (compound query instead of single-field compound key)
4. If found → proceed with authorization checks (unchanged)
5. If NOT found → return **401 Unauthorized** with clear error: "Federated identity account not found. The platform must create the account before authentication." (NEW — previously this triggered JIT)

**Key change**: Remove `AuthenticationTokenParser.buildCompoundIdpId()` and the `federated:` prefix logic. The `idp_id` field on federated accounts is no longer a compound key — it stores the raw `external_sub` value. The `identity_provider_ref` field (already on the account) provides the IdP scoping.

### Phase 3: New Authorized RPC for Federated Account Creation

**Proto change**: New RPC in `apis/ai/stigmer/iam/identityaccount/v1/command.proto`

```protobuf
// Create a federated identity account within an organization's identity provider scope.
//
// Called by platform backends (via API key) when a new user signs up on their platform.
// The platform must create the account before the user can authenticate via the IdP.
// Returns the full identity account including its ID for subsequent role grants.
//
// Authorization: Requires can_create_identity_account on the organization.
rpc createFederatedAccount(CreateFederatedAccountInput) returns (IdentityAccount) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = organization;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_create_identity_account;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "org_id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to create identity accounts in this organization";
}
```

**New message** in `io.proto`:

```protobuf
message CreateFederatedAccountInput {
  // Organization ID where the account will be created.
  string org_id = 1;
  
  // Reference to the IdentityProvider (org/slug format).
  ai.stigmer.commons.apiresource.ApiResourceReference identity_provider_ref = 2;
  
  // External subject identifier from the platform's OIDC provider.
  // This is the raw OIDC `sub` claim value (e.g., "google-oauth2|109876543210" or "auth0|abc123").
  // Stored as-is without any prefix transformation.
  // Must match the `sub` claim in JWTs issued by this IdP for authentication to work.
  string external_sub = 3;
  
  // User email address.
  string email = 4;
  
  // User first name.
  string first_name = 5;
  
  // User last name.
  string last_name = 6;
  
  // URL of the user's profile picture.
  string picture_url = 7;
}
```

**FGA change**: Add `can_create_identity_account: admin` to `organization.fga`:
```
define can_create_identity_account: admin
```

**Proto enum change**: Add `can_create_identity_account` to `ApiResourceIamPermission` (or `IamPermission` if the separation project completes first).

**Backend handler**: New `CreateFederatedAccountHandler.java` that:
1. Validates the IdP ref exists and belongs to the specified org
2. Stores `external_sub` as-is (the raw OIDC `sub` claim, no compound key construction)
3. Sets `identity_provider_ref` on the account (links to the IdP)
4. Creates the identity account with `provisioning_mode = federated`
5. Creates FGA self-ownership tuple
6. Returns the full identity account (with `metadata.id`)

**Uniqueness**: Enforced by a compound unique index on `(identity_provider_ref, external_sub)` — not by a single-field compound key.

### Phase 4: Self-Managed SSO Design

**Problem**: A self-managed org wants team members to authenticate via their corporate IdP (Okta, Azure AD, etc.) without becoming `platform_managed`.

**Proposed approach**: Add an optional `sso_identity_provider_ref` to `OrganizationSpec`, separate from the platform-managed `identity_provider_ref`.

```protobuf
message OrganizationSpec {
  // ... existing fields (1-6) ...
  
  // Optional SSO identity provider for self-managed organizations.
  // When set, org members can authenticate via this IdP in addition to direct Stigmer login.
  // Unlike platform_managed orgs, the org admin manages the org directly on Stigmer.
  // The IdP is used purely for authentication, not for platform delegation.
  //
  // Mutually exclusive with identity_provider_ref (platform_managed orgs use that field).
  ai.stigmer.commons.apiresource.ApiResourceReference sso_identity_provider_ref = 7;
}
```

**Alternative approach (to discuss)**: Instead of a separate field, allow `identity_provider_ref` on self-managed orgs too, and change the semantics:
- `self_managed` + `identity_provider_ref` = SSO (org admin manages directly, members auth via IdP)
- `platform_managed` + `identity_provider_ref` = full platform delegation (platform creates/manages via API)

This is cleaner (one field, two modes) but changes the existing contract.

**Decision needed**: Which approach? Separate field vs reuse existing field?

### Phase 5: Security — getByEmail Scoping

**Current risk**: `getByEmail` returns any identity account matching the email, regardless of provisioning mode or IdP. A platform querying by email could get back a direct Stigmer user's account.

**Proposed fixes**:
1. Add a `getByExternalSub` query RPC that looks up by `identity_provider_ref` + `external_sub` — platforms should use this instead of email
2. Scope `getByEmail` to return only accounts visible to the caller (based on FGA permissions)
3. Or: remove `getByEmail` from the external API surface entirely (keep as internal-only)

**Decision needed**: Since the platform gets the ID back from `createFederatedAccount`, do they even need a lookup? Possibly for "check if this user already has an account" scenarios. If so, `getByExternalSub` (scoped to the IdP) is safer than `getByEmail`.

### Phase 6: SDK React Components

**New feature folder**: `sdk/react/src/identity-provider/`

Hooks:
- `useIdentityProviders(orgId)` — list IdPs for an org
- `useIdentityProvider(id)` — get a single IdP
- `useCreateIdentityProvider()` — create mutation
- `useUpdateIdentityProvider()` — update mutation
- `useDeleteIdentityProvider()` — delete mutation

Components (headless-first, themed via `--stgm-*` tokens):
- `<IdentityProviderList />` — list of IdPs with actions
- `<IdentityProviderForm />` — create/edit form (JWKS URI, issuers, audience, userinfo endpoint)
- `<IdentityProviderDetail />` — detail view with config summary

**New feature folder**: `sdk/react/src/iam-policy/`

Hooks:
- `useIamPolicies(resourceKind, resourceId)` — list policies on a resource
- `useGrantRole()` — grant a role
- `useRevokeRole()` — revoke a role

Components:
- `<AccessList />` — who has what role on this resource
- `<RoleGrantDialog />` — grant a role to a principal (role dropdown reads from `grantable_roles` proto metadata)

### Phase 7: Web App Pages

**New routes in** `client-apps/web/src/app/settings/`:
- `/settings/identity-providers` — list IdPs for the current org
- `/settings/identity-providers/new` — create an IdP
- `/settings/identity-providers/[id]` — view/edit an IdP

These consume the SDK React components. Console-only concerns (routing, breadcrumbs, page layout) live here.

### Phase 8: Documentation

- **Getting Started: Identity Provider Setup** — step-by-step for platform builders
- **Concepts: Identity Accounts** — direct vs federated, how external_sub + identity_provider_ref work
- **Concepts: SSO for Self-Managed Orgs** — how to add corporate SSO
- **API Reference: createFederatedAccount** — request/response with examples
- **Flow Diagram: Platform-Managed Authentication** — the full lifecycle

## Open Questions (for brainstorming)

1. **Self-managed SSO field**: Separate `sso_identity_provider_ref` or reuse `identity_provider_ref`?

2. **Account update flow**: When a federated user's profile changes on the platform, how does the platform update it on Stigmer? Do we need an `updateFederatedAccount` RPC? Or does the existing `update` RPC work if the platform has `can_edit` on the identity account?

3. **Account deprovisioning**: When a user leaves the platform, the platform should revoke access (remove IAM policy) and optionally delete the identity account. Is the existing `delete` RPC sufficient, or do we need a platform-scoped deprovisioning flow?

4. **Multiple IdPs per org**: Can a platform-managed org have multiple identity providers? The current spec has a single `identity_provider_ref`. For now, one IdP per org seems right.

5. **What happens to existing JIT-provisioned accounts?** If we remove JIT, do existing federated accounts continue to work? Existing accounts have compound `idp_id` values like `federated:{provider_id}:{external_sub}`. We need a data migration to: (a) extract the raw `external_sub` from the compound key, (b) populate the `identity_provider_ref` field if missing, (c) update the auth resolution logic to handle both old compound keys and new raw `external_sub` during transition. Also, JIT-created accounts may not have org access grants — those users would get 401 until the platform explicitly grants roles.

6. **SDK-first priority**: Should the React SDK identity-provider components be built before or after the backend changes? Backend first (create the APIs), then SDK (consume them), then web app (use SDK components).

## Risks

- MongoDB migration for email index removal needs backward-compatible rollout
- Removing JIT changes the authentication flow fundamentally — existing integrations may break
- Self-managed SSO changes the org spec proto (impacts all SDK codegen)
- Existing JIT-provisioned federated accounts may not have org access grants
- FGA model needs new `can_create_identity_account` permission
- getByEmail behavioral change could break existing API consumers

## Success Criteria

- [ ] Federated account creation works via explicit `createFederatedAccount` RPC with proper authorization
- [ ] MongoDB email uniqueness index removed, compound unique index on `(identity_provider_ref, external_sub)` added
- [ ] JIT provisioning code removed; compound key construction removed; federated auth resolves by IdP + external_sub and returns 401 if account doesn't exist
- [ ] Self-managed orgs can configure an IdP for SSO
- [ ] SDK React has `identity-provider/` and `iam-policy/` feature folders with hooks and components
- [ ] Web app has IdP management pages under settings
- [ ] Documentation covers the platform-managed flow with step-by-step examples
- [ ] getByEmail security leak addressed

## Next Steps

1. [ ] Review this plan and provide feedback
2. [ ] Resolve open questions through brainstorming
3. [ ] Create detailed implementation plan (T01_2_revised_plan.md)
4. [ ] Execute phase by phase: backend first, then SDK, then web app, then docs
