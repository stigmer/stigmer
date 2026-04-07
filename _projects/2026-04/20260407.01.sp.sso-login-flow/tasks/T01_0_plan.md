# Task T01: SSO Login Flow — Analysis and Implementation Plan

**Created**: 2026-04-07
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260405.02.identity-provider-flow

**This plan requires your review before execution.**

## Objective

Enable org-specific SSO authentication in the Stigmer web app, complete the federated account lifecycle with update and deprovision RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL on the IdP management screen.

## Parent Context

This sub-project builds on all 8 completed phases of `20260405.02.identity-provider-flow`:

- **Phase 4** built the SSO data model: `is_sso_provider`, `oidc_client_id` on `IdentityProviderSpec`, `getSsoProvider` unauthenticated RPC returning `SsoProviderInfo { display_name, oidc_client_id, issuer }`, `ValidateSsoFields` guard
- **Phase 6** built React SDK hooks: `useSsoProvider(org)`, `useIdentityProviderList`, `useCreateIdentityProvider`, etc.
- **Phase 7** built web app IdP management pages: `IdentityProviderDetailPanel`, `IdentityProviderWizard`, `/settings/identity-providers` route
- Backend already validates federated JWTs via `FederatedJwtAuthenticationProvider` (issuer → IdP → JWKS) and resolves accounts via `FederatedIdentityResolverImpl`

## Key Design Decisions (from planning discussion)

1. **Org discovery**: URL-based (`/login?org=acme`) + manual text input on login page as fallback
2. **SSO auto-provisioning**: Auto-create federated accounts on first SSO login for self-managed orgs only (not platform-managed). The org admin enabling `is_sso_provider` is an explicit opt-in to "anyone from my IdP can log in."
3. **`SsoProviderInfo` proto gap**: Needs `expected_audience` field so the web app can construct the correct OIDC token request
4. **SSO login URL**: Visible and copyable on the `IdentityProviderDetailPanel` when `is_sso_provider` is true (e.g., `https://app.stigmer.ai/login?org=acme`)
5. **Federated account lifecycle**: Add `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs with natural-key lookup (`identity_provider_ref` + `external_sub`), authorized at org level
6. **Multiple IdPs per org**: No change needed — one IdP per platform-managed org, one SSO provider per self-managed org (already enforced)

## Detailed Implementation Plan

### Phase 1: Proto Changes — Lifecycle RPCs + SsoProviderInfo Enhancement

**Repo**: stigmer (apis/)

#### 1a. Add `expected_audience` to `SsoProviderInfo`

**File**: `apis/ai/stigmer/iam/identityprovider/v1/io.proto`

Add `string expected_audience = 4` to `SsoProviderInfo`. The web app needs this to pass the correct `audience` parameter in the OIDC authorization request. Without it, the IdP may issue tokens with a default audience that doesn't match what the backend expects.

Update `IdentityProviderGetSsoProviderHandler.java` in stigmer-cloud to populate this field from the IdP's `spec.expectedAudience`.

#### 1b. Add `updateFederatedAccount` RPC

**Files**:
- `apis/ai/stigmer/iam/identityaccount/v1/command.proto` — new RPC
- `apis/ai/stigmer/iam/identityaccount/v1/io.proto` — new `UpdateFederatedAccountInput` message

```protobuf
message UpdateFederatedAccountInput {
  string org = 1;
  ApiResourceReference identity_provider_ref = 2;
  string external_sub = 3;  // natural key lookup
  string email = 4;
  string first_name = 5;
  string last_name = 6;
  string picture_url = 7;
}
```

RPC authorized with `can_create_identity_account` on organization (same permission as create — if you can create accounts, you can update them). The handler looks up by `(identity_provider_ref, external_sub)` and updates only profile fields.

#### 1c. Add `deprovisionFederatedAccount` RPC

**Files**:
- `apis/ai/stigmer/iam/identityaccount/v1/command.proto` — new RPC
- `apis/ai/stigmer/iam/identityaccount/v1/io.proto` — new `DeprovisionFederatedAccountInput` message

```protobuf
message DeprovisionFederatedAccountInput {
  string org = 1;
  ApiResourceReference identity_provider_ref = 2;
  string external_sub = 3;  // natural key lookup
  bool delete_account = 4;  // false = revoke access only, true = revoke + delete
}
```

RPC authorized with `can_create_identity_account` on organization. The handler:
1. Looks up federated account by `(identity_provider_ref, external_sub)`
2. Calls `revokeOrgAccess` to remove all IAM policies for this account in the org
3. If `delete_account = true`, deletes the identity account and cleans up FGA tuples
4. Returns the deprovisioned `IdentityAccount` for audit

#### 1d. Regenerate all stubs

Run `make protos` in stigmer repo to regenerate Go, Java, Python, TypeScript, SDK clients, MCP server stubs.

### Phase 2: Backend — Lifecycle RPC Handlers

**Repo**: stigmer-cloud (backend/)

#### 2a. Update `IdentityProviderGetSsoProviderHandler`

Add `expectedAudience` field population from `spec.expectedAudience` in the `LoadSsoProvider` step.

#### 2b. `UpdateFederatedAccountHandler.java`

New handler following `CustomOperationHandlerV2` pattern:

Pipeline: `validateFieldConstraints` → `authorize` → `lookupByExternalSub` → `updateProfileFields` → `transformResponse` → `sendResponse`

The `lookupByExternalSub` step uses `identityAccountRepo.findByIdentityProviderRefAndIdpId(org, slug, externalSub)`. Only updates `email`, `first_name`, `last_name`, `picture_url` — identity keys are immutable.

#### 2c. `DeprovisionFederatedAccountHandler.java`

New handler following `CustomOperationHandlerV2` pattern:

Pipeline: `validateFieldConstraints` → `authorize` → `lookupByExternalSub` → `revokeOrgAccess` → `conditionalDelete` → `transformResponse` → `sendResponse`

The `revokeOrgAccess` step delegates to `IamPolicyGrpcRepo.revokeOrgAccess(identityAccountId, orgId)`. The `conditionalDelete` step checks `delete_account` flag and, if true, delegates to `IdentityAccountGrpcRepo.delete()`.

#### 2d. Regenerate stubs

Run stub generation in stigmer-cloud.

### Phase 3: Backend — SSO Auto-Provisioning

**Repo**: stigmer-cloud (backend/)

This is the key behavioral change: when a user authenticates via an SSO-enabled IdP and no federated account exists, auto-create one.

#### 3a. Modify `FederatedIdentityResolverImpl`

Current behavior: resolve → Optional.empty() → caller gets 401.

New behavior for SSO IdPs:
1. Resolve by `(org, slug, sub)` — if found, return (unchanged)
2. If not found, check if the IdP has `is_sso_provider = true`
3. If SSO provider → auto-provision: create a federated identity account with profile data from the JWT claims (`email`, `name`, `picture` from standard OIDC claims)
4. Grant **viewer** role on the org via IAM policy (not member — member enables billable agent executions; org admin must explicitly upgrade)
5. Cache and return the new account ID
6. If NOT SSO provider → return empty (unchanged — platform-managed flow requires pre-provisioning)

**Key distinction**: This auto-provisioning ONLY applies to SSO IdPs (`is_sso_provider = true`). Platform-managed IdPs still require explicit `createFederatedAccount` calls.

#### 3b. Expand `FederatedAuthenticationToken` (if needed)

The resolver currently receives `(sub, org, slug)`. For auto-provisioning, it also needs profile data from the JWT (email, name, picture). These are standard OIDC claims in the JWT payload. The `FederatedJwtAuthenticationProvider` already has access to the decoded `Jwt` object — we may need to pass additional claims through to the resolver.

**Alternative**: The resolver can call the IdP's `userinfo_endpoint` to get profile data. But the parent project's design decision was "No UserInfoClient during creation" — the trusted source is the JWT claims themselves. For SSO, the JWT will contain standard OIDC claims (`email`, `name`, `picture`) if the IdP is configured with the right scopes.

**Approach**: Add the decoded `Jwt` (or extracted profile claims) to the resolver interface so auto-provisioning has the data it needs without an extra network call.

#### 3c. `IdentityProviderSsoCache`

The resolver needs to quickly check if an IdP is an SSO provider. Options:
- Query MongoDB on every miss (simple but adds latency to first auth)
- Add `is_sso_provider` to the existing `IdentityProviderIssuerCache` (already cached, already reloads on IdP changes)

**Recommended**: Extend `IdentityProviderIssuerCache` to include the `is_sso_provider` flag. The cache already holds the full `IdentityProvider` document — just access `spec.isSsoProvider` from it.

### Phase 4: Web App — SSO Login Page

**Repo**: stigmer (client-apps/web/)

This is the user-facing SSO flow on the login page.

#### 4a. Login page with org discovery

Create a `/login` page (or modify the existing auth flow) that:

1. Checks URL for `?org=<slug>` query parameter
2. If no org in URL, shows a text field: "Enter your organization" with a "Continue" button
3. Calls `getSsoProvider(org)` via the SDK's unauthenticated client
4. If SSO provider found → shows "Sign in with [display_name]" button alongside the standard "Sign in" button
5. If NOT_FOUND → proceeds with standard Auth0 login only

#### 4b. SSO OIDC flow

When user clicks the SSO button:

1. Save SSO context to `sessionStorage`: `stigmer:sso:config` with `{ issuer, clientId, audience, org }`
2. Create a temporary `UserManager` with the SSO provider's config
3. Call `signinRedirect()` → browser redirects to the org's IdP

#### 4c. Callback handling

Modify `OidcAuthProvider.tsx` to detect SSO state:

1. On `/auth/callback`, check `sessionStorage` for `stigmer:sso:config`
2. If present → create SSO `UserManager` with saved config → `signinRedirectCallback()`
3. If not present → use default Auth0 `UserManager` (existing behavior)
4. After successful exchange, clean up SSO sessionStorage state
5. Set access token and redirect to saved path (existing pattern)

#### 4d. Unauthenticated API client

The `getSsoProvider` call happens before the user is authenticated. The current `StigmerTransportBridge` only creates an authenticated client. Need a lightweight unauthenticated client (no auth interceptor) for SSO discovery.

**Approach**: The `useSsoProvider` hook in the React SDK already handles this — it's designed for unauthenticated use. Wire it into the login page component.

### Phase 5: SDK + Web App — SSO Login URL on IdP Detail Panel

**Repo**: stigmer (sdk/react/ + client-apps/web/)

#### 5a. Construct SSO login URL

When `is_sso_provider` is true on an IdP, compute the SSO login URL:

```
{app_base_url}/login?org={metadata.org}
```

The `app_base_url` comes from the web app's runtime config (or a well-known Stigmer console URL).

#### 5b. Update `IdentityProviderDetailPanel`

Add a read-only field to the detail panel when `is_sso_provider` is true:

- Label: "SSO Login URL"
- Value: the computed URL
- Copy button (click to copy to clipboard)
- Helper text: "Share this URL with your team members to sign in via SSO"

This appears alongside the existing SSO toggle and OIDC client ID fields.

### Phase 6: Documentation

**Repo**: stigmer (docs/)

#### 6a. Update federation guide

Add a new page to `docs/guides/federation/`: **`sso-login.mdx`** covering:
- How to enable SSO for a self-managed org
- How to share the SSO login URL with team members
- The end-to-end SSO authentication flow
- Auto-provisioning behavior (first login creates account with member role)
- Troubleshooting common SSO issues

#### 6b. Update SDK reference

Document the new `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs with multi-language examples.

#### 6c. Update existing federation pages

- `provision-federated-accounts.mdx` — add section on the update + deprovision lifecycle
- `authentication-flow.mdx` — add SSO-specific sequence diagram

## Phase Dependencies

```
Phase 1 (Proto)
  ├── Phase 2 (Backend handlers) ── depends on Phase 1 stubs
  ├── Phase 3 (SSO auto-provisioning) ── depends on Phase 1 stubs
  └── Phase 5 (SSO URL in UI) ── partially independent, needs Phase 1 for expected_audience
Phase 4 (Web app SSO login) ── depends on Phase 1 (SsoProviderInfo.expected_audience) + Phase 3 (auto-provisioning)
Phase 6 (Docs) ── depends on all above
```

Phases 2 and 3 can be done in parallel after Phase 1.
Phase 5 can be done in parallel with Phases 2-4 (only needs the org slug, no new proto dependency).

## Resolved Design Decision

**SSO auto-provisioning with viewer role** (approved 2026-04-07): When a user authenticates via an SSO-enabled IdP and no account exists, auto-create a federated identity account and grant the **viewer** role on the organization. NOT the member role — member enables agent execution creation which involves money. Users start as viewers and must be explicitly upgraded to member by an org admin.

- Applies to self-managed SSO orgs only (`is_sso_provider = true`)
- Platform-managed IdPs are unchanged — require explicit `createFederatedAccount`
- See `design-decisions/001-sso-auto-provisioning-viewer-role.md`

## Success Criteria

- [ ] `SsoProviderInfo` includes `expected_audience` field
- [ ] `updateFederatedAccount` RPC works end-to-end with natural key lookup
- [ ] `deprovisionFederatedAccount` RPC works end-to-end (revoke-only and revoke+delete modes)
- [ ] Web app login page supports org discovery via URL param and text input
- [ ] Web app SSO login flow works: discover → redirect to IdP → callback → authenticated
- [ ] SSO auto-provisioning creates federated account with **viewer** role on first login (self-managed orgs)
- [ ] Platform-managed IdPs still require explicit `createFederatedAccount` (no auto-provisioning)
- [ ] SSO login URL is visible and copyable on `IdentityProviderDetailPanel` when `is_sso_provider` is true
- [ ] All stubs regenerated in both repos
- [ ] Federation documentation updated with SSO login flow
- [ ] TypeScript type check clean

## Risks

- **Callback URL conflict**: SSO and Auth0 share `/auth/callback` — sessionStorage-based routing must be robust
- **Audience mismatch**: Different IdPs handle the `audience` parameter differently (Auth0 vs Okta vs Entra ID) — need to handle gracefully
- **Auto-provisioning security**: SSO auto-provisioning must only apply to `is_sso_provider` IdPs, never platform-managed ones
- **JWT claims availability**: Not all IdPs include `email`/`name`/`picture` in access tokens — may need id_token or userinfo fallback
- **CORS on OIDC Discovery**: External IdPs may not allow browser-side `.well-known/openid-configuration` fetch — `oidc-client-ts` handles this but edge cases exist

## Estimated Effort

| Phase | Description | Estimate |
|-------|-------------|----------|
| 1 | Proto changes + codegen | 1 session |
| 2 | Backend lifecycle handlers | 1 session |
| 3 | SSO auto-provisioning | 1 session |
| 4 | Web app SSO login page | 1-2 sessions |
| 5 | SSO URL on IdP detail panel | 0.5 session |
| 6 | Documentation | 1 session |
| **Total** | | **5-6 sessions** |

## Review Process

**What happens next**:
1. **You review this plan** — Consider the approach, especially the SSO auto-provisioning decision
2. **Provide feedback** — Share any concerns or changes
3. **I'll revise the plan** — Create T01_1_review.md with feedback, then T01_2_revised_plan.md
4. **You approve** — Give explicit approval to proceed
5. **Execution begins** — Implementation tracked in T01_3_execution.md
