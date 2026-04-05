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
**Current Task**: Phase 4 — Self-Managed SSO (org.spec.is_self_managed flag)
**Status**: Not Started
**Last Session**: 2026-04-05 — Phase 3 completed (createFederatedAccount RPC)

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

### Key Design Decisions
- **No `external_sub` field in DB**: `idp_id` already serves as the identity provider's subject identifier; `external_sub` is the API-facing name, mapped to `idp_id` on creation
- **No data migration**: No federated account data exists — clean switch to new model
- **`Optional<String>` resolver return**: Policy decisions (401) belong in the mapper, not the resolver
- **Redis cache key `{org}/{slug}:{sub}`**: Matches MongoDB compound lookup fields
- **No UserInfoClient during creation**: Platform backend is trusted source of truth for profile data; no need to call the IdP's userinfo endpoint during account creation
- **Org slug (not org_id)** in `CreateFederatedAccountInput`: Consistent with existing RPCs like `IdentityProviderCommandController.create` which use `field_path = "metadata.org"` (slug-based)
- **Partial compound unique index**: Scoped to documents where `spec.identityProviderRef.org` exists, excluding direct/machine accounts from the uniqueness constraint
- **Delegation to existing create pipeline**: `CreateAccount` step delegates to `IdentityAccountGrpcRepo.create()` which handles ID generation, metadata, MongoDB persistence, and FGA tuple creation

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

1. **Phase 4: Self-Managed SSO** (org.spec.is_self_managed flag)
   - Add `is_self_managed` boolean to Organization spec proto
   - Modify IdP creation to enforce org is self-managed
   - Update FGA model if needed

2. **Phase 5: Secure getByEmail** — Add org-scoped authorization to email lookups

3. **Phases 6-8**: SDK React components, web app IdP management pages, documentation

## Context for Resume

- The `CreateFederatedAccountHandler.java` is at `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/request/handler/`
- The `FederatedIdentityResolverImpl.java` is at `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/`
- The `AuthenticationTokenParser.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/jwt/`
- The `RequestCallerIdentityMapper.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/`
- Current migration order is `"009"` — next migration should be `"010"`
- Branch: `feat/identity-provider-flow` (stigmer), `main` (stigmer-cloud)
- stigmer-cloud `main` is ahead of `origin/main` by 5 commits (Phases 1-3 unpushed)

## Quick Commands

After loading context:
- "Start Phase 4" - Begin self-managed SSO org flag
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review plan" - Check `tasks/T01_0_plan.md` for full Phase 4-8 details

---

*This file provides direct paths to all project resources for quick context loading.*
