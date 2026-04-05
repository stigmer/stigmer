# Next Task: 20260405.02.identity-provider-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.02.identity-provider-flow

**Description**: Fix the MongoDB email uniqueness bug, remove JIT provisioning in favor of explicit platform-driven account creation, design self-managed SSO, build SDK React components and web app pages for IdP management, and write comprehensive documentation for the complete federation flow.
**Goal**: Make the identity provider flow production-ready: fix email uniqueness bug, implement explicit federated account creation with proper authorization, enable self-managed orgs to use SSO, build SDK-first UI for IdP management and role granting, and document all flows for platform builders.
**Tech Stack**: Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB
**Components**: stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityProvisionerImpl removal, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

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
**Current Task**: Phase 2 — Remove JIT Provisioning
**Status**: In Progress
**Last Session**: 2026-04-05 — Phase 1 completed (email uniqueness fix)

## Session Progress (2026-04-05)

### Completed
- **Phase 1: Fix MongoDB Email Uniqueness** — Done
  - Created `U20260405_FixEmailUniqueness.java` Mongock migration in stigmer-cloud
  - Drops unique sparse index on `spec.email`, recreates as non-unique ascending index
  - Committed to stigmer-cloud: `118a88a4`

### Key Design Decision: No `external_sub` Field
- Decided NOT to add a separate `external_sub` field to `IdentityAccountSpec`
- `idp_id` already means "the identity provider's subject identifier" for all account types
- For federated accounts: store the raw OIDC `sub` in `idp_id` (instead of the compound key `federated:{providerId}:{sub}`)
- `identity_provider_ref` (field 8, already exists) provides the IdP scoping
- Compound unique index `(identity_provider_ref, idp_id)` will come in Phase 3

### Codebase Understanding Gathered
- Mapped the full federated auth flow: `AuthenticationTokenParser` → `RequestCallerIdentityMapper` → `FederatedIdentityProvisionerImpl`
- Identified all files that construct/use the compound `federated:` key prefix
- Reviewed FGA model for organization and identity_account
- Verified existing `IamPermission` enum (current values through `login_to_back_office = 20`)
- Reviewed `organization.fga` — `can_create_idp: admin` exists, need to add `can_create_identity_account: admin`

## Next Steps

1. **Phase 2: Remove JIT Provisioning**
   - Rename `FederatedIdentityProvisioner` interface to `FederatedIdentityResolver`
   - Remove provisioning logic from `FederatedIdentityProvisionerImpl` (keep resolve-only)
   - Remove `buildCompoundIdpId()` from `AuthenticationTokenParser`
   - Change federated auth to look up by `(identity_provider_ref, idp_id)` instead of compound key
   - Return 401 if federated account not found (instead of JIT creating)

2. **Phase 3: New createFederatedAccount RPC**
   - Add `CreateFederatedAccountInput` message to `io.proto`
   - Add `createFederatedAccount` RPC to `command.proto`
   - Add `can_create_identity_account` to `IamPermission` enum and `organization.fga`
   - Implement handler in stigmer-cloud
   - Add compound unique index `(identity_provider_ref, idp_id)` in new migration

3. Phases 4-8 follow (self-managed SSO, getByEmail security, SDK, web app, docs)

## Context for Resume

- The `FederatedIdentityProvisionerImpl.java` is at `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/`
- The `AuthenticationTokenParser.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/jwt/`
- The `RequestCallerIdentityMapper.java` is at `stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/`
- Current migration order is `"008"` — next migration should be `"009"`
- Branch: `feat/identity-provider-flow` (stigmer), `main` (stigmer-cloud)

## Quick Commands

After loading context:
- "Start Phase 2" - Begin removing JIT provisioning
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
