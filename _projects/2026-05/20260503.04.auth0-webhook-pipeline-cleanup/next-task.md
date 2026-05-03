# Next Task: 20260503.04.auth0-webhook-pipeline-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260503.04.auth0-webhook-pipeline-cleanup

**Description**: Remove the obsolete Auth0 webhook-based identity provisioning pipeline from Stigmer Cloud and replace it with a synchronous `provisionMyAccount` RPC following the Planton pattern.
**Goal**: Delete the old webhook pipeline AND add the replacement provisioning path for new direct Auth0 signups.
**Tech Stack**: Java/Spring (stigmer-service), TypeScript (Cloudflare Worker), Protobuf, Kustomize/YAML, React/Next.js (console)
**Components**: stigmer-cloud: backend/services/stigmer-service (IAM identity account domain, organization repo), apis stubs. stigmer OSS: apis/ai/stigmer/iam/identityaccount/v1/command.proto, all SDK stubs, sdk/react (identity-account gate), client-apps/web (console).

## Current State

- **Status**: Complete — backend + frontend done, committed on branch `feat/react-sdk-streaming-ux` (commit `5500d7f8c`)
- **Last Session**: 2026-05-03
- **Active Task**: All implementation tasks complete (cleanup + provisionMyAccount RPC + frontend gate)

## Session Progress (2026-05-03)

### Session 1: Webhook Pipeline Cleanup
- Phase 1: Deleted auth0-webhooks-receiver worker (19 files), Temporal workflow/activities (12 files), SimulateSignupWebhookHandler, Auth0 Management API code (7 files)
- Phase 2: Simplified bootstrap migration — removed operator creation + Auth0 Management API, kept machine + system accounts
- Phase 3: Cleaned application-auth0.yaml, kustomize entries, ops config
- Phase 4: Removed Auth0 SDK from BUILD.bazel, cleaned package.json, Makefile, cursor rules, setup guides
- Phase 5: Removed simulateSignupWebhook RPC from proto, updated codegen schema, ran make codegen, updated docs
- Phase 6: Verified no residual references, regenerated stigmer-cloud stubs, cleaned bonus dead config (Temporal identity_account task queue)

### Session 2: provisionMyAccount RPC (replacement)
- Added `provisionMyAccount` RPC to command.proto (stigmer OSS), ran codegen across all SDKs
- Created `ProvisionMyAccountHandler.java` with 4-step pipeline: CheckExisting → FetchUserInfo → CreateAccount → EnsurePersonalOrg
- Added `findPersonalOrgByOwner` query to OrganizationRepo
- Reused existing `UserInfoClient`, `PersonalOrgSlugGenerator`, `OrganizationGrpcRepo.createOnBehalfOf`
- Regenerated stubs in stigmer-cloud
- Build verified: stigmer-cloud (89 Java targets), stigmer OSS (CLI + server + workflow-runner), proto lint

### Session 3: Frontend Identity Account Gate
- Created `useIdentityAccountGate` headless hook in `@stigmer/react` (`sdk/react/src/identity-account/`)
  - 4-state machine: checking → provisioning → ready | error
  - Calls `whoAmI()`, on NOT_FOUND calls `provisionMyAccount()`
  - Uses proper `isNotFound()` from SDK (not string matching)
  - Bypasses entirely when auth is disabled
- Created `IdentityAccountGate` console component (`client-apps/web/src/domain/_shared/identity/`)
  - Matches OrgGate visual patterns (spinner, welcome screen, error with retry, GateHeader)
- Wired gate into provider chain between `StigmerTransportBridge` and `OrgProvider`
- Exported hook + types from `@stigmer/react` barrel
- All verifications pass: `@stigmer/react` lint + typecheck, `client-apps/web` lint
- Changelog created: `_changelog/2026-05/2026-05-03-122742-identity-account-gate.md`

### Key Decisions
- Migration rewritten (not deleted) — machine + system accounts are runtime dependencies
- Operator account creation removed from migration — documented in setup guide as manual step
- Auth0Config deleted entirely — JWT validation uses separate security.authentication.* properties
- Mongock change unit ID kept same — prevents re-execution on existing environments
- Synchronous handler (no Temporal) for provisionMyAccount — we just deleted the task queue, dev-stage product, steps are idempotent
- Personal orgs separate from FederatedAutoProvisioner — only in provisionMyAccount path
- OIDC /userinfo over Auth0 Management API — standard, IDP-agnostic, no SDK
- SDK-level hook + console-level UI for identity gate — follows `useOrgGate`/`OrgGate` pattern
- Gate bypasses in disabled-auth mode — `isEnabled: false` → immediate `ready` state
- No changes to `useOrgGate` provisioning polling — harmless, may serve SSO edge cases

### Surprises Discovered
- U20250102_InsertBootstrapIdentityAccounts.java depended on Auth0Config + Auth0 Management SDK
- Machine account identity record is a HARD runtime dependency — IdpIdToIdentityAccountIdCacheProxy throws IdentityAccountNotFoundException for @clients subjects if MongoDB record missing
- TEMPORAL_IDENTITY_ACCOUNT_TASK_QUEUE env var was dead config (only consumer was deleted temporal workflow)
- IdpIdToIdentityAccountIdCacheProxy.proxyGet() returns raw IDP ID as fallback for non-machine accounts — this is what makes provisionMyAccount work without auth pipeline changes

## Next Steps
1. Commit changes in stigmer-cloud repo (backend cleanup + provisionMyAccount handler)
2. Create PRs for both repos
3. Manual ops: Disable/delete Auth0 Log Stream "Stigmer User Signup Events" in Auth0 dashboard
4. Manual ops: Delete the Cloudflare Worker deployment from Cloudflare dashboard
5. Future: Planton console can migrate `useIdentityAccountGuard` to use `useIdentityAccountGate` from `@stigmer/react`

## Essential Files to Review

### New Files (Session 3 — Identity Account Gate)
- `sdk/react/src/identity-account/useIdentityAccountGate.ts` — headless hook
- `sdk/react/src/identity-account/index.ts` — module barrel
- `client-apps/web/src/domain/_shared/identity/IdentityAccountGate.tsx` — console gate UI

### Modified Files (Session 3)
- `sdk/react/src/index.ts` — new exports for identity-account module
- `client-apps/web/src/providers/Providers.tsx` — IdentityAccountGate in provider chain

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.04.auth0-webhook-pipeline-cleanup/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.04.auth0-webhook-pipeline-cleanup/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.04.auth0-webhook-pipeline-cleanup/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.04.auth0-webhook-pipeline-cleanup/design-decisions/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.04.auth0-webhook-pipeline-cleanup/wrong-assumptions/
```

## Quick Commands

- "Create PRs for both repos" - Create pull requests
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
