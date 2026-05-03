# Next Task: 20260503.04.auth0-webhook-pipeline-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260503.04.auth0-webhook-pipeline-cleanup

**Description**: Remove the obsolete Auth0 webhook-based identity provisioning pipeline from Stigmer Cloud. The system already has synchronous JIT/SSO auto-provisioning via FederatedAutoProvisioner, making the entire webhook pipeline dead code.
**Goal**: Delete the auth0-webhooks-receiver Cloudflare Worker, the Temporal workflow/activities for identity account creation from Auth0, the SimulateSignupWebhook RPC, Auth0 Management API code, and all associated config/credentials. Clean delete with no deprecation.
**Tech Stack**: Java/Spring (stigmer-service), TypeScript (Cloudflare Worker), Protobuf, Kustomize/YAML
**Components**: stigmer-cloud: backend/services/auth0-webhooks-receiver, backend/services/stigmer-service (IAM identity account domain, config/auth0), _ops/planton configs, kustomize overlays. stigmer OSS: apis/ai/stigmer/iam/identityaccount/v1/command.proto (remove simulateSignupWebhook RPC)

## Current State

- **Status**: Complete — pending commit and PR
- **Last Session**: 2026-05-03
- **Active Task**: T01 — all 6 phases executed successfully

## Session Progress (2026-05-03)

### Accomplished
- Phase 1: Deleted auth0-webhooks-receiver worker (19 files), Temporal workflow/activities (12 files), SimulateSignupWebhookHandler, Auth0 Management API code (7 files)
- Phase 2: Simplified bootstrap migration — removed operator creation + Auth0 Management API, kept machine + system accounts
- Phase 3: Cleaned application-auth0.yaml, kustomize entries, ops config
- Phase 4: Removed Auth0 SDK from BUILD.bazel, cleaned package.json, Makefile, cursor rules, setup guides
- Phase 5: Removed simulateSignupWebhook RPC from proto, updated codegen schema, ran make codegen, updated docs
- Phase 6: Verified no residual references, regenerated stigmer-cloud stubs, cleaned bonus dead config (Temporal identity_account task queue)

### Key Decisions
- Migration rewritten (not deleted) — machine + system accounts are runtime dependencies
- Operator account creation removed from migration — documented in setup guide as manual step
- Auth0Config deleted entirely — JWT validation uses separate security.authentication.* properties
- Mongock change unit ID kept same — prevents re-execution on existing environments

### Surprises Discovered
- U20250102_InsertBootstrapIdentityAccounts.java depended on Auth0Config + Auth0 Management SDK
- Machine account identity record is a HARD runtime dependency — IdpIdToIdentityAccountIdCacheProxy throws IdentityAccountNotFoundException for @clients subjects if MongoDB record missing
- TEMPORAL_IDENTITY_ACCOUNT_TASK_QUEUE env var was dead config (only consumer was deleted temporal workflow)

## Next Steps
1. Commit changes in both repos
2. Create PRs for both repos
3. Manual ops: Disable/delete Auth0 Log Stream "Stigmer User Signup Events" in Auth0 dashboard
4. Manual ops: Delete the Cloudflare Worker deployment from Cloudflare dashboard

## Essential Files to Review

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
