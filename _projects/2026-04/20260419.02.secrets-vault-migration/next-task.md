# Next Task: 20260419.02.secrets-vault-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260419.02.secrets-vault-migration

**Description**: Replace Stigmer's DB-stored secrets (AES-256-GCM with static key in MongoDB) with OpenBAO (Vault)-backed secrets management using envelope encryption, per-org Transit keys, and just-in-time secret resolution for agent/workflow execution.
**Goal**: Deliver production-ready secrets management with: (1) OpenBAO infrastructure, (2) envelope encryption with per-org KEK via Transit, (3) secret values out of MongoDB into vault, (4) JIT resolution so runners fetch secrets on demand from vault, (5) vault-native audit trail for all secret access.
**Tech Stack**: Java/Spring Boot, Protobuf, OpenBAO (Vault-compatible), Spring Vault, MongoDB, Bazel, OpenFGA
**Components**: stigmer-cloud/backend/libs/java/infra/encryption, stigmer-cloud/backend/services/stigmer-service (environment, executioncontext, oauthapp, mcpserver domains), stigmer/apis (executioncontext, environment, oauthapp protos), stigmer-cloud/_ops (OpenBAO infrastructure), stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga (authorization model)

## Current State

- **Status**: Blocked (waiting for OpenBAO infrastructure)
- **Last Session**: 2026-04-24 — Emergency hotfix: silenced vault beans, fixed LLM proxy secret refs
- **Active Task**: Phase 0 — Deploy OpenBAO, wire vault-commons
- **Branch**: `main` (vault-migration branch merged via PR #121, hotfix committed on main)

## Session Progress (2026-04-24)

- Diagnosed production crash: `@ConditionalOnProperty` matched empty URI string, causing `VaultEndpoint.from("")` to fail
- Added `stigmer.vault.enabled` flag (default `false`) to `VaultConfig` and `application-vault.yaml`
- Added `@ConditionalOnBean(VaultTemplate.class)` safety net on `VaultClient`
- Fixed LLM proxy secret refs: `stigmer-llm-proxy-credentials` (non-existent) -> `openai`/`anthropic` (existing)
- Commented out `VAULT_ADDR`/`VAULT_TOKEN` in prod overlay (infra not deployed)
- All changes committed: `1cdf4133` on main
- Changelog: `_changelog/2026-04/2026-04-24-222814-silence-vault-beans-fix-proxy-secret-refs.md`

## Blockers

- **OpenBAO infrastructure not deployed**: The `stigmer-openbao-vault` variables-group and secrets-group don't exist. Need platform-side deployment of the KubernetesOpenBao component before vault can be enabled.

## Next Steps (when blocker resolved)

1. Deploy OpenBAO infrastructure (create `stigmer-openbao-vault` variables/secrets groups)
2. Uncomment `VAULT_ADDR` and `VAULT_TOKEN` in `_kustomize/overlays/prod/service.yaml`
3. Set `VAULT_ENABLED=true` in prod kustomize overlay
4. Verify stigmer-service starts with vault connectivity
5. Continue Phase 0 T01: wire vault-commons, validate KV v2 + Transit operations

## Context for Resume

- **Vault beans silenced, not removed**: All vault code is intact. Flip `VAULT_ENABLED=true` + uncomment kustomize entries to re-enable.
- **Key learning**: `@ConditionalOnProperty` without `havingValue` matches empty strings. Always use `havingValue = "true"` for opt-in configs.
- **LLM proxy secrets fixed**: Now using existing `openai` and `anthropic` secrets groups instead of the never-created `stigmer-llm-proxy-credentials`.
- **Commit**: `1cdf4133` on `main` in stigmer-cloud repo.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/checkpoints/2026-04-24-session-1.md
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-24-session-1.md`
2. [ ] Check current task status in `tasks/`
3. [ ] Verify OpenBAO blocker status (is infra deployed?)
4. [ ] Review design decisions and coding guidelines
5. [ ] Review wrong assumptions and dont-dos
6. [ ] If unblocked: uncomment vault kustomize entries, set `VAULT_ENABLED=true`, continue Phase 0

## Quick Commands

After loading context:
- "Continue with Phase 0" - Resume vault infrastructure wiring
- "Show project status" - Get overview of progress
- "Check blocker" - Verify OpenBAO deployment status

---

*This file provides direct paths to all project resources for quick context loading.*
