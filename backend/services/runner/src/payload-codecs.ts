/**
 * Single assembly point for the worker's payload codec chain, shared by
 * the standalone runner (runner.ts) and the runner manager
 * (runner-manager.ts) so the two entrypoints cannot drift.
 *
 * Codec order is a correctness property, not a style choice. Temporal
 * applies codecs in array order on encode and in reverse on decode, so
 * with [encryption, claimcheck]:
 *
 *   encode: encrypt → claim-check   (payloads the claim-check codec
 *           relocates to object storage are already ciphertext)
 *   decode: claim-check → decrypt   (restore the blob, then decrypt)
 */

import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";
import type { BootstrapKeyMaterial } from "./encryption/config.js";

export async function createPayloadCodecs(
  config: Config,
  bootstrapKeys?: BootstrapKeyMaterial,
): Promise<PayloadCodec[] | undefined> {
  const codecs: PayloadCodec[] = [];

  const { loadPayloadEncryptionConfig, EncryptionPayloadCodec } = await import(
    "./encryption/index.js"
  );
  // Env-configured keys win outright; server-managed (bootstrap) keys apply
  // only when the env is silent — see encryption/config.ts for the rationale.
  const encryptionConfig = loadPayloadEncryptionConfig(bootstrapKeys);
  if (encryptionConfig) {
    codecs.push(new EncryptionPayloadCodec(encryptionConfig));
    const source = process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY ? "env" : "bootstrap";
    console.log(
      `[runner] Payload encryption enabled (source=${source}, ` +
        `key_id=${encryptionConfig.primary.keyId}` +
        (encryptionConfig.secondary
          ? `, secondary_key_id=${encryptionConfig.secondary.keyId})`
          : ")"),
    );
  }

  const { loadClaimcheckConfig, ClaimcheckPayloadCodec } = await import(
    "./claimcheck/index.js"
  );
  const claimcheckConfig = loadClaimcheckConfig();
  if (claimcheckConfig.enabled) {
    const { loadArtifactStorageConfig, createArtifactStorage } = await import(
      "./shared/artifact-storage.js"
    );
    const storageConfig = loadArtifactStorageConfig(config);
    const storage = createArtifactStorage(storageConfig);
    codecs.push(new ClaimcheckPayloadCodec(storage, claimcheckConfig));
    console.log(
      `[runner] Claimcheck enabled (threshold=${claimcheckConfig.thresholdBytes}B, ` +
        `compression=${claimcheckConfig.compressionEnabled}, ` +
        `storage=${storageConfig.type})`,
    );
  }

  return codecs.length > 0 ? codecs : undefined;
}
