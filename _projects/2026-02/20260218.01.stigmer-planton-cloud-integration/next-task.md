# Next Task: 20260218.01.stigmer-planton-integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260218.01.stigmer-planton-integration

**Description**: Research and design the integration architecture for Stigmer as an agent-execution provider within Planton. Both are SaaS products with their own organizations, user accounts, and authentication. This project investigates identity federation, organization synchronization, user authentication across boundaries, and whether Stigmer should remain a standalone SaaS or become an embedded/white-label service for platforms like Planton.
**Goal**: Determine the right architecture and mechanisms for integrating Stigmer into Planton — covering identity/auth federation, organization mirroring, cross-platform user authentication, and Stigmer's product positioning (standalone SaaS vs embedded provider vs hybrid).
**Tech Stack**: Architecture design, gRPC APIs, OAuth2/OIDC, Token Exchange (RFC 8693), OIDC UserInfo, OpenFGA, Stigmer platform, Planton platform
**Components**: Stigmer identity/auth system, Stigmer organization management, Stigmer agent execution API, Stigmer token exchange endpoint, Stigmer proxy SDK, Planton identity/auth system, Planton organization management, integration API layer

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Research
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/research/
```
Review external research conducted for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-integration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-18 13:08
**Last Session**: 2026-02-20 Session 8 — Phase 1 unit test suite (83 tests across 12 files)
**Current Task**: Phase 1 is fully complete — all implementation and testing done.
**Status**: Phase 1 implementation (sessions 3–7) and unit tests (session 8) are committed. Ready for Phase 3 (Organization Lifecycle Sync) or post-MVP work.

## Session Progress (2026-02-20 Session 8)
- Designed and implemented 83 unit tests across 12 test files in `stigmer-cloud`
- 10 logical modules: org create validation (20), org update immutability (8), org getByExternalOrgId (7), org repo query (3), IdP delete guard (5), IdP getByReference (6), federated JWT auth (6), JIT provisioner (6), UserInfo + caches (15), compound IDP ID (7)
- Committed: `bcd9cbeb` (stigmer-cloud) on `feat/add-identity-provider-resource`

## Next Steps
1. Phase 3: Organization Lifecycle Sync (system-level org create/update/suspend/delete via M2M service accounts)
2. Phase 2 (Proxy SDK) was largely eliminated — platforms call Stigmer directly
3. Phase 4: Post-MVP enhancements (API keys, fine-grained role mapping, billing attribution)

## Context for Resume
- Phase 1 is fully complete — all implementation and testing committed
- **Implementation commits**: `13615713` + `fe43d1ce` (stigmer), `3a7a30d5` + `7754598d` + `235c8d1a` + `f6caf451` + `26211278` (stigmer-cloud)
- **Test commit**: `bcd9cbeb` (stigmer-cloud)
- Phase 2 Proxy SDK was eliminated (platforms call Stigmer directly). Phase 3 Organization Lifecycle Sync is the next meaningful integration work.
- Known limitation: Bazel/JUnit 5 runner incompatibility — tests compile but need to run outside Bazel

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-02/20260218.01.stigmer-planton-integration/next-task.md`

## Architecture Summary (Revised — Session 2)

### The Integration Flow

```
Planton User → Planton Backend (existing authz) → Stigmer Proxy (SDK-based)
→ Stigmer Token Exchange (validates JWT, JIT provisions identity, issues Stigmer token)
→ Stigmer APIs (uses Stigmer-native token)
```

### Key Design Decisions (Session 2)

1. **Token Exchange (RFC 8693)**: Stigmer implements a token exchange endpoint. External JWTs are exchanged for Stigmer-native tokens. API endpoints only accept Stigmer tokens.
2. **Auth0 JWKS directly**: IdentityProvider points to Auth0's public JWKS (`planton-prod.us.auth0.com/.well-known/jwks.json`). No custom key pairs needed.
3. **OIDC UserInfo for profile**: During token exchange, Stigmer calls Auth0's UserInfo endpoint to get email/name/picture. No Auth0 customization needed.
4. **Proxy SDK (not config-only image)**: Stigmer ships a Go library. Integrators write ~20 lines of Go, adding custom authz interceptors. Needed because each platform has its own org access model.
5. **JWT-only for MVP**: API key support deferred. Web console and CLI users always have JWTs.
6. **Platform is authz authority**: Planton verifies org access before requests reach the proxy. Stigmer auto-grants org membership for platform-managed orgs (safe behind authz boundary).
7. **Profile data required**: identity_account stores email, display_name, picture_url (not just idp_id). Updated on every token exchange.
8. **Two auth flows**: Per-user (token exchange) and system-level (service account/API key).

### What Changed from Session 1

- Custom JWKS on GitHub Pages → eliminated (use Auth0's public JWKS)
- Custom JWT minting in proxy → eliminated (forward Auth0 JWT to token exchange)
- Docker image with 8 env vars → SDK with interceptor hooks (~20 lines of integrator code)
- Auto-grant membership (insecure if proxy is public) → authz interceptor in SDK (platform verifies first)
- Email as optional → email as required (via UserInfo endpoint)

## Components to Build

### Stigmer Side

| # | Component | Status | Details |
|---|-----------|--------|---------|
| 1 | IdentityProvider proto | ✅ Done (session 3+5) | `userinfo_endpoint` added; authz corrected to `can_create_idp`; status simplified to `ApiResourceAuditStatus` |
| 2 | IdentityProvider CRUD | ✅ Done (session 4) | Repo, FGA model, auto-controller, 6 handlers (create/update/delete/get/getByRef/apply) |
| 3 | Token Exchange Endpoint | ❌ Eliminated | Direct JWT validation in auth interceptor replaces token exchange (decision: session 6) |
| 4 | Federated JWT Validation | ✅ Done (session 6) | Auth interceptor extension: `FederatedJwtAuthenticationProvider` + issuer/JWKS caches. Needs domain boundary refactoring. |
| 5 | JIT Identity Provisioning | ✅ Done (session 6) | `FederatedIdentityProvisionerImpl` + `UserInfoClient` + compound IDP ID. Needs refactoring to use in-process gRPC. |
| 5a | Federation Refactoring | ✅ Done (session 6+) | IdentityAccount create RPC, downstream gRPC client, provisioner refactored to in-process gRPC |
| 6 | Proxy SDK | ❌ Eliminated | Not needed — platforms call Stigmer directly with their own tokens (decision: session 6) |
| 7 | Pre-built Docker Image | 🔲 Deferred | Revisit after federation refactoring complete |

### Planton Side

| # | Component | Status | Details |
|---|-----------|--------|---------|
| 1 | Proxy program | 🔲 After Stigmer #6 | ~20 lines Go: import SDK, add authz interceptor, start |
| 2 | Deploy proxy | 🔲 After #1 | Internal service behind Planton's API gateway |

## Implementation Phases (Revised)

### Phase 1: IdentityProvider + Token Exchange (MVP Core)

- [x] Add `userinfo_endpoint` to IdentityProvider proto (corrected from `userinfo_uri` — OIDC Discovery 1.0 standard name)
- [x] Remove premature `lifecycle_state` enum from IdentityProvider proto (field 1 reserved)
- [x] Fix create RPC authorization: `can_create_idp` permission + FGA model (was incorrectly using `can_edit`)
- [x] Simplify status: use `ApiResourceAuditStatus` directly, delete wrapper message
- [x] Implement IdentityProvider CRUD in `stigmer-cloud` (FGA model, repo, auto-controller, 6 handlers)
- [x] Implement federated JWT validation in auth interceptor (replaced token exchange — session 6)
- [x] Implement JIT identity provisioning (find/create identity_account, UserInfo profile, FGA tuples — session 6)
- [x] Refactor federation provisioner to use in-process gRPC for domain boundary compliance
- [x] Extend Organization CRUD for `management_mode` + `identity_provider_ref` + `external_org_id` + `getByExternalOrgId` query

### Phase 2: Proxy SDK + Planton Integration

- [ ] Build `stigmer-proxy-sdk` Go library
- [ ] Build pre-built Docker image (SDK with zero interceptors)
- [ ] Planton builds proxy program with authz interceptor
- [ ] Integration testing: Planton user → proxy → token exchange → agent execution

### Phase 3: Organization Lifecycle Sync

- [ ] Planton calls Stigmer system API to create/update/suspend/delete orgs
- [ ] Uses service account (M2M) for system operations
- [ ] Backfill migration for existing Planton orgs

### Phase 4: Post-MVP Enhancements

- [ ] API key support through proxy (custom JWT minting fallback)
- [ ] Fine-grained role mapping (member/admin/owner from platform claims)
- [ ] Billing/usage attribution per IdentityProvider
- [ ] Rate limiting per IdentityProvider

## Quick Commands

After loading context:
- "Continue with implementation" - Start building IdentityProvider CRUD
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
