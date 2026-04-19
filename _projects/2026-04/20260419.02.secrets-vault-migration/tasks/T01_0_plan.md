# Task T01: Secrets Vault Migration -- Analysis and Design

**Created**: 2026-04-19 17:00
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Objective

Replace Stigmer's current DB-stored secrets approach (single static AES-256-GCM key, ciphertext in MongoDB) with OpenBAO-backed secrets management: envelope encryption with per-org Transit keys, secret values stored in vault instead of MongoDB, and just-in-time secret resolution during agent/workflow execution.

## Background

### Current State

Stigmer encrypts secrets using a single static AES-256-GCM key (`STIGMER_ENCRYPTION_ENVIRONMENT_KEY`) injected as a pod env var. The `SecretEncryptionService` produces `enc:v1:<base64(nonce||ciphertext+tag)>` and stores ciphertext directly in MongoDB.

**Resources holding secrets today:**
- `Environment` (`EnvironmentValue.is_secret`) -- user-managed credential store
- `ExecutionContext` (`ExecutionValue.is_secret`) -- ephemeral runtime secrets per execution
- `OAuthApp` (`OAuthAppSpec.client_secret`) -- vendor OAuth credentials
- `PlatformClient` (`client_secret_hash`) -- already hashed (lower risk, no change needed)

**Weaknesses:**
1. Static key, no rotation -- one key for everything
2. No envelope encryption -- no DEK/KEK separation, no per-org isolation
3. Ciphertext in MongoDB -- DB compromise + key compromise = full breach
4. No vault-native audit trail -- no per-key access logging
5. ExecutionContext materializes ALL environment secrets into a single MongoDB document at creation time

### Reference Implementation

Planton completed an identical migration in project `20260116.01.config-manager-implementation`. Key decisions:
- Dual storage: metadata in MongoDB, secret values in OpenBAO KV v2
- Envelope encryption: AES-256-GCM DEK, wrapped by per-org KEK via OpenBAO Transit
- Provider abstraction: `SecretBackendProvider` (storage) + `KeyEncryptionKeyProvider` (KEK)
- Reusable libraries: `vault-commons` (`PlatformVaultClient`), `secrets-commons` (`EnvelopeEncryptionService`)

### Enterprise Trust Model

The runner impersonates users via `ImpersonatedChannelFactory` to pass FGA checks when reading execution secrets. This is the standard managed-SaaS trust model (same as AWS, Stripe, etc.). For enterprises that cannot accept this:
- **Roadmap answer**: self-hosted Stigmer enterprise edition where secrets never leave customer infrastructure
- This is NOT in scope for this project, but documented as the architectural escape hatch

## Task Breakdown

### Phase 0: Deploy OpenBAO Infrastructure (cloud-only)

Add an OpenBAO instance to the Stigmer infrastructure stack.

1. Create `KubernetesOpenBao` manifest in `stigmer-cloud/_ops/planton/infra-hub/`
   - Standalone mode with file storage
   - TLS via Istio sidecar
   - GCP KMS auto-unseal for production
2. Create Planton `SecretsGroup` entry for OpenBAO address + root token
3. Wire `VAULT_ADDR` and `VAULT_TOKEN` into `stigmer-service` via Kustomize env
4. Add `vault-commons` library dependency to `stigmer-cloud/backend/libs/java/`
   - Reuse Planton's `PlatformVaultClient` (KV v2 + Transit operations)
   - Add `VaultConfiguration` Spring config with `stigmer.vault.uri` / `stigmer.vault.token`
5. Verify connectivity: health check activity or startup probe

**Deliverable**: Running OpenBAO accessible from `stigmer-service`, Spring `VaultTemplate` wired.

### Phase 1: Envelope Encryption Layer (no proto changes, backward-compatible)

Replace the single static AES key with envelope encryption. No external API changes.

1. Port or depend on Planton's `EnvelopeEncryptionService` and `KeyEncryptionKeyProvider` interface
2. Create `StigmerTransitKekProvider` -- one Transit key per organization
   - On first encrypt for an org: `ensureTransitKey(orgId)` then `transitEncrypt(orgId, dekBytes)`
   - Decrypt: `transitDecrypt(orgId, ciphertext)`
3. Update `SecretEncryptionService` (or create `VaultSecretEncryptionService`):
   - **Encrypt**: Generate random AES-256 DEK, encrypt value, wrap DEK via Transit, produce envelope
   - **Decrypt**: Parse envelope, unwrap DEK via Transit, decrypt value
   - New wire format: `enc:v2:<base64(envelope_json)>`
4. Maintain backward compatibility:
   - Decrypt path: if prefix is `enc:v1:`, use old static-key path; if `enc:v2:`, use envelope path
   - Encrypt path: always produce `enc:v2:` for new writes
5. Lazy re-encryption: when an environment is updated, old `enc:v1:` values get re-encrypted as `enc:v2:`
6. Apply to: `EncryptSecretValues` (Environment), `EncryptClientSecret` (OAuthApp), `EnvironmentMergeService` (ExecutionContext)

**Deliverable**: All new secret writes use envelope encryption; all old reads still work; per-org key isolation.

### Phase 2: Move Secret Values Out of MongoDB (proto changes required)

Secret values no longer persist in MongoDB -- only metadata and vault references.

1. **Proto changes** (in `stigmer/apis/`, additive and backward-compatible):
   - Add `string vault_ref = 4` to `EnvironmentValue` (reference to vault path when `is_secret=true`)
   - Add `string vault_ref = 3` to `ExecutionValue` (same pattern)
   - No breaking changes; OSS server ignores `vault_ref` and continues inline storage

2. **VaultSecretStore** -- new service in `stigmer-cloud`:
   - `writeSecret(path, value)` -- envelope-encrypt then write to KV v2
   - `readSecret(path)` -- read from KV v2 then envelope-decrypt
   - `deleteSecret(path)` -- delete from KV v2
   - Paths: `{org}/{resource_type}/{resource_slug}/{key}` for persistent secrets
   - Paths: `ephemeral/{execution_id}/{key}` for execution-scoped secrets

3. **Environment writes** (`EncryptSecretValues` step):
   - When `is_secret=true`: write value to vault, set `vault_ref` to vault path, set `value` to `***VAULT***`
   - MongoDB stores only the reference marker, not ciphertext

4. **Environment reads**:
   - `get` / `list`: return `***VAULT***` for secret values (redacted)
   - `getSecretValue`: read from vault via `vault_ref`, return plaintext (existing `can_read_secrets` FGA)

5. **ExecutionContext creation** (`CreateExecutionContextStep` / `EnvironmentMergeService`):
   - Merge environment refs as today, but write individual secret values to vault ephemeral paths
   - Store `vault_ref` in ExecutionContext `spec.data`, not the ciphertext
   - Non-secret config values remain inline in MongoDB

6. **ExecutionContext reads** (`getByExecutionId`):
   - For entries with `vault_ref`: resolve from vault, return plaintext
   - For entries without `vault_ref` (non-secrets): return inline value
   - Existing `can_view` FGA check unchanged
   - Each vault read logged in vault audit trail (per-secret audit)

7. **ExecutionContext deletion** (Temporal cleanup activity):
   - Delete ephemeral vault paths in addition to MongoDB document
   - Vault paths have TTL as backup (execution timeout + buffer)

8. **OAuthApp** (`EncryptClientSecret` step):
   - Write `client_secret` to vault at `{org}/oauth_app/{slug}/client_secret`
   - MongoDB stores `***VAULT***` in `spec.client_secret`
   - OAuth flows (token exchange, refresh) read from vault at point of use

**Deliverable**: Zero secret values in MongoDB. All secrets in vault with per-secret audit trail.

### Phase 3: Audit Logging Enhancement

Ensure every secret access is logged and traceable.

1. **Vault-native audit**: Enable OpenBAO audit device (file or syslog) -- logs every KV read/write with timestamp, path, token identity
2. **Application-level audit**: Add structured log entries on:
   - `getSecretValue` (environment) -- who, which key, when
   - `getByExecutionId` with secret resolution -- which execution, which keys resolved, when
   - OAuth token exchange / refresh -- which OAuthApp, when
3. **No FGA changes needed**: Existing `can_read_secrets` (Environment) and `can_view` (ExecutionContext) are sufficient. The impersonation model is unchanged.

**Deliverable**: Answerable audit trail -- "who accessed which secret when" for compliance.

## Out of Scope (Documented for Roadmap)

1. **Self-hosted Stigmer enterprise edition** -- the answer for enterprises that cannot accept managed-SaaS trust. Runner + secrets stay in customer infrastructure. Stigmer orchestrates via Temporal.
2. **BYO vault** -- customers point Stigmer at their own vault (HashiCorp Vault, AWS Secrets Manager, etc.). The `VaultSecretStore` abstraction supports this future, but only the platform OpenBAO backend is implemented now.
3. **FGA operator role splitting** -- `can_impersonate` is a binary superpower today. Splitting it does not reduce the blast radius for secrets. The real answer is self-hosted for paranoid enterprises.

## OSS vs Cloud Classification

- **Phases 0-3**: Cloud-only. OSS continues with existing `SecretEncryptionService` (static key, SQLite, single-user local-first).
- **Proto changes** (Phase 2): Live in OSS `apis/` (source of truth). New `vault_ref` field is additive; OSS server ignores it.
- **Wire format `enc:v2:`**: Documented so a future OSS vault integration is possible, but not needed for local single-user.

## Success Criteria for T01

- [ ] OpenBAO infrastructure manifest reviewed and ready to deploy
- [ ] `vault-commons` dependency integration plan confirmed
- [ ] Envelope encryption wire format (`enc:v2:`) specified and backward-compat with `enc:v1:` confirmed
- [ ] `VaultSecretStore` interface designed (paths, operations, TTL)
- [ ] Proto changes for `vault_ref` designed (additive, no breaking changes)
- [ ] `getByExecutionId` JIT resolution flow documented
- [ ] Audit logging approach confirmed
- [ ] Lazy re-encryption strategy for existing `enc:v1:` data confirmed

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| OpenBAO operational issues | Planton already operates OpenBAO in production; reuse their runbooks and monitoring |
| Migration of existing `enc:v1:` secrets | Lazy re-encryption on update; batch migration script as optional accelerator |
| Runner latency from vault reads | Vault is in-cluster (sub-ms network); KV v2 reads are fast; cache if needed |
| Spring Vault compatibility with OpenBAO | OpenBAO is Vault-API-compatible; Planton's `vault-commons` already validates this |
| Vault unavailability | Circuit breaker + graceful degradation (fail execution, do not fallback to insecure) |

## Next Task Preview

**T02: Phase 0 Execution** -- Deploy OpenBAO infrastructure and wire vault-commons into stigmer-service.

## Notes

- Planton's `vault-commons` (`PlatformVaultClient`) and `secrets-commons` (`EnvelopeEncryptionService`) are proven in production. Reuse over rebuild.
- OpenBAO Helm chart `0.25.6` is what Planton's operator embeds. Use the same version for consistency.
- Transit key name = organization ID (per-org isolation, same as Planton's `PlatformTransitKekProvider`).
- The `enc:v1:` format has a Go counterpart in `stigmer-server` (OSS). Document `enc:v2:` format so Go can be updated later if needed.

## Review Process

**What happens next**:
1. **You review this plan** -- consider the phasing, scope, and what's in/out
2. **Provide feedback** -- any concerns, changes, or priorities
3. **I'll revise the plan** -- incorporate your feedback into T01_2_revised_plan.md
4. **You approve** -- explicit approval to proceed
5. **Execution begins** -- tracked in T01_3_execution.md
