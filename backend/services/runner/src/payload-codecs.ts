/**
 * Single assembly point for the worker's payload codec chain, shared by
 * the standalone runner (runner.ts) and the runner manager
 * (runner-manager.ts) so the two entrypoints cannot drift.
 *
 * The chain is payload encryption alone, or nothing. Large run content is not
 * a codec's job: a codec never knows which execution a payload belongs to, so
 * it cannot write under the execution's artifact prefix (the only keys the
 * hosted artifacts lane accepts), and the server decodes runner results with
 * the encryption codec alone. Oversized tool outputs and file bodies are
 * offloaded before they reach Temporal, by shared/status-offload.ts, which has
 * the execution in hand (stigmer#992 removed the claim-check codec this file
 * once built).
 *
 * Codec order is a correctness property. Temporal applies codecs in array
 * order on encode and in reverse on decode, so a codec added here goes after
 * encryption: whatever it hands to another store is then already ciphertext.
 *
 * The same encryption codec opens a run credential the server sealed for a
 * turn on a shared runner ({@link sealedValueOpener}): one key, one codec
 * instance, the one the worker decodes its payloads with.
 */

import type { BootstrapKeyMaterial } from "@stigmer/temporal-codecs";
import type { PayloadCodec } from "@temporalio/common";
import { getRunnerSecret } from "./shared/runner-credential-store.js";

export async function createPayloadCodecs(
  bootstrapKeys?: BootstrapKeyMaterial,
): Promise<PayloadCodec[] | undefined> {
  const codecs: PayloadCodec[] = [];

  const { loadPayloadEncryptionConfig, EncryptionPayloadCodec } = await import(
    "@stigmer/temporal-codecs"
  );
  // Env-configured keys win outright; server-managed (bootstrap) keys apply
  // only when the env is silent — see the lib's encryption/config.ts for the
  // rationale. Key VALUES resolve through getRunnerSecret (the #508 boot
  // capture moves them out of process.env — agent shells must not read
  // them), which is why the loader takes the reader as an argument.
  const encryptionConfig = loadPayloadEncryptionConfig(getRunnerSecret, bootstrapKeys);
  if (encryptionConfig) {
    codecs.push(new EncryptionPayloadCodec(encryptionConfig));
    const source = getRunnerSecret("STIGMER_PAYLOAD_ENCRYPTION_KEY") ? "env" : "bootstrap";
    console.log(
      `[runner] Payload encryption enabled (source=${source}, ` +
        `key_id=${encryptionConfig.primary.keyId}` +
        (encryptionConfig.secondary
          ? `, secondary_key_id=${encryptionConfig.secondary.keyId})`
          : ")"),
    );
  }

  return codecs.length > 0 ? codecs : undefined;
}

/**
 * Opens a value the server sealed with its payload key
 * (`@stigmer/temporal-codecs` `openSealedString`), with the chain's
 * encryption codec; `undefined` when the chain has none. The chain is
 * encryption alone or nothing (the module header), so its first codec is
 * the encryption codec.
 */
export function sealedValueOpener(
  codecs: readonly PayloadCodec[] | undefined,
): ((sealed: string) => Promise<string>) | undefined {
  const encryption = codecs?.[0];
  if (encryption === undefined) return undefined;
  return async (sealed) => {
    const { openSealedString } = await import("@stigmer/temporal-codecs");
    return openSealedString(encryption, sealed);
  };
}
