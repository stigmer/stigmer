# Next Task: 20260405.02.identity-provider-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.02.identity-provider-flow

**Description**: Fix the MongoDB email uniqueness bug, remove JIT provisioning in favor of explicit platform-driven account creation, design self-managed SSO, build SDK React components and web app pages for IdP management, and write comprehensive documentation for the complete federation flow.
**Goal**: Make the identity provider flow production-ready: fix email uniqueness bug, implement explicit federated account creation with proper authorization, enable self-managed orgs to use SSO, build SDK-first UI for IdP management and role granting, and document all flows for platform builders.
**Tech Stack**: Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB
**Components**: stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityResolverImpl, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-05 09:00
**Current Task**: SSO Login Flow (next project phase)
**Status**: Federation hardening complete — All gaps from architecture review closed
**Last Session**: 2026-04-07 — Session 10: IdP federation hardening (issuer uniqueness + cache invalidation)

## Session Progress (2026-04-07, Session 10)

### Federation Hardening — Done (Session 10)

Closed two production-readiness gaps identified during architecture review:

- **Global issuer uniqueness at write time**: New `ValidateIssuerUniqueness` pipeline step in create/update handlers rejects duplicate issuers with `ALREADY_EXISTS`. Backed by MongoDB unique multikey index on `spec.allowedIssuers` (migration `U20260407_IssuerUniquenessIndex`, order "011").
- **Cache invalidation on IdP mutations**: New `InvalidateFederationCaches` pipeline step calls `issuerCache.invalidate()` + `decoderCache.evictAll()` after create/update. Inner class `InvalidateCachesOnDelete` does the same on delete. Changes take effect immediately instead of waiting for 5-minute TTL.
- **Tests**: 5 tests for issuer uniqueness, 2 for cache invalidation, 2 new tests added to existing `IdentityProviderIssuerCacheTest`.
- All changes in stigmer-cloud on branch `feat/sso-login-flow`.

### Phase 8: Documentation — Done (Session 9)
- **New concepts page**: `docs/concepts/identity.mdx` — three account types (direct, federated, machine), Identity Provider trust model, federated auth sequence diagram, authorization basics
- **New "Guides" section**: `docs/guides/` — new top-level sidebar section between Concepts and SDK Reference
- **Federation guide** (`docs/guides/federation/`, 5 pages):
  - `overview.mdx` — architecture diagram, prerequisites, card navigation to sub-pages
  - `register-identity-provider.mdx` — IdP creation with 4-language SDK examples, field reference, Auth0/Okta/Entra ID/Cognito instructions
  - `provision-federated-accounts.mdx` — check-then-create pattern (`getByExternalSub` + `createFederatedAccount`), complete handler example
  - `grant-access.mdx` — IAM Policy grants, complete onboarding flow, revocation with `revokeOrgAccess`
  - `authentication-flow.mdx` — 10-step sequence diagram, token requirements, 401 vs 403 diagnosis, troubleshooting checklist
- Updated `docs/meta.json` and `docs/concepts/meta.json` for sidebar ordering
- Added OIDC-related terms to Vale vocabulary (`accept.txt`)
- All 6 doc files pass Vale linting (0 errors) and Prettier formatting
- Committed: `8ffb9ea6`

## Session Progress (2026-04-05)

### Completed
- **Phase 1: Fix MongoDB Email Uniqueness** — Done (Session 1)
  - Created `U20260405_FixEmailUniqueness.java` Mongock migration in stigmer-cloud
  - Drops unique sparse index on `spec.email`, recreates as non-unique ascending index
  - Committed to stigmer-cloud: `118a88a4`

- **Phase 2: Remove JIT Provisioning** — Done (Session 2)
  - Renamed `FederatedIdentityProvisioner` -> `FederatedIdentityResolver` (interface + impl)
  - Removed compound `idp_id` key (`federated:{providerId}:{sub}` -> raw OIDC `sub` claim)
  - Removed `userInfoEndpoint` from `FederatedAuthenticationToken`
  - Changed federated auth to resolve-only: 401 when account not found
  - Added compound lookup `findByIdentityProviderRefAndIdpId` to `IdentityAccountRepo`
  - Updated proto comments, 7 docs, all tests, all Javadoc references

- **Phase 3: New createFederatedAccount RPC** — Done (Session 3)
  - **Proto (stigmer repo)**:
    - `CreateFederatedAccountInput` message in `io.proto` (org, identity_provider_ref, external_sub, email, first_name, last_name, picture_url)
    - `createFederatedAccount` RPC in `command.proto` with org-level FGA authorization
    - `can_create_identity_account = 21` in `IamPermission` enum
    - All stubs regenerated (Go, Java, Python, TypeScript, SDK clients, MCP server)
    - Committed: `f951e610`
  - **Backend (stigmer-cloud repo)**:
    - `can_create_identity_account: admin` in `organization.fga`
    - `CreateFederatedAccountHandler.java` — `CustomOperationHandlerV2` with 7-step pipeline:
      validateFieldConstraints -> authorize -> ValidateIdentityProvider -> CheckDuplicate -> CreateAccount -> transformResponse -> sendResponse
    - `U20260405_FederatedAccountUniqueness.java` — Mongock migration (order "009") creating partial compound unique index on `(identityProviderRef.org, identityProviderRef.slug, idpId)` scoped to federated accounts only
    - All stubs regenerated (Go, Java, Python, TypeScript, Dart)
    - Committed: `f293583d`

- **Phase 4: Self-Managed SSO Data Model** — Done (Session 4)
  - **Design Decision**: SSO config lives on IdentityProvider, NOT Organization
    - OrganizationSpec was NOT modified — avoids coupling org to IdP lifecycle
    - `is_sso_provider` (bool) and `oidc_client_id` (string) added to `IdentityProviderSpec`
    - PKCE-based (no client_secret) — web app is a public client
  - **Proto (stigmer repo)**:
    - `is_sso_provider` (field 7) and `oidc_client_id` (field 8) on `IdentityProviderSpec`
    - `getSsoProvider(OrganizationSsoLookup) returns (SsoProviderInfo)` RPC on query controller
    - `OrganizationSsoLookup` and `SsoProviderInfo` messages in `io.proto`
    - All stubs regenerated
  - **Backend (stigmer-cloud repo)**:
    - `ValidateSsoFields.java` — shared pipeline step (cross-field, uniqueness, platform-delegation guard)
    - `IdentityProviderGetSsoProviderHandler.java` — unauthenticated SSO discovery endpoint
    - Wired into both create and update handler pipelines
    - All stubs regenerated

- **Phase 5: Secure Identity Account Lookups** — Done (Session 5)
  - Fixed `getByIdpId` handler: removed Auth0 -> email -> findByEmail indirection, uses direct `findByIdpId`
  - Scoped `getByEmail` to direct accounts only (excludes federated via identityProviderRef exists-check)
  - Added `getByExternalSub` query RPC for IdP-scoped federated account lookups
  - `ExternalSubLookup` message (org + identity_provider_ref + external_sub) with org-level authorization
  - `IdentityAccountGetByExternalSubHandler.java` — new handler using `findByIdentityProviderRefAndIdpId`
  - Fixed Auth0 Temporal activity duplicate-key fallback (`getByIdpId` instead of `getByEmail`)
  - Removed dead `EmailToIdentityAccountIdCacheProxy` and `EmailToIdpIdCacheProxy`
  - Cleaned up Redis cache methods used only by dead proxies
  - All stubs regenerated in both repos

- **Phase 6: Identity Provider React SDK** — Done (Session 6)
  - **Prerequisite — listByOrg RPC**:
    - `ListIdentityProvidersByOrgInput` message in `io.proto`, `listByOrg` RPC in `query.proto` with org-level `can_view` authorization
    - `IdentityProviderListByOrgHandler.java` in stigmer-cloud using `findByOrg(org)` repo method
    - Full codegen pipeline (`make protos`) — regenerated all stubs
  - **React SDK feature folder** (`sdk/react/src/identity-provider/`, 9 files):
    - Data hooks: `useIdentityProviderList(org)`, `useIdentityProvider(id)`, `useSsoProvider(org)`
    - Mutation hooks: `useCreateIdentityProvider()`, `useUpdateIdentityProvider()`, `useDeleteIdentityProvider()`
    - Styled components: `IdentityProviderListPanel`, `CreateIdentityProviderForm`
    - Feature barrel + root barrel exports
  - TypeScript type check passes cleanly
  - Decision: SearchService doesn't index IdPs — dedicated `listByOrg` RPC is correct approach
  - Decision: `useSsoProvider` treats NOT_FOUND as absence (null), not error — for unauthenticated login pages
  - Decision: IAM policy hooks/components already exist from separate project — will be composed in Phase 7

- **Phase 7: Web App IdP Management Pages** — Done (Session 7)
  - **SDK React** (`sdk/react/src/identity-provider/`, 5 new files):
    - `presets.ts` — Provider presets for Auth0, Okta, Google, Entra ID, AWS Cognito, Custom OIDC with deterministic URL template construction
    - `useOidcDiscovery.ts` — Behavior hook for browser-side OIDC Discovery (Custom OIDC path only) with CORS fallback
    - `ProviderPicker.tsx` — Responsive 3-column grid of provider cards with thematic SVG icons
    - `IdentityProviderWizard.tsx` — 3-step guided creation: pick provider → configure → review + create
    - `IdentityProviderDetailPanel.tsx` — View/edit panel with structured read-only display and inline edit mode
    - Barrel exports updated in `index.ts` and `sdk/react/src/index.ts`
  - **Console** (`client-apps/web/`, 3 new files, 2 modified):
    - Added "Identity Providers" nav item to ManagementSidebar with ShieldCheck icon
    - `/settings/identity-providers` route + `IdentityProvidersSection` with idle/creating/editing flow state
    - Settings layout description updated to include identity providers
  - Decision: Template-based presets (no network calls) for known providers; OIDC Discovery only for Custom OIDC
  - Decision: Wizard augments, doesn't replace `CreateIdentityProviderForm`
  - Decision: SSO login flow deferred — only management CRUD pages built
  - TypeScript type check clean (zero new errors)

### Key Design Decisions
- **`idp_id` is not globally unique, but that's fine**: For direct/Auth0 accounts, idp_id is effectively unique. For federated accounts, uniqueness is the compound `(identityProviderRef.org, identityProviderRef.slug, idpId)`. No changes needed.
- **`getByIdpId` uses direct `findByIdpId`**: Removed Auth0 Management API call + email indirection. Auth0 IDs are unique within the tenant.
- **`getByEmail` scoped to direct accounts**: Added `identityProviderRef.org exists(false)` filter to prevent cross-trust-boundary leaks.
- **`getByExternalSub` reuses `can_create_identity_account`**: If a platform can create federated accounts, it can check existence. No new permission needed.
- **SDK policy**: All RPCs stay in SDKs. Access controlled via FGA. Internal intent documented in proto comments.
- **No `external_sub` field in DB**: `idp_id` already serves as the identity provider's subject identifier; `external_sub` is the API-facing name, mapped to `idp_id` on creation
- **No data migration**: No federated account data exists — clean switch to new model
- **`Optional<String>` resolver return**: Policy decisions (401) belong in the mapper, not the resolver
- **Redis cache key `{org}/{slug}:{sub}`**: Matches MongoDB compound lookup fields
- **No UserInfoClient during creation**: Platform backend is trusted source of truth for profile data; no need to call the IdP's userinfo endpoint during account creation
- **Org slug (not org_id)** in `CreateFederatedAccountInput`: Consistent with existing RPCs like `IdentityProviderCommandController.create` which use `field_path = "metadata.org"` (slug-based)
- **Partial compound unique index**: Scoped to documents where `spec.identityProviderRef.org` exists, excluding direct/machine accounts from the uniqueness constraint
- **Delegation to existing create pipeline**: `CreateAccount` step delegates to `IdentityAccountGrpcRepo.create()` which handles ID generation, metadata, MongoDB persistence, and FGA tuple creation
- **SSO config on IdentityProvider, not Organization**: SSO is an IdP-level concern. OrganizationSpec not modified. Web app discovers SSO by querying IdPs for the org.
- **PKCE (no client_secret)**: Web app is a public client using OIDC Authorization Code + PKCE. Standard for SPAs.
- **SsoProviderInfo projection**: Unauthenticated SSO discovery returns only display_name, oidc_client_id, issuer — not full IdP config.
- **Platform delegation vs SSO separation**: An IdP used for platform-managed orgs cannot also be an SSO provider — different trust models enforced by ValidateSsoFields guard.

### Codebase Understanding Gathered
- Mapped the full federated auth flow: `FederatedJwtAuthenticationProvider` -> `RequestCallerIdentityMapper` -> `FederatedIdentityResolverImpl`
- Identified all files that construct/use the compound `federated:` key prefix (all removed)
- Reviewed FGA model for organization and identity_account
- Verified `IamPermission` enum — values through `can_create_identity_account = 21`
- `CustomOperationHandlerV2<TRequest, TResponse>` pattern for RPCs with different input/output types
- `@RequestRoute` annotation with `IdentityAccountCommandController.Method.createFederatedAccount` — auto-generated by `@AutoGrpcRouterController` annotation processor
- `commonSteps.authorize` works in `CustomOperationHandlerV2` pipelines (validated via `IdentityAccountDeleteHandler` pattern)
- `IdentityAccountGrpcRepo.create()` via `inProcessChannelAsSystem` handles all downstream concerns (persistence, FGA tuples, ID gen)

## Next Steps

1. **SSO login flow** — OIDC RP flow on Stigmer's login page, auto-provisioning of federated accounts for SSO
2. **SSO documentation** — `docs/guides/federation/sso.mdx` page (after SSO login flow is built)

## Context for Resume

- The `CreateFederatedAccountHandler.java` is at `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/request/handler/`
- The `FederatedIdentityResolverImpl.java` is at `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/`
- The `AuthenticationTokenParser.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/jwt/`
- The `RequestCallerIdentityMapper.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/`
- Current migration order is `"011"` — next migration should be `"012"`
- Branch: `feat/identity-provider-flow` (stigmer), `main` (stigmer-cloud)
- stigmer-cloud `main` is ahead of `origin/main` by 5 commits (Phases 1-3 unpushed)

## Quick Commands

After loading context:
- "Start SSO login flow" - Begin the next phase
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review plan" - Check `tasks/T01_0_plan.md` for full project details

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/next-task.md` - Implement org-aware SSO login flow in the web app, add updateFederatedAccount and deprovisionFederatedAccount lifecycle RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL in the IdP management screen.
