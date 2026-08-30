/**
 * Secret backing-state cleanup — the OSS half of the Java
 * SecretValueCleanup contract (secrets-vault migration; wired here by
 * convergence 20260830.04 Stage 3, gate ruling Q7). When a resource
 * carrying sealed secrets is deleted — or a secret-bearing key is
 * dropped by an update — the stored ciphertext's EXTERNAL backing state
 * must be destroyed: for enc:v3 values that is a KV entry in the vault;
 * for enc:v1/v2 values (the ciphertext IS the stored value), plaintext,
 * and the ***REDACTED*** marker, SecretService.delete is a no-op by
 * construction. Under the OSS default codec set (v1 only) this module
 * therefore never changes observable behavior — the conformance rosters
 * pin that.
 *
 * Failure semantics (Java parity; the CleanupIamPolicies discipline):
 * best-effort, AFTER the store write. The row is already gone or
 * updated, so a destroy failure must never fail the request — each
 * failure logs ERROR with the resource identity and the pass continues.
 * The cloud edition additionally counts sweep-side destroy failures
 * (stigmer.encryption.cleanup.failures); the OSS delete sites log only
 * (Stage-3 gate ruling G4 — an accepted, disclosed divergence that is
 * moot until a composition writes enc:v3).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { getKindName } from "../apiresource-meta.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import type { HasMetadataShape } from "./shapes.js";

/**
 * Destroys the external backing state of each stored secret value,
 * best-effort: one failure logs ERROR (with the caller's identifying
 * fields) and never interrupts the rest. Blank values are skipped — the
 * facade would no-op them anyway, and skipping keeps the logs honest.
 *
 * Exported for the write-boundary steps that must capture their old
 * values before mutating (environment removeVariables) and for the
 * domain steps that destroy on a key diff rather than a delete.
 */
export async function destroySecretBackingState(
  secretService: SecretService,
  logger: Logger,
  fields: Record<string, unknown>,
  storedValues: readonly string[],
): Promise<void> {
  for (const storedValue of storedValues) {
    if (storedValue === "") {
      continue;
    }
    try {
      await secretService.delete(storedValue);
    } catch (error) {
      // The DB write already succeeded — an orphaned external entry is
      // the recoverable outcome (the vault retains it; the convergence
      // sweep's census keeps it visible). Never the request's failure.
      logger.error(
        "secret backing-state destruction failed after persist — external state may be orphaned",
        {
          ...fields,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

/**
 * DestroySecretBackingState — after the store delete in every delete
 * chain whose kind carries sealed secrets (environment, oauthapp,
 * channelapp; the OAuth-managed environment lane rides the environment
 * chain through the in-process client). Reads the doomed resource from
 * EXISTING_RESOURCE_KEY (seeded by LoadExistingForDelete); the
 * per-domain extractor names which spec fields hold sealed values.
 */
export function newDestroySecretBackingStateStep<
  InputDesc extends DescMessage,
  ResourceDesc extends DescMessage,
>(
  secretService: SecretService,
  logger: Logger,
  extractSecretValues: (
    resource: MessageShape<ResourceDesc>,
  ) => readonly string[],
): PipelineStep<InputDesc> {
  return {
    name: "DestroySecretBackingState",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const deleted = ctx.get(EXISTING_RESOURCE_KEY) as
        | MessageShape<ResourceDesc>
        | undefined;
      if (deleted === undefined) {
        return;
      }
      const metadata = (deleted as unknown as HasMetadataShape).metadata;
      await destroySecretBackingState(
        secretService,
        logger,
        {
          kind: getKindName(ctx.apiResourceKind),
          resourceId: metadata?.id ?? "",
        },
        extractSecretValues(deleted),
      );
    },
  };
}
