# Task T01: Secrets Vault Migration -- Analysis and Design

**Created**: 2026-04-19 17:00
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Objective

Replace Stigmer's current DB-stored secrets approach (single static AES-256-GCM key, ciphertext in MongoDB) with OpenBAO-backed secrets management: envelope encryption with per-org Transit keys, secret values stored in vault instead of MongoDB, and just-in-time secret resolution during agent/workflow execution.

## Background

### Current State: How Secrets Are Stored

Stigmer encrypts secrets using a single static AES-256-GCM key (`STIGMER_ENCRYPTION_ENVIRONMENT_KEY`) injected as a pod env var. `SecretEncryptionService` produces `enc:v1:<base64(nonce||ciphertext+tag)>` and stores ciphertext directly in MongoDB.

**Resources holding secrets today:**
- `Environment` (`EnvironmentValue.is_secret`) -- user-managed credential store
- `ExecutionContext` (`ExecutionValue.is_secret`) -- ephemeral runtime secrets per execution
- `OAuthApp` (`OAuthAppSpec.client_secret`) -- vendor OAuth credentials
- `PlatformClient` (`client_secret_hash`) -- already hashed (lower risk, no change needed)

**Key files in stigmer-cloud:**
- `backend/libs/java/infra/encryption/SecretEncryptionService.java` -- AES-256-GCM encrypt/decrypt
- `backend/libs/java/infra/encryption/EncryptionConfig.java` -- static key from `STIGMER_ENCRYPTION_ENVIRONMENT_KEY`
- `_ops/planton/service-hub/secrets-group/stigmer-encryption.yaml` -- the actual AES key

**Weaknesses:**
1. Static key, no rotation -- one key for everything; compromise = total exposure
2. No envelope encryption -- no DEK/KEK separation, no per-org isolation
3. Ciphertext in MongoDB -- DB compromise + key compromise = full breach
4. No vault-native audit trail -- no per-key access logging
5. ExecutionContext materializes ALL environment secrets into a single MongoDB document at creation time

### Current State: How Secrets Flow During Execution

```
User creates AgentExecution
  -> CreateExecutionContextStep runs
    -> EnvironmentMergeService loads environments from MongoDB
    -> Decrypts all env secrets in-memory (SecretEncryptionService)
    -> Merges: agent defaults < environment < runtime_env
    -> Re-encrypts the merged map
    -> Stores full ExecutionContext in MongoDB (encrypted ciphertext)
  -> StripRuntimeEnvStep removes runtime_env from AgentExecution proto
  -> Temporal workflow starts

Agent Runner receives execution via Temporal
  -> Calls getByExecutionId(execution_id) via gRPC
    -> FGA can_view check (owner only)
    -> DecryptExecutionContextValues decrypts ALL secrets
    -> Returns plaintext secrets in response
  -> Runner uses secrets to connect to MCP servers, etc.

Execution completes
  -> DeleteExecutionContextActivity deletes EC from MongoDB (Temporal cleanup)
```

**Key impersonation flow:** The runner is a machine identity. It uses `ImpersonatedChannelFactory.forIdentity(invokerIdentityAccountId)` to impersonate the original user when calling `createOnBehalfOf`, `getSecretValueOnBehalfOf`, and `deleteOnBehalfOf`. FGA checks pass because it looks like the user is calling, not the machine.

### Current State: FGA Authorization Model

- **Environment**: `can_read_secrets` (creator-only) -- well-modeled for interactive secret reads
- **ExecutionContext**: Only `owner` relation with `can_view`/`can_edit` -- no link to parent execution in FGA; flat owner-only
- **OAuthApp**: `can_view` returns the full resource (encrypted `client_secret` included) -- no separate `can_read_secrets`
- **PlatformClient**: Uses hash + one-time reveal pattern -- already reasonable, no change needed

### Reference Implementation: How Planton Solved This

Planton completed an identical migration in project `20260116.01.config-manager-implementation` (completed 2026-03-14). ADR: `planton/docs/adr/2026-01/2026-01-16-065719-config-manager-with-openbao-secrets-backend.md`.

Key decisions:
- **Dual storage**: metadata in MongoDB, secret values in OpenBAO KV v2
- **Envelope encryption**: AES-256-GCM DEK per write, DEK wrapped by per-org KEK via OpenBAO Transit
- **Provider abstraction**: `SecretBackendProvider` (where ciphertext lives) + `KeyEncryptionKeyProvider` (how DEK is wrapped) -- two orthogonal dimensions
- **Reusable libraries**: `vault-commons/PlatformVaultClient` (KV v2 + Transit), `secrets-commons/EnvelopeEncryptionService`
- **Per-org Transit keys**: `PlatformTransitKekProvider` uses org ID as Transit key name (isolation, rotation, audit)
- **Infrastructure**: OpenBAO deployed via `KubernetesOpenBao` component, Helm chart `0.25.6`

### Enterprise Trust Model (Design Decision)

The runner impersonates users via `ImpersonatedChannelFactory` to pass FGA checks. `can_impersonate` is a binary superpower -- splitting operator roles does NOT reduce the blast radius for secrets, because either you can impersonate or you can't.

This is the standard managed-SaaS trust model (same as AWS, Stripe, Datadog). Every managed platform operator theoretically can access customer data.

**Three-tier enterprise answer:**
1. **Default (managed SaaS)**: Secrets in vault (not DB), per-org encryption keys, vault-native audit trail, separation of duties between app team and vault operators. This covers 95% of enterprises.
2. **Self-hosted enterprise (roadmap)**: Deploy your own Stigmer + vault. Runner + secrets stay in your infrastructure. Stigmer orchestrates via Temporal, your runner executes locally. This is the answer for truly paranoid enterprises.
3. **BYO vault (future)**: Point Stigmer at your own vault (HashiCorp Vault, AWS SM, etc.). `VaultSecretStore` abstraction supports this.

Self-hosted and BYO vault are **NOT in scope** for this project but are documented as the architectural escape hatch.

---

## Task Breakdown

### Phase 0: Deploy OpenBAO Infrastructure (cloud-only)

Add an OpenBAO instance to the Stigmer infrastructure stack.

1. Create `KubernetesOpenBao` manifest in `stigmer-cloud/_ops/planton/infra-hub/`
   - Standalone mode with file storage
   - TLS via Istio sidecar
   - GCP KMS auto-unseal for production
2. Create Planton `SecretsGroup` entry for OpenBAO address + root token
3. Wire `VAULT_ADDR` and `VAULT_TOKEN` into `stigmer-service` via Kustomize env
   - Update `stigmer-service/_kustomize/base/service.yaml`
4. Add `vault-commons` library dependency to `stigmer-cloud/backend/libs/java/`
   - Reuse Planton's `PlatformVaultClient` (KV v2 + Transit operations via Spring Vault)
   - Add `VaultConfiguration` Spring config with `stigmer.vault.uri` / `stigmer.vault.token`
5. Verify connectivity: health check activity or startup probe

**Deliverable**: Running OpenBAO accessible from `stigmer-service`, Spring `VaultTemplate` wired and tested.

### Phase 1: Envelope Encryption Layer (no proto changes, backward-compatible)

Replace the single static AES key with envelope encryption. No external API changes. This is an internal-only change -- clients see no difference.

1. Port or depend on Planton's `EnvelopeEncryptionService` and `KeyEncryptionKeyProvider` interface
   - Source: `planton/backend/libs/java/domain/secrets-commons/`
2. Create `StigmerTransitKekProvider` implementing `KeyEncryptionKeyProvider`
   - Transit key name = organization ID (per-org isolation, same as Planton's pattern)
   - On first encrypt for an org: `ensureTransitKey(orgId)` then `transitEncrypt(orgId, dekBytes)`
   - Decrypt: `transitDecrypt(orgId, wrappedDek)`
3. Update `SecretEncryptionService` (or create `VaultSecretEncryptionService`):
   - **Encrypt**: Generate random AES-256 DEK, encrypt value, wrap DEK via Transit, produce envelope
   - **Decrypt**: Parse envelope, unwrap DEK via Transit, decrypt value
   - New wire format: `enc:v2:<base64(envelope_json)>`
4. Maintain backward compatibility:
   - Decrypt path: if prefix is `enc:v1:`, use old static-key path; if `enc:v2:`, use envelope path
   - Encrypt path: always produce `enc:v2:` for new writes
5. Lazy re-encryption: when an environment is updated, old `enc:v1:` values get re-encrypted as `enc:v2:`
6. Apply to all secret write paths:
   - `EncryptSecretValues` step (Environment create/update)
   - `EncryptClientSecret` step (OAuthApp create/update)
   - `EnvironmentMergeService` (ExecutionContext creation)

**Deliverable**: All new secret writes use envelope encryption; all old `enc:v1:` reads still work; per-org key isolation via Transit.

### Phase 2: Move Secret Values Out of MongoDB (proto changes required)

Secret values no longer persist in MongoDB -- only metadata and vault references. This is the most significant change.

1. **Proto changes** (in `stigmer/apis/`, additive and backward-compatible):
   - Add `string vault_ref = 4` to `EnvironmentValue` -- vault path when `is_secret=true`
   - Add `string vault_ref = 3` to `ExecutionValue` -- same pattern
   - No breaking changes; OSS server ignores `vault_ref` and continues inline storage
   - Run `buf lint` and `buf breaking` to validate

2. **VaultSecretStore** -- new service in `stigmer-cloud`:
   - `writeSecret(path, value)` -- envelope-encrypt then write to KV v2
   - `readSecret(path)` -- read from KV v2 then envelope-decrypt
   - `deleteSecret(path)` -- delete from KV v2
   - Paths for persistent secrets: `{org}/{resource_type}/{resource_slug}/{key}`
   - Paths for ephemeral secrets: `ephemeral/{execution_id}/{key}`

3. **Environment writes** (refactor `EncryptSecretValues` step):
   - When `is_secret=true`: write value to vault, set `vault_ref` to vault path, set `value` to `***VAULT***`
   - MongoDB stores only the reference marker, not ciphertext

4. **Environment reads**:
   - `get` / `list` / `getByReference`: return `***VAULT***` for secret values (redacted, same as today)
   - `getSecretValue`: read from vault via `vault_ref`, return plaintext (existing `can_read_secrets` FGA check, creator-only)

5. **ExecutionContext creation** (refactor `CreateExecutionContextStep` / `EnvironmentMergeService`):
   - Merge environment refs as today
   - Write individual secret values to vault at ephemeral paths: `ephemeral/{execution_id}/{key}`
   - Store `vault_ref` in ExecutionContext `spec.data`, not the ciphertext
   - Non-secret config values remain inline in MongoDB (no change)

6. **ExecutionContext reads** (refactor `getByExecutionId` handler):
   - For entries with `vault_ref`: resolve from vault, return plaintext (JIT resolution)
   - For entries without `vault_ref` (non-secrets): return inline value
   - Existing `can_view` FGA check unchanged; impersonation flow unchanged
   - Each vault read is logged in vault audit trail (per-secret audit, for free)

7. **ExecutionContext deletion** (Temporal cleanup activity):
   - Delete ephemeral vault paths in addition to MongoDB document
   - Vault paths have TTL as backup (execution timeout + buffer)

8. **OAuthApp** (refactor `EncryptClientSecret` step):
   - Write `client_secret` to vault at `{org}/oauth_app/{slug}/client_secret`
   - MongoDB stores `***VAULT***` in `spec.client_secret`
   - OAuth flows (token exchange, refresh in `ManagedEnvironmentService`, `VendorOAuthReconciler`) read `client_secret` from vault at point of use

**Deliverable**: Zero secret values in MongoDB. All secrets in vault with per-secret audit trail. JIT resolution for execution secrets.

### Phase 3: Audit Logging Enhancement

Ensure every secret access is logged and traceable for compliance.

1. **Vault-native audit**: Enable OpenBAO audit device (file or syslog)
   - Logs every KV read/write/delete with timestamp, vault path, token identity
   - This is essentially free -- just an OpenBAO config toggle
2. **Application-level audit**: Add structured log entries on:
   - `getSecretValue` (Environment) -- who, which environment, which key, when
   - `getByExecutionId` with secret resolution -- which execution, which keys resolved, when
   - OAuth token exchange / refresh -- which OAuthApp, which org, when
3. **No FGA changes needed**: Existing `can_read_secrets` (Environment) and `can_view` (ExecutionContext) are sufficient. The impersonation model is unchanged.

**Deliverable**: Answerable audit trail -- "who accessed which secret when" for compliance. Enterprises can query vault audit logs independently of Stigmer application logs.

---

## Out of Scope (Documented for Roadmap)

1. **Self-hosted Stigmer enterprise edition** -- the real answer for enterprises that cannot accept managed-SaaS trust. Runner + secrets stay in customer infrastructure. Stigmer orchestrates via Temporal. When an org says "we don't want to give runner access to our secrets," the answer is "deploy your own runner."
2. **BYO vault** -- customers point Stigmer at their own vault (HashiCorp Vault, AWS Secrets Manager, etc.). The `VaultSecretStore` abstraction supports this future, but only the platform OpenBAO backend is implemented now.
3. **FGA operator role splitting** -- `can_impersonate` is a binary superpower. Splitting it into `runner_operator` vs `control_plane_operator` does not reduce blast radius for secrets because impersonation itself is the access mechanism. The real answer is self-hosted for paranoid enterprises.
4. **Scoped ephemeral tokens / per-execution vault tokens** -- Overcomplicates the system without changing the fundamental trust boundary. The runner operates in trusted Stigmer infrastructure; adding token scoping within that boundary is security theater.

## OSS vs Cloud Classification

- **Phases 0-3**: Cloud-only. OSS continues with existing `SecretEncryptionService` (static key, SQLite, single-user local-first).
- **Proto changes** (Phase 2): Live in OSS `apis/` (source of truth). New `vault_ref` fields are additive; OSS server ignores them and continues inline storage.
- **Wire format `enc:v2:`**: Documented so future OSS vault integration is possible, but not needed for local single-user.

## Success Criteria for T01

- [ ] OpenBAO infrastructure manifest reviewed and ready to deploy
- [ ] `vault-commons` dependency integration plan confirmed
- [ ] Envelope encryption wire format (`enc:v2:`) specified with backward-compat for `enc:v1:`
- [ ] `VaultSecretStore` interface designed (vault paths, operations, TTL strategy)
- [ ] Proto changes for `vault_ref` designed (additive, no breaking changes, buf lint/breaking pass)
- [ ] `getByExecutionId` JIT resolution flow documented (vault read per secret entry)
- [ ] Audit logging approach confirmed (vault audit device + application logs)
- [ ] Lazy re-encryption strategy for existing `enc:v1:` data confirmed
- [ ] Enterprise trust model documented (three tiers: managed, self-hosted, BYO vault)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| OpenBAO operational issues | Planton already operates OpenBAO in production; reuse their runbooks, monitoring, and Helm chart version (0.25.6) |
| Migration of existing `enc:v1:` secrets | Lazy re-encryption on update; batch migration script as optional accelerator |
| Runner latency from vault reads | Vault is in-cluster (sub-ms network hop); KV v2 reads are fast; cache provider per-org if needed |
| Spring Vault compatibility with OpenBAO | OpenBAO is Vault-API-compatible; Planton's `vault-commons` already validates this in production |
| Vault unavailability during execution | Circuit breaker + fail execution (do NOT fallback to insecure); vault HA with Raft if needed later |
| `enc:v1:` Go counterpart in stigmer-server (OSS) | Document `enc:v2:` format so Go implementation can be updated later; OSS is not blocked |

## Implementation Priority and Dependencies

```
Phase 0 (1-2 days) -> Phase 1 (3-5 days) -> Phase 2 (5-7 days) -> Phase 3 (1-2 days)
```

Total estimated effort: 10-16 days (2-3 weeks of focused work).

## Next Task Preview

**T02: Phase 0 Execution** -- Deploy OpenBAO infrastructure and wire vault-commons into stigmer-service.

## Notes

- Planton's `vault-commons` (`PlatformVaultClient`) and `secrets-commons` (`EnvelopeEncryptionService`) are proven in production. Reuse over rebuild.
- OpenBAO Helm chart `0.25.6` is what Planton's operator embeds. Use the same version for consistency.
- Transit key name = organization ID (per-org isolation, same as Planton's `PlatformTransitKekProvider`).
- The `enc:v1:` format has a Go counterpart in `stigmer-server` (OSS). Document `enc:v2:` format so Go can be updated later if needed.
- `PlatformClient` is already using hash + one-time reveal pattern -- no changes needed for that resource.

## Review Process

**What happens next**:
1. **You review this plan** -- consider the phasing, scope, and what's in/out
2. **Provide feedback** -- any concerns, changes, or priorities
3. **I'll revise** -- incorporate your feedback into T01_2_revised_plan.md
4. **You approve** -- explicit approval to proceed
5. **Execution begins** -- tracked in T01_3_execution.md
