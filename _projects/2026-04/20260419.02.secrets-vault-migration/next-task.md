# Next Task: 20260419.02.secrets-vault-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260419.02.secrets-vault-migration

**Description**: Replace Stigmer's DB-stored secrets (AES-256-GCM with static key in MongoDB) with OpenBAO (Vault)-backed secrets management using envelope encryption, per-org Transit keys, and just-in-time secret resolution for agent/workflow execution.
**Goal**: Deliver production-ready secrets management with: (1) OpenBAO infrastructure, (2) envelope encryption with per-org KEK via Transit, (3) secret values out of MongoDB into vault, (4) JIT resolution so runners fetch secrets on demand from vault, (5) vault-native audit trail for all secret access.
**Tech Stack**: Java/Spring Boot, Protobuf, OpenBAO (Vault-compatible), Spring Vault, MongoDB, Bazel, OpenFGA
**Components**: stigmer-cloud/backend/libs/java/infra/encryption, stigmer-cloud/backend/services/stigmer-service (environment, executioncontext, oauthapp, mcpserver domains), stigmer/apis (executioncontext, environment, oauthapp protos), stigmer-cloud/_ops (OpenBAO infrastructure), stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga (authorization model)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/checkpoints/
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
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.02.secrets-vault-migration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-19 16:57
**Current Task**: T01 (Initial Setup)
**Status**: Planning

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
