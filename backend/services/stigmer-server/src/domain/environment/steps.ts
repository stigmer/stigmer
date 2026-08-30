/**
 * Environment domain steps — port
 * pkg/domain/environment/controller/steps/ (the create/update sentinel
 * guard, the encrypt-at-rest step, personal-environment uniqueness, the
 * single-key reveal extractor, the environment_id loader, and the two
 * self-contained write-boundary steps for incremental variable management).
 *
 * The ordering contracts these steps embody (the cloud "sentinels →
 * encrypt" doc, oss#395/oss#405):
 *   1. PreserveRedactedSecrets runs BEFORE EncryptSecretValues — the
 *      marker arm restores stored ciphertext, whose idempotent encrypt
 *      pass-through must leave it unchanged (never double-encrypted).
 *   2. Within the guard, the marker arm runs BEFORE the forged-ciphertext
 *      arm — after preservation, legitimate stored ciphertext is present
 *      by design and must not hit the forgery rejection.
 *   3. Redaction (redact.ts) runs AFTER Persist, outside the pipeline.
 *
 * Proven by environment.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/environment.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import {
  EnvironmentSpecSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type {
  EnvironmentSecretValueInputSchema,
  RemoveEnvironmentVariablesRequestSchema,
  UpdateEnvironmentVariablesRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { findResourceByLabelAndOrg } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { destroySecretBackingState } from "../../pipeline/steps/secret-cleanup.js";
import type { Store } from "../../store/interface.js";
import {
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
  forgedCiphertextMessage,
  markerRejectionMessage,
  personalEnvironmentExistsMessage,
  REDACTED_MARKER,
} from "./constants.js";

/** Context key for the decrypted single-key result — Go SecretValueKey. */
export const SECRET_VALUE_KEY = "secretValue";

/**
 * Context key for the modified environment after a merge/remove variables
 * operation — Go UpdatedEnvironmentKey.
 */
export const UPDATED_ENVIRONMENT_KEY = "updatedEnvironment";

/**
 * PreserveRedactedSecrets — Go preserve_redacted_secrets.go. Handles
 * client-supplied secret SENTINELS on write, serving both the create and
 * full-resource update pipelines:
 *
 *   - A secret whose incoming value is the ***REDACTED*** marker is
 *     restored from the existing resource (update). When there is nothing
 *     to preserve — a create, or an update for a key that had no prior
 *     secret — the marker is meaningless and rejected with
 *     INVALID_ARGUMENT rather than stored literally.
 *   - A secret carrying the ciphertext-shaped enc:v<N>: prefix is rejected
 *     with INVALID_ARGUMENT (oss#395): the prefix is server-reserved. The
 *     marker arm must run FIRST — after preservation, legitimate stored
 *     ciphertext is present by design and must not hit this arm.
 *   - Non-secret values pass through untouched. They are exempt from the
 *     prefix rejection deliberately: every decrypt path gates on
 *     is_secret && isEncrypted, so a non-secret prefixed string is inert,
 *     and flipping it to secret later re-enters this guard.
 *
 * Runs while spec.data is still raw client input: after BuildUpdateState
 * (update; requires LoadExisting) or after BuildNewState (create, where
 * EXISTING_RESOURCE_KEY is absent and every marker is rejected).
 */
export function newPreserveRedactedSecretsStep(): PipelineStep<
  typeof EnvironmentSchema
> {
  return {
    name: "PreserveRedactedSecrets",
    execute(ctx: RequestContext<typeof EnvironmentSchema>): void {
      const data = ctx.newState.spec?.data;
      if (data === undefined || Object.keys(data).length === 0) {
        return;
      }

      // Absent existing resource (the create pipeline) means there is
      // nothing to preserve: fall through with an empty map so every
      // marker is rejected instead of silently skipping the guards.
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | Environment
        | undefined;
      const existingData = existing?.spec?.data ?? {};

      for (const [key, value] of Object.entries(data)) {
        if (!value.isSecret) {
          continue;
        }

        if (value.value === REDACTED_MARKER) {
          const existingEntry = existingData[key];
          if (existingEntry !== undefined && existingEntry.isSecret) {
            data[key] = existingEntry;
            continue;
          }
          throw invalidArgumentError(markerRejectionMessage(key));
        }

        // Unconditional (not gated on encryption being enabled): the
        // prefix is server-reserved regardless of key state.
        if (isCiphertextShaped(value.value)) {
          throw invalidArgumentError(forgedCiphertextMessage(key));
        }
      }
    },
  };
}

/**
 * EncryptSecretValues — Go encrypt_secret_values.go: encrypts every
 * is_secret value in spec.data before persistence (oss#405 — environment
 * secrets rested plaintext while oauthapp/channelapp secrets were
 * encrypted in the same store).
 *
 * MUST run after PreserveRedactedSecrets ("sentinels → encrypt"): by this
 * point every secret value is either fresh client plaintext (encrypt it)
 * or marker-restored stored ciphertext (the idempotent pass-through leaves
 * it unchanged, so a round-tripped secret is never double-encrypted).
 *
 * Keyless mode: values pass through plaintext with one WARN per request,
 * emitted only when a non-empty secret would actually rest plaintext (the
 * oss#394 convention shared with oauthapp and channelapp). Non-secret
 * values are never touched: the decrypt paths gate on is_secret, so
 * encrypting a non-secret value would strand it as unreadable ciphertext.
 */
export function newEncryptSecretValuesStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof EnvironmentSchema> {
  return {
    name: "EncryptSecretValues",
    async execute(
      ctx: RequestContext<typeof EnvironmentSchema>,
    ): Promise<void> {
      const env = ctx.newState;
      const data = env.spec?.data;
      if (data === undefined || Object.keys(data).length === 0) {
        return;
      }

      if (!secretService.isEnabled()) {
        if (hasNonEmptySecret(data)) {
          logger.warn(
            "Encryption disabled: environment secret values will be stored in plaintext",
            { environmentId: env.metadata?.id ?? "" },
          );
        }
        return;
      }

      for (const [key, value] of Object.entries(data)) {
        if (!value.isSecret || value.value === "") {
          continue;
        }
        try {
          // Tenancy-only scope, the pre-v3 write posture: environment is
          // an org-scoped kind, so metadata.org is validated non-empty
          // long before this step. The v1 codec ignores the scope; a
          // vault-backed write codec keys the per-org KEK by it.
          value.value = await secretService.encrypt(
            value.value,
            EncryptionScope.forOrganization(env.metadata?.org ?? ""),
          );
        } catch (error) {
          throw internalError(
            error,
            `failed to encrypt secret value for variable '${key}'`,
          );
        }
      }
    },
  };
}

/** Whether any entry would have been encrypted — keeps the WARN honest. */
function hasNonEmptySecret(data: Record<string, EnvironmentValue>): boolean {
  return Object.values(data).some((v) => v.isSecret && v.value !== "");
}

/**
 * EnforcePersonalEnvUniqueness — Go enforce_personal_uniqueness.go: at
 * most one personal environment (stigmer.ai/personal=true) per ORG →
 * ALREADY_EXISTS. Non-personal environments are a no-op.
 *
 * Contract note: cloud enforces per (org, owner) — it also scopes by the
 * creating identity. OSS has no caller identity yet (audit created_by is
 * the "system" actor), so per-(org, owner) collapses to per-org here — a
 * faithful specialization of the shared contract, not a divergence.
 *
 * Create-time only, before the resource has an id, so it never matches
 * the in-flight resource against itself; update deliberately omits it.
 */
export function newEnforcePersonalUniquenessStep(
  store: Store,
): PipelineStep<typeof EnvironmentSchema> {
  return {
    // The Go step's registered name — note "Env", not the type name.
    name: "EnforcePersonalEnvUniqueness",
    async execute(
      ctx: RequestContext<typeof EnvironmentSchema>,
    ): Promise<void> {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined) {
        return;
      }
      if (metadata.labels[PERSONAL_LABEL_KEY] !== PERSONAL_LABEL_VALUE) {
        return;
      }

      let existing: Environment | undefined;
      try {
        existing = await findResourceByLabelAndOrg(
          store,
          ctx.apiResourceKind,
          EnvironmentSchema,
          PERSONAL_LABEL_KEY,
          PERSONAL_LABEL_VALUE,
          metadata.org,
        );
      } catch (error) {
        throw internalError(
          error,
          "failed to check personal environment uniqueness",
        );
      }

      if (existing !== undefined) {
        // Go raises this via status.Errorf(codes.AlreadyExists, "<copy>"),
        // NOT the grpclib helper's "%s already exists: %s" format — the
        // wire message is the bare pinned copy, so the ConnectError is
        // constructed directly rather than through alreadyExistsError().
        throw new ConnectError(
          personalEnvironmentExistsMessage(existing.metadata?.id ?? ""),
          Code.AlreadyExists,
        );
      }
    },
  };
}

/**
 * LoadEnvironmentByID — Go load_environment_by_id.go: loads by the
 * environment_id field (the standard LoadTarget expects a `value` id
 * field, but EnvironmentSecretValueInput / Update-/RemoveEnvironment-
 * VariablesRequest carry `environment_id`). Stores under
 * TARGET_RESOURCE_KEY.
 */
export function newLoadEnvironmentByIdStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "LoadEnvironmentByID",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const environmentId = (ctx.input as { environmentId?: unknown })
        .environmentId;
      if (typeof environmentId !== "string" || environmentId === "") {
        throw invalidArgumentError("environment_id is required");
      }

      let env: Environment;
      try {
        env = await store.getResource(
          ctx.apiResourceKind,
          environmentId,
          EnvironmentSchema,
        );
      } catch {
        // Go maps EVERY load failure to NotFound here (store errors
        // included) — ported as-is.
        throw notFoundError("environment", environmentId);
      }

      ctx.set(TARGET_RESOURCE_KEY, env);
    },
  };
}

/**
 * ExtractAndDecryptSingleKey — Go extract_and_decrypt_single_key.go: the
 * getSecretValue reveal path. Missing key → NotFound; non-secret → the
 * value as-is; secret → decrypted via the SecretService (a decrypt failure
 * — including keyless-with-ciphertext — is Internal; the loud path, never
 * a silent marker).
 */
export function newExtractAndDecryptSingleKeyStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof EnvironmentSecretValueInputSchema> {
  return {
    name: "ExtractAndDecryptSingleKey",
    async execute(
      ctx: RequestContext<typeof EnvironmentSecretValueInputSchema>,
    ): Promise<void> {
      const key = ctx.input.key;

      const env = ctx.get(TARGET_RESOURCE_KEY) as Environment | undefined;
      if (env === undefined) {
        throw internalError(
          new Error("targetResource missing or wrong type"),
          "environment not loaded in context",
        );
      }

      const envValue = env.spec?.data[key];
      if (envValue === undefined) {
        throw notFoundError("environment key", key);
      }

      if (envValue.isSecret && envValue.value !== "") {
        let decrypted: string;
        try {
          decrypted = await secretService.decrypt(envValue.value);
        } catch (error) {
          logger.error("Failed to decrypt secret value", {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
          throw internalError(error, "failed to decrypt secret value");
        }
        ctx.set(
          SECRET_VALUE_KEY,
          create(EnvironmentValueSchema, {
            value: decrypted,
            isSecret: true,
            description: envValue.description,
          }),
        );
        return;
      }

      ctx.set(SECRET_VALUE_KEY, envValue);
    },
  };
}

/**
 * MergeVariablesAndPersist — Go merge_variables_and_persist.go: merges
 * incoming variables into the loaded environment's spec.data and persists.
 * Request keys overwrite; absent keys are preserved.
 *
 * This step is its OWN write boundary (sentinel guard, merge, encrypt, and
 * persist all live here — same ordering contract as create/update:
 * sentinels first, then encrypt). This is the path OAuth-managed vendor
 * tokens take, so they rest encrypted too. Deliberately NO search
 * re-index: variables are not indexed fields (mirror, don't fix).
 *
 * Requires LoadEnvironmentByID first (reads TARGET_RESOURCE_KEY); stores
 * the modified environment under UPDATED_ENVIRONMENT_KEY. Stamps the
 * SpecAudit slot (#540 — a definition change).
 */
export function newMergeVariablesAndPersistStep(
  store: Store,
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof UpdateEnvironmentVariablesRequestSchema> {
  return {
    name: "MergeVariablesAndPersist",
    async execute(
      ctx: RequestContext<typeof UpdateEnvironmentVariablesRequestSchema>,
    ): Promise<void> {
      const env = ctx.get(TARGET_RESOURCE_KEY) as Environment | undefined;
      if (env === undefined) {
        throw internalError(
          new Error("targetResource missing or wrong type"),
          "environment not loaded in context",
        );
      }

      if (env.spec === undefined) {
        env.spec = create(EnvironmentSpecSchema, {});
      }

      const incoming = ctx.input.variables;
      for (const [key, incomingValue] of Object.entries(incoming)) {
        let value = incomingValue;
        if (value.isSecret && value.value === REDACTED_MARKER) {
          const existing = env.spec.data[key];
          if (existing !== undefined && existing.isSecret) {
            continue; // preserved — the round-trip contract
          }
          throw invalidArgumentError(markerRejectionMessage(key));
        }
        // Ciphertext-shaped client input is rejected at every secret write
        // boundary (oss#395); see newPreserveRedactedSecretsStep for the
        // full rationale. Non-secret values are deliberately exempt.
        if (value.isSecret && isCiphertextShaped(value.value)) {
          throw invalidArgumentError(forgedCiphertextMessage(key));
        }
        if (value.isSecret && value.value !== "") {
          if (!secretService.isEnabled()) {
            logger.warn(
              "Encryption disabled: environment secret value will be stored in plaintext",
              { key },
            );
          } else {
            let encrypted: string;
            try {
              encrypted = await secretService.encrypt(
                value.value,
                EncryptionScope.forOrganization(env.metadata?.org ?? ""),
              );
            } catch (error) {
              throw internalError(
                error,
                `failed to encrypt secret value for variable '${key}'`,
              );
            }
            value = create(EnvironmentValueSchema, {
              value: encrypted,
              isSecret: true,
              description: value.description,
            });
          }
        }
        env.spec.data[key] = value;
      }

      try {
        setAuditFieldsForUpdate(
          EnvironmentSchema,
          env,
          "spec_audit",
          ctx.callerIdentity,
        );
      } catch (error) {
        throw internalError(error, "failed to set audit fields");
      }

      try {
        await store.saveResource(
          ctx.apiResourceKind,
          env.metadata?.id ?? "",
          EnvironmentSchema,
          env,
        );
      } catch (error) {
        throw internalError(
          error,
          "failed to persist environment after merging variables",
        );
      }

      ctx.set(UPDATED_ENVIRONMENT_KEY, env);
    },
  };
}

/**
 * RemoveVariableKeysAndPersist — Go remove_variable_keys_and_persist.go:
 * deletes the named keys from spec.data (unknown keys silently ignored)
 * and persists. Requires LoadEnvironmentByID first; stores the modified
 * environment under UPDATED_ENVIRONMENT_KEY; stamps SpecAudit. No search
 * re-index, as in Go.
 *
 * The removed keys' sealed values have their external backing state
 * destroyed AFTER the persist (the Java RemoveAndPersist site, wired by
 * convergence 20260830.04 Stage 3): the old values must be captured
 * BEFORE the deletion mutates the loaded resource, and destruction is
 * best-effort — a failure never fails the remove (secret-cleanup.ts
 * carries the full contract). A no-op under the OSS v1-only codec set.
 */
export function newRemoveVariableKeysAndPersistStep(
  store: Store,
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof RemoveEnvironmentVariablesRequestSchema> {
  return {
    name: "RemoveVariableKeysAndPersist",
    async execute(
      ctx: RequestContext<typeof RemoveEnvironmentVariablesRequestSchema>,
    ): Promise<void> {
      const env = ctx.get(TARGET_RESOURCE_KEY) as Environment | undefined;
      if (env === undefined) {
        throw internalError(
          new Error("targetResource missing or wrong type"),
          "environment not loaded in context",
        );
      }

      const keys = ctx.input.keys;
      const removedSecretValues: string[] = [];
      if (env.spec?.data !== undefined) {
        for (const key of keys) {
          const removed = env.spec.data[key];
          if (removed !== undefined && removed.isSecret) {
            removedSecretValues.push(removed.value);
          }
          delete env.spec.data[key];
        }
      }

      try {
        setAuditFieldsForUpdate(
          EnvironmentSchema,
          env,
          "spec_audit",
          ctx.callerIdentity,
        );
      } catch (error) {
        throw internalError(error, "failed to set audit fields");
      }

      try {
        await store.saveResource(
          ctx.apiResourceKind,
          env.metadata?.id ?? "",
          EnvironmentSchema,
          env,
        );
      } catch (error) {
        throw internalError(
          error,
          "failed to persist environment after removing variables",
        );
      }

      await destroySecretBackingState(
        secretService,
        logger,
        {
          kind: "environment",
          resourceId: env.metadata?.id ?? "",
          operation: "removeVariables",
        },
        removedSecretValues,
      );

      ctx.set(UPDATED_ENVIRONMENT_KEY, env);
    },
  };
}

/**
 * DestroyDroppedEnvironmentSecrets — the Java
 * DestroyDroppedEnvironmentSecrets step (wired by convergence
 * 20260830.04 Stage 3): post-persist in the full-resource update chain,
 * destroys the external backing state of secret keys the update DROPPED.
 * Strictly dropped keys only — a key that survives with a rotated value
 * keeps its KV path (superseded versions age out via the store's
 * max_versions retention), and marker-preserved keys carry their stored
 * ciphertext forward unchanged. Best-effort by the secret-cleanup
 * contract; a no-op under the OSS v1-only codec set.
 *
 * Requires LoadExisting (the pre-update state) and runs after Persist —
 * destroying before the row is written would dangle stored pointers on
 * a persist failure.
 */
export function newDestroyDroppedEnvironmentSecretsStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof EnvironmentSchema> {
  return {
    name: "DestroyDroppedEnvironmentSecrets",
    async execute(
      ctx: RequestContext<typeof EnvironmentSchema>,
    ): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | Environment
        | undefined;
      const oldData = existing?.spec?.data;
      if (oldData === undefined) {
        return;
      }
      const newData = ctx.newState.spec?.data ?? {};
      const droppedSecretValues = Object.entries(oldData)
        .filter(([key, value]) => value.isSecret && newData[key] === undefined)
        .map(([, value]) => value.value);
      await destroySecretBackingState(
        secretService,
        logger,
        {
          kind: "environment",
          resourceId: existing?.metadata?.id ?? "",
          operation: "update",
        },
        droppedSecretValues,
      );
    },
  };
}

/**
 * The sealed values an environment carries — the delete chain's
 * extractor for DestroySecretBackingState (every is_secret entry;
 * blank values are skipped by the destroyer).
 */
export function secretValuesOfEnvironment(env: Environment): string[] {
  return Object.values(env.spec?.data ?? {})
    .filter((value) => value.isSecret)
    .map((value) => value.value);
}
