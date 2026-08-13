/**
 * Payload-encryption configuration (stigmer-cloud#227, stigmer#398).
 *
 * Two key sources, strict precedence:
 *
 *   1. Environment (STIGMER_PAYLOAD_ENCRYPTION_KEY(_ID)) — the operator's
 *      explicit choice: self-hosted deployments sharing one key with their
 *      server, and cloud sandboxes injected with the platform key. When the
 *      env key is set, bootstrap-delivered material is ignored entirely.
 *   2. Bootstrap-delivered — server-managed per-identity keys handed to
 *      desktop-class runners by getRunnerBootstrapConfig. Held in memory
 *      only; persistence lives server-side, which is what makes Temporal
 *      replay work across runner restarts (every boot re-fetches the SAME
 *      key).
 *
 * Encryption is enabled iff a key is present from either source — the same
 * enabled-iff-configured pattern as the claim-check codec. A malformed key
 * fails the boot rather than silently running plaintext: an operator who set
 * the key (or a server that minted one) intended history to be encrypted.
 *
 * Key rotation: payloads carry the id of the key that encrypted them.
 * During a rotation window the previous key stays readable via the
 * secondary pair while new payloads are written under the primary key.
 * Workers capture keys at construction, so a rotated bootstrap key lands
 * on the next runner boot — there is no live re-key.
 */

import { getRunnerSecret } from "../shared/runner-credential-store.js";

export interface EncryptionKey {
  readonly keyId: string;
  /** 32-byte AES-256 key. */
  readonly key: Buffer;
}

export interface PayloadEncryptionConfig {
  /** Key used to encrypt outgoing payloads (and decrypt its own). */
  readonly primary: EncryptionKey;
  /** Decrypt-only key accepted during rotation windows. */
  readonly secondary?: EncryptionKey;
}

/**
 * Server-managed key material delivered by getRunnerBootstrapConfig.
 * Structurally mirrors {@link BootstrapPayloadEncryptionKeys} in
 * stigmer-client.ts — declared here so this leaf module stays free of
 * client imports.
 */
export interface BootstrapKeyMaterial {
  readonly key: string;
  readonly keyId?: string;
  readonly secondaryKey?: string;
  readonly secondaryKeyId?: string;
}

const KEY_ENV = "STIGMER_PAYLOAD_ENCRYPTION_KEY";
const KEY_ID_ENV = "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID";
const SECONDARY_KEY_ENV = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY";
const SECONDARY_KEY_ID_ENV = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID";

const AES_256_KEY_BYTES = 32;

/**
 * Returns the encryption config, or undefined when encryption is not
 * configured (the codec is then simply not installed).
 *
 * Source precedence: the env key wins outright; bootstrap-delivered
 * material applies only when no env key is set (see the module doc).
 *
 * @throws when a key is present but malformed, or a key id is missing —
 *   key misconfiguration must stop the boot, not degrade to plaintext.
 *   This applies equally to bootstrap material: a server that hands out
 *   a bad key or omits its id has broken the protocol contract, and
 *   running plaintext against a server that manages keys would silently
 *   defeat the feature.
 */
export function loadPayloadEncryptionConfig(
  bootstrap?: BootstrapKeyMaterial,
): PayloadEncryptionConfig | undefined {
  // Key VALUES resolve through the credential store (the #508 boot capture
  // moves them out of process.env — agent shells must not read them); the
  // *_KEY_ID companions are rotation bookkeeping, not secrets, and stay
  // plain env reads.
  const rawKey = getRunnerSecret(KEY_ENV);
  if (rawKey) {
    const primary: EncryptionKey = {
      keyId: requireKeyId(KEY_ID_ENV),
      key: parseKey(rawKey, KEY_ENV),
    };

    const rawSecondary = getRunnerSecret(SECONDARY_KEY_ENV);
    const secondary: EncryptionKey | undefined = rawSecondary
      ? {
          keyId: requireKeyId(SECONDARY_KEY_ID_ENV),
          key: parseKey(rawSecondary, SECONDARY_KEY_ENV),
        }
      : undefined;

    return { primary, secondary };
  }

  if (bootstrap?.key) {
    const primary: EncryptionKey = {
      keyId: requireBootstrapKeyId(bootstrap.keyId, "payload_encryption_key_id"),
      key: parseKey(bootstrap.key, "bootstrap payload_encryption_key"),
    };

    const secondary: EncryptionKey | undefined = bootstrap.secondaryKey
      ? {
          keyId: requireBootstrapKeyId(
            bootstrap.secondaryKeyId,
            "payload_encryption_secondary_key_id",
          ),
          key: parseKey(bootstrap.secondaryKey, "bootstrap payload_encryption_secondary_key"),
        }
      : undefined;

    return { primary, secondary };
  }

  return undefined;
}

function requireKeyId(envName: string): string {
  const keyId = process.env[envName];
  // An explicit id is required (no default): during rotation two keys
  // coexist, and payloads must name which one encrypted them.
  if (!keyId) {
    throw new Error(
      `Payload encryption misconfigured: ${envName} is required when the ` +
        `corresponding key is set`,
    );
  }
  return keyId;
}

function requireBootstrapKeyId(keyId: string | undefined, fieldName: string): string {
  if (!keyId) {
    throw new Error(
      `Runner bootstrap returned a payload encryption key without its ${fieldName} — ` +
        `refusing to encrypt under an unidentified key (server contract violation)`,
    );
  }
  return keyId;
}

function parseKey(rawBase64: string, envName: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(rawBase64, "base64");
  } catch {
    throw new Error(`Payload encryption misconfigured: ${envName} is not valid base64`);
  }
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error(
      `Payload encryption misconfigured: ${envName} must decode to ` +
        `${AES_256_KEY_BYTES} bytes (AES-256), got ${key.length}`,
    );
  }
  return key;
}
