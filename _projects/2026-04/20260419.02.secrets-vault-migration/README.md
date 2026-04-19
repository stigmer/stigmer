# Project: 20260419.02.secrets-vault-migration

## Overview

Replace Stigmer's DB-stored secrets (AES-256-GCM with static key in MongoDB) with OpenBAO (Vault)-backed secrets management using envelope encryption, per-org Transit keys, and just-in-time secret resolution for agent/workflow execution.

**Created**: 2026-04-19
**Status**: Active

## Project Information

### Primary Goal

Deliver production-ready secrets management with:
1. OpenBAO infrastructure deployed alongside Stigmer
2. Envelope encryption with per-org KEK via OpenBAO Transit
3. Secret values out of MongoDB into vault (only metadata/references in DB)
4. JIT resolution so runners fetch individual secrets from vault on demand
5. Vault-native audit trail for all secret access

### Timeline

**Target Completion**: 4-6 weeks (10-16 days of focused work across 4 phases)

### Technology Stack

Java/Spring Boot, Protobuf, OpenBAO (Vault-compatible), Spring Vault, MongoDB, Bazel, OpenFGA

### Project Type

Feature Development (cloud-only; OSS edition unaffected)

### Affected Components

- `stigmer-cloud/backend/libs/java/infra/encryption` -- replace static AES with envelope encryption
- `stigmer-cloud/backend/services/stigmer-service` -- environment, executioncontext, oauthapp, mcpserver domains
- `stigmer/apis` -- additive proto changes (vault_ref fields on EnvironmentValue, ExecutionValue)
- `stigmer-cloud/_ops` -- OpenBAO infrastructure manifests
- `stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga` -- no FGA changes needed

## Key Design Decisions

### 1. Reuse Planton's proven libraries

Planton completed an identical DB-to-vault migration in `20260116.01.config-manager-implementation` (completed 2026-03-14). We reuse:
- `vault-commons/PlatformVaultClient` -- Spring Vault wrapper for KV v2 + Transit
- `secrets-commons/EnvelopeEncryptionService` -- AES-256-GCM DEK + KEK wrapping
- `KubernetesOpenBao` deployment component -- Helm chart 0.25.6

### 2. Impersonation model is unchanged

The runner impersonates users via `ImpersonatedChannelFactory`. `can_impersonate` is a binary superpower -- no FGA splitting solves this. This is the standard managed-SaaS trust model (same as AWS, Stripe). For enterprises that cannot accept this, the roadmap answer is self-hosted Stigmer enterprise edition.

### 3. No scoped tokens or complex auth schemes

Ephemeral vault tokens, per-execution scoped grants, and FGA operator role splitting were evaluated and rejected. They add complexity without changing the fundamental trust boundary (platform operator controls infrastructure). The simpler model: vault + audit + self-hosted as escape hatch.

### 4. Cloud-only with additive OSS proto changes

All phases are cloud-only. Proto changes (`vault_ref` fields) live in OSS `apis/` as additive fields. The OSS server ignores `vault_ref` and continues with inline SQLite storage. Wire format `enc:v2:` is documented so Go can be updated later.

## Project Context

### Dependencies

- Planton `vault-commons` library (`PlatformVaultClient`, `VaultConfiguration`)
- Planton `secrets-commons` library (`EnvelopeEncryptionService`, `KeyEncryptionKeyProvider`)
- `KubernetesOpenBao` deployment component (Helm chart from `openbao.github.io/openbao-helm`)
- Existing Planton OpenBAO infrastructure patterns and runbooks

### Success Criteria

- Secrets never stored in MongoDB (only vault references)
- Envelope encryption with per-org Transit keys
- Secret retrieval p95 < 100ms
- Every secret read logged in vault audit trail
- Backward-compatible proto changes (`enc:v1` still decryptable)
- OAuthApp `client_secret` in vault
- Runner resolves execution secrets JIT from vault via `getByExecutionId`
- Enterprise trust model documented (managed SaaS, self-hosted, BYO vault)

### Known Risks & Mitigations

- OpenBAO operational complexity -- mitigated by reusing Planton's production patterns
- Migration of existing `enc:v1` secrets -- mitigated by lazy re-encryption on update
- Runner latency from vault reads -- mitigated by in-cluster vault (sub-ms network)
- Spring Vault compatibility with OpenBAO -- already validated by Planton in production

## Phases

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| Phase 0 | Deploy OpenBAO, wire vault-commons | 1-2 days | Low |
| Phase 1 | Envelope encryption (enc:v2, per-org Transit keys) | 3-5 days | Low |
| Phase 2 | Secret values out of MongoDB (vault_ref, VaultSecretStore, JIT) | 5-7 days | Medium |
| Phase 3 | Audit logging (vault audit device, structured app logs) | 1-2 days | Low |

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

## Current Status

### Active Task

See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking

- [x] Project initialized
- [ ] T01: Analysis and design (PENDING REVIEW)
- [ ] Phase 0: OpenBAO infrastructure
- [ ] Phase 1: Envelope encryption
- [ ] Phase 2: Values out of MongoDB
- [ ] Phase 3: Audit logging
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Drag and drop `next-task.md` into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)
