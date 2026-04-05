# Self-Managed SSO Data Model for IdentityProvider

**Date**: April 5, 2026

## Summary

Added SSO capability fields (`is_sso_provider`, `oidc_client_id`) to `IdentityProviderSpec` and a public discovery RPC (`getSsoProvider`) that the web app will use to render SSO login buttons. This lays the data model foundation for self-managed organizations to offer "Sign in with Okta/Azure AD" on Stigmer's login page, with the web app OIDC implementation deferred to Phase 7.

## Problem Statement

Self-managed organizations had no way to configure SSO for their team members. While the federated authentication flow already worked at the API level (JWTs from external IdPs are validated and resolved), there was no **discoverability** layer: the web app had no way to know that an org has SSO enabled, what OIDC client to use, or where to redirect the user for login.

### Pain Points

- No mechanism to declare an IdP as the SSO login provider for an org
- No unauthenticated endpoint for the web app to discover SSO config before login
- No validation to prevent multiple SSO providers per org or mixing SSO with platform delegation

## Solution

SSO configuration lives on the `IdentityProvider` resource, not on `Organization`. This follows the principle that the IdP knows how to authenticate — the org just needs to discover which IdP is its SSO provider by querying IdPs in its scope.

Key design decisions:
- **Option B selected**: `is_sso_provider` on `IdentityProviderSpec` rather than `sso_identity_provider_ref` on `OrganizationSpec`. Avoids coupling org to IdP lifecycle and bidirectional references.
- **PKCE (no client_secret)**: Web app is a public client using OIDC Authorization Code + PKCE. Standard for SPAs per Auth0, Okta, and Azure AD recommendations.
- **SsoProviderInfo projection**: The discovery endpoint returns only display_name, oidc_client_id, and issuer — not the full IdP resource. Security boundary for pre-login access.

## Implementation Details

### Proto changes (stigmer repo)

- **`spec.proto`**: Added `is_sso_provider` (field 7, bool) and `oidc_client_id` (field 8, string max 256) to `IdentityProviderSpec`. Added SSO example YAML to message documentation.
- **`io.proto`**: Added `OrganizationSsoLookup` and `SsoProviderInfo` messages.
- **`query.proto`**: Added `getSsoProvider` RPC with `is_skip_authorization = true` (unauthenticated).

### Backend (stigmer-cloud repo)

- **`ValidateSsoFields.java`**: Standalone `@Component` pipeline step typed to `ContextBase` (shared by create and update), implementing three checks:
  1. Cross-field consistency: `is_sso_provider=true` requires `oidc_client_id`, and vice versa
  2. Uniqueness: at most one SSO IdP per org (MongoDB query, excludes self on update)
  3. Platform-delegation guard: IdPs referenced by platform-managed orgs cannot be SSO providers
- **`IdentityProviderGetSsoProviderHandler.java`**: `CustomOperationHandlerV2<OrganizationSsoLookup, SsoProviderInfo>` with inner `LoadSsoProvider` step. Unauthenticated.
- **Create/Update handlers**: Wired `ValidateSsoFields` into both pipelines.

### Stubs regenerated

Go, Java, Python, TypeScript, Dart across both repos. SDK clients (Go, Java, Python, TypeScript) updated. MCP server and codegen schemas updated.

## Benefits

- Self-managed orgs can now configure SSO at the data model level
- Clean separation: SSO and platform delegation are enforced as distinct concerns
- Unauthenticated discovery endpoint enables the web app login page to render SSO buttons without requiring the user to be logged in first
- PKCE approach means no secrets stored — reduces security surface

## Impact

- **IdentityProvider resource**: Two new spec fields, one new query RPC
- **OrganizationSpec**: NOT modified — zero coupling to IdP lifecycle
- **Federated auth flow**: NOT modified — already works for SSO
- **Web app**: Will consume `getSsoProvider` in Phase 7 to build the OIDC login flow
- **SDK clients**: New fields available in all language SDKs

## Related Work

- Phase 1: MongoDB email uniqueness fix (Session 1)
- Phase 2: JIT provisioning removal (Session 2)
- Phase 3: `createFederatedAccount` RPC (Session 3)
- Phase 5 (next): Secure `getByEmail` — org-scoped authorization
- Phase 7 (future): Web app OIDC Relying Party implementation

---

**Status**: Production Ready (data model and validation; web app OIDC flow deferred to Phase 7)
**Timeline**: Session 4 of the identity-provider-flow project
