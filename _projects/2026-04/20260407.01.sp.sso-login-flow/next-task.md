# Next Task: 20260407.01.sp.sso-login-flow

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260405.02.identity-provider-flow
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260405.02.identity-provider-flow
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/next-task.md`
**Spawned From Task**: N/A

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260407.01.sp.sso-login-flow

**Description**: Implement org-aware SSO login flow in the web app, add updateFederatedAccount and deprovisionFederatedAccount lifecycle RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL in the IdP management screen.
**Goal**: Enable org-specific SSO authentication in the Stigmer web app: org discovery on the login page, dynamic OIDC flow with the org's SSO provider, auto-provisioning for self-managed SSO orgs, federated account lifecycle RPCs (update and deprovision), and a visible SSO login URL on the IdP detail panel for admins to copy and share.
**Tech Stack**: Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB
**Components**: stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityProvisionerImpl removal, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-07 11:49
**Current Task**: T01 — Phases 1–5 complete, ready for Phase 6
**Status**: In Progress
**Last Session**: 2026-04-07 Session 9 — Browser mockup scaling fix + BrowserPageCard removal

## Session Progress (2026-04-07)

### Session 1 — Multi-tenancy documentation

**Focus**: Multi-tenancy documentation (side task, not part of SSO login flow)

- Reordered docs sidebar to match Diataxis (Guides and SDK Reference before Concepts)
- Fixed factual error in `concepts/organizations.mdx` (`platform_managed` description)
- Added Management Modes and Multi-Tenant Platforms sections to Organizations concept page
- Created `docs/guides/federation/multi-tenant-setup.mdx` — new how-to guide with SDK examples in all 4 languages
- Updated federation overview with multi-tenant card link
- Added Identity Provider, Identity Account, and identity federation entries to `docs/vocabulary.md`
- Committed: `37c49f25 docs: add multi-tenant platform documentation and reorder sidebar`

### Session 2 — Multi-tenant visual demo scenario

**Focus**: Added interactive demo to the multi-tenant setup page (completing visual parity with other federation guides)

- Created `multi-tenant-setup-playback` scenario (7 steps, two-phase story: tenant onboarding + user onboarding within tenant)
- Two new files: `steps.ts` (step types, code fixtures, terminal fixtures, narration) and `index.tsx` (ScenarioPlayer component with BrowserView, CodeEditorView, TerminalView, Cursor)
- Inline components: `TenantAdminPage` (platform admin panel with tenant list) and `TenantSignupPage` (tenant-branded signup form)
- Registered in `registry.ts`, exported from `docs/index.ts`, wired into `mdx.tsx`
- Embedded `<DemoMultiTenantSetupPlayback />` in `multi-tenant-setup.mdx` after intro paragraph
- TypeScript check and Next.js build both pass (exit code 0)

### Session 3 — Visual-first Getting Started tours

**Focus**: Added multi-surface overview tours to all four Getting Started pages (side task, not part of SSO login flow)

- Created 4 new ScenarioPlayer tour scenarios: `quickstart-tour`, `first-skill-tour`, `connect-tools-tour`, `create-agent-tour`
- Each tour shows the full page journey (console → code → terminal) in 4–6 steps at the top of "What you'll build"
- Replaced custom mock UI components with real `@stigmer/react` SDK components:
  - `ApiKeyCreatedAlert` + `ApiKeyListPanel` (quickstart)
  - `McpServerDetailView` (connect-tools)
  - `AgentDetailView` (create-agent)
- Made `CodeEditorView` workspace name and `TerminalView` cwd configurable (was hardcoded to federation paths)
- Added `scroll-to` mid-step interactions for connect-tools-tour (tools/policies below fold)
- Removed redundant sections from quickstart.mdx ("See it in action", "Now try a domain question") and connect-tools.mdx (inline conversation playbacks)
- Generated narration audio for all 4 tours
- Registered all scenarios in registry, exports, and MDX
- Updated document writer role with visual fidelity and expanded demo opportunity guidelines
- Changelog: `_changelog/2026-04/2026-04-07-152815-visual-first-getting-started-tours.md`

### Session 4 — Phase 1: Proto changes (SSO login flow)

**Focus**: Implemented Phase 1 of the T01 plan — proto definitions for the SSO login flow

- **T01 plan reviewed and approved** by user during this session
- Added `expected_audience` (field 4) to `SsoProviderInfo` in `identityprovider/v1/io.proto`
  - Needed for Auth0-based SSO setups where the web app must pass `audience` in the OIDC auth request
  - Empty value = web app omits the parameter (works for Okta, Entra ID)
- Added `UpdateFederatedAccountInput` message to `identityaccount/v1/io.proto`
  - Natural-key lookup (`org`, `identity_provider_ref`, `external_sub`) + profile fields
  - Full-replace semantics matching `CreateFederatedAccountInput`
- Added `DeprovisionFederatedAccountInput` message to `identityaccount/v1/io.proto`
  - Natural-key lookup + `delete_account` boolean (revoke-only vs revoke+delete)
- Added `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs to `identityaccount/v1/command.proto`
  - Both use `can_create_identity_account` on organization (same as `createFederatedAccount`)
- Regenerated all stubs via `make protos` — clean exit, 38 files across Go/Java/Python/TypeScript
- Design question flagged for Phase 3: auto-provisioning vs deprovision tension (revoked user could re-provision via SSO)

**Phase 1 is complete. Phase 2 (backend handlers) is next.**

### Session 5 — Phase 2: Backend lifecycle RPC handlers (SSO login flow)

**Focus**: Implemented Phase 2 of the T01 plan — backend handlers for federated account lifecycle RPCs

- **2a: `expectedAudience` in GetSsoProvider** — already done in Session 4 (discovered during this session)
- **2b: `revokeOrgAccess` on `IamPolicyGrpcRepo`** — already done in Session 4
  - Added `revokeOrgAccess(String identityAccountId, String orgSlug)` to `IamPolicyGrpcRepo` interface
  - Implemented in `IamPolicyGrpcRepoImpl` using `iamChannelAsSystem` (system credentials, bypasses auth)
  - Follows the same cross-domain in-process gRPC pattern as `createPolicy`, `bootstrapPolicy`, `cleanupResourcePolicies`
- **2c: `UpdateFederatedAccountHandler`** — NEW handler
  - Pipeline: validateFieldConstraints → authorize → validateIdentityProvider → lookupByExternalSub → updateProfileFields → transformResponse → sendResponse
  - Natural-key lookup via `findByIdentityProviderRefAndIdpId(org, slug, externalSub)`
  - Full-replace semantics for profile fields (email, firstName, lastName, pictureUrl)
  - Updates `metadata.name` to track email changes (name = email for federated accounts)
  - Direct `IdentityAccountRepo.save()` — same-domain, no standard update pipeline (authorization model mismatch: org-level `can_create_identity_account` vs account-level `can_edit`)
- **2d: `DeprovisionFederatedAccountHandler`** — NEW handler
  - Pipeline: validateFieldConstraints → authorize → validateIdentityProvider → lookupByExternalSub → revokeOrgAccess → deleteAccount (conditional) → cleanupCache → sendResponse
  - `RevokeOrgAccess` step delegates to `IamPolicyGrpcRepo.revokeOrgAccess()` (cross-domain, system credentials)
  - `DeleteAccount` step uses `shouldExecute()` guard — only runs when `delete_account = true`
  - `CleanupCache` step clears stale Redis entry from federation resolver cache (best-effort)
  - Returns the deprovisioned `IdentityAccount` for audit trail
- **Build**: Bazel build (57 targets) and all 8 backend tests pass clean
- **Design decision**: Direct repo save for update handler (not standard update pipeline) because authorization model differs (org-level vs account-level)
- **Design decision**: `revokeOrgAccess` added to shared `IamPolicyGrpcRepo` interface (Option A from plan) — canonical cross-domain pattern, discoverable, reusable in Phase 3

**Phases 1 and 2 are complete. Phase 3 (SSO auto-provisioning) is next.**

**Files changed in stigmer-cloud (uncommitted on `feat/sso-login-flow`):**
- `backend/services/stigmer-service/.../handler/UpdateFederatedAccountHandler.java` — NEW
- `backend/services/stigmer-service/.../handler/DeprovisionFederatedAccountHandler.java` — NEW
- `backend/libs/.../IamPolicyGrpcRepo.java` — added `revokeOrgAccess`
- `backend/services/.../IamPolicyGrpcRepoImpl.java` — implemented `revokeOrgAccess`
- `backend/services/.../IdentityProviderGetSsoProviderHandler.java` — populated `expectedAudience`
- `backend/libs/.../IdentityAccountRedisCacheRepo.java` — added `deleteIdentityAccountIdByIdpId`
- Plus 31 generated stub files from Phase 1 (Go/Java/Python/TypeScript/Dart)

### Session 6 — Phase 3: SSO Auto-Provisioning (SSO login flow)

**Focus**: Implemented Phase 3 of the T01 plan — SSO auto-provisioning on first login

**Architecture decision**: Introduced a new `SsoAutoProvisioner` component instead of modifying `FederatedIdentityResolverImpl`. The resolver's contract is read-only lookup; mixing creation logic into it would violate separation of concerns. The mapper (`RequestCallerIdentityMapper`) orchestrates the fallback: resolve → if empty + SSO → auto-provision.

**Changes in api-authentication (shared library):**
- `FederatedAuthenticationToken.java` — Added `isSsoProvider` field carried from the IdP spec; added backward-compatible 5-arg constructor defaulting to `false`
- `SsoAutoProvisioner.java` — NEW interface: `String provision(FederatedAuthenticationToken)`
- `SsoAutoProvisioningException.java` — NEW custom exception for provisioning failures
- `RequestCallerIdentityMapper.java` — Added SSO fallback: if resolver returns empty and token is SSO, delegates to `SsoAutoProvisioner`; graceful degradation if provisioner not wired
- `FederatedIdentityResolver.java` — Updated javadoc to clarify read-only contract and reference `SsoAutoProvisioner`
- `BUILD.bazel` — Added `JUNIT5_DEPS`, `MOCKITO_DEPS`, registered `authentication_token_parser_test` and `request_caller_identity_mapper_test`
- `RequestCallerIdentityMapperTest.java` — NEW: tests existing-account resolution, SSO auto-provisioning trigger, non-SSO rejection, missing provisioner graceful handling

**Changes in stigmer-service (domain implementation):**
- `FederatedJwtAuthenticationProvider.java` — Passes `spec.getIsSsoProvider()` to `FederatedAuthenticationToken` constructor
- `SsoAutoProvisionerImpl.java` — NEW: extracts OIDC claims (email, name, picture) from JWT, creates identity account via `IdentityAccountGrpcRepo`, grants viewer role via `IamPolicyGrpcRepo`, caches mapping, handles `ALREADY_EXISTS` race condition
- `FederatedIdentityResolverImpl.java` — Updated javadoc to reference `SsoAutoProvisionerImpl`
- `FederatedJwtAuthenticationProviderTest.java` — Added `isSsoProvider` flag propagation tests
- `SsoAutoProvisionerImplTest.java` — NEW: comprehensive tests (successful provisioning, claim extraction variants, race condition, missing email, creation failure, best-effort role/cache failures)
- `BUILD.bazel` — Added `MOCKITO_DEPS`, registered 5 federation/SSO test targets

**Changes in stigmer (apis):**
- `identityprovider/v1/spec.proto` — Updated `is_sso_provider` field comment and top-level spec comment to describe auto-provisioning behavior

**Build infrastructure:**
- `MODULE.bazel` — Added `mockito-core:5.14.2` and `mockito-junit-jupiter:5.14.2` to Maven dependencies
- Registered 7 new Bazel test targets across both BUILD files
- Full `bazel test //backend/...` passes: 15/15 tests green

**Phases 1, 2, and 3 are complete. Phase 4 (Web App SSO Login Page) is next.**

### Session 7 — Phase 4: Web App SSO Login Page (SSO login flow)

**Focus**: Implemented Phase 4 of the T01 plan — Web App SSO Login Page

- Created `sso-session.ts` — pure sessionStorage helpers for SSO login state (ephemeral pre-callback) and SSO session state (persistent across reloads), with `SsoState` interface and `isValidSsoState` type guard
- Created `SsoLoginPrompt` SDK component in `@stigmer/react` — org input → SSO provider lookup → "Sign in with [provider]" button; 5-phase state machine; themed via `--stgm-*` tokens; exported from identity-provider barrel and root index
- Modified `Providers.tsx` — extracted `ProvidersInner` with `PUBLIC_ROUTES` check; `/login` gets light provider tree (ConfigGate + ThemeProvider only); no AuthGuard, OrgProvider, or StigmerTransportBridge for public routes
- Modified `AppShell.tsx` — added `/login` to `isPublicZone` check (no sidebar on login page)
- Created `/login` page route — reads `?org=` param; creates unauthenticated `StigmerProvider` (`getAccessToken: () => null`); composes `SsoLoginPrompt` with Auth0 "Sign in with email" fallback; SSO button saves login state and calls `signinRedirect()`
- Modified `OidcAuthProvider.tsx` — (a) `resolveActiveManager()` checks for SSO session on mount; (b) `processSsoOrAuth0Callback()` detects SSO callback via sessionStorage; (c) SSO logout clears session and redirects to `/login?org=...`
- TypeScript check passes on both `sdk/react` and `client-apps/web` (only pre-existing `UserMenu.tsx` error)
- Zero linter errors across all changed files

**Phases 1–4 are complete. Phase 5 (SSO Login URL on IdP Detail Panel) is next.**

### Session 8 — Phase 5: SSO Login URL on IdP Detail Panel (SSO login flow)

**Focus**: Implemented Phase 5 of the T01 plan — SSO Login URL on IdP Detail Panel

- Added optional `ssoLoginUrl?: string` prop to `IdentityProviderDetailPanelProps` — SDK component accepts a pre-computed URL; consumer constructs it (no Console routing knowledge in the SDK)
- Created `CopyableField` private helper in `IdentityProviderDetailPanel.tsx` — clipboard copy with 2s "Copied" feedback, manual text selection fallback on clipboard failure, `sr-only` live region for screen reader announcement
- Renders SSO login URL field in `ViewMode` when `isSsoProvider && ssoLoginUrl` — positioned after OIDC client ID, with hint text "Share this URL with your team members to sign in via SSO"
- Console (`IdentityProvidersSection.tsx`) computes URL as `${window.location.origin}/login?org=${orgSlug}` when `isSsoProvider` is true
- TypeScript check passes on both `sdk/react` and `client-apps/web` (only pre-existing `UserMenu.tsx` error)
- Zero linter errors

**Phases 1–5 are complete. Phase 6 (Documentation) is next.**

### Session 9 — Browser mockup scaling fix + BrowserPageCard removal

**Focus**: Fixed browser mockup over-zoom in docs and video export; removed false `BrowserPageCard` abstraction

- Added `DEMO_BROWSER_ZOOM = 0.9` token to `tokens.ts` — scales BrowserView shells comfortably within docs prose
- Added `DEMO_BROWSER_SHELL_HEIGHT = 420` token — taller internal height for centered card mockups
- Added `zoom` prop to `BrowserView` component; changed default height fallback to `DEMO_BROWSER_SHELL_HEIGHT`
- Applied `zoom={DEMO_BROWSER_ZOOM}` to all 5 scenarios using `BrowserView`
- Compacted card dimensions in `LoginPage`, `SignupPage`, `TenantSignupPage` (w-56→w-52, p-4→p-3, font sizes -1px)
- Created then deleted `BrowserPageCard.tsx` — identified as false abstraction (generic name, specific implementation)
- Updated `_roles/002_document_writer.md`: replaced "Shared browser page components" section with "Shell-level vs. content-level abstraction" principle
- **Design principle established**: shell-level sizing is tokenized and reusable; content inside shells is scenario-specific and stays inline

## Next Steps

1. **Phase 6: Documentation** — SSO login guide, SDK reference for update/deprovision RPCs, existing federation page updates

## Context for Resume

- `SsoAutoProvisioner` is an interface in the shared `api-authentication` library; `SsoAutoProvisionerImpl` is the domain implementation in `stigmer-service`
- The mapper (`RequestCallerIdentityMapper`) uses `@Autowired(required = false)` for the provisioner — graceful degradation if not configured
- Race condition handling: if concurrent auto-provisioning creates a duplicate, `ALREADY_EXISTS` is caught and the existing account is re-queried
- Viewer role (not member) is granted per design decision 001 — member enables billable agent executions
- The backward-compatible 5-arg `FederatedAuthenticationToken` constructor was added to avoid breaking existing code that doesn't need the SSO flag
- All Mockito-based federation tests are now in the Bazel test cycle (previously IDE-only)
- `SsoLoginPrompt` is in `@stigmer/react` (SDK component); OIDC redirect mechanics are in `client-apps/web` (Console concern)
- Provider tree bifurcation: `/login` bypasses the entire auth chain, not just `AuthGuard` — `OrgProvider` and `StigmerTransportBridge` fail without auth
- SSO and Auth0 share `/auth/callback`; `stigmer:sso:login` (ephemeral) and `stigmer:sso:session` (persistent) sessionStorage keys distinguish the flows
- SSO logout is local-only (no RP-initiated logout with IdP); redirects to `/login?org=...` for re-auth
- `ssoLoginUrl` prop on `IdentityProviderDetailPanel` is optional — SDK stays agnostic to Console routing; the consumer computes the full URL
- Clipboard copy pattern (navigator.clipboard + fallback + copied state + timeout) is repeated in 6+ SDK components — candidate for shared `useCopyToClipboard` hook or `CopyableField` component in a future cleanup pass

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
