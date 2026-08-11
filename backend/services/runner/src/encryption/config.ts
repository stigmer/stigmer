/**
 * Payload-encryption configuration (stigmer-cloud#227).
 *
 * Encryption is enabled iff STIGMER_PAYLOAD_ENCRYPTION_KEY is present —
 * the same enabled-iff-configured pattern as the claim-check codec. A
 * malformed key fails the boot rather than silently running plaintext:
 * an operator who set the key intended history to be encrypted.
 *
 * Key rotation: payloads carry the id of the key that encrypted them.
 * During a rotation window the previous key stays readable via
 * STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY(_ID) while new payloads are
 * written under the primary key.
 */

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

const KEY_ENV = "STIGMER_PAYLOAD_ENCRYPTION_KEY";
const KEY_ID_ENV = "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID";
const SECONDARY_KEY_ENV = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY";
const SECONDARY_KEY_ID_ENV = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID";

const AES_256_KEY_BYTES = 32;

/**
 * Returns the encryption config, or undefined when encryption is not
 * configured (the codec is then simply not installed).
 *
 * @throws when a key is present but malformed, or a key id is missing —
 *   key misconfiguration must stop the boot, not degrade to plaintext.
 */
export function loadPayloadEncryptionConfig(): PayloadEncryptionConfig | undefined {
  const rawKey = process.env[KEY_ENV];
  if (!rawKey) {
    return undefined;
  }

  const primary: EncryptionKey = {
    keyId: requireKeyId(KEY_ID_ENV),
    key: parseKey(rawKey, KEY_ENV),
  };

  const rawSecondary = process.env[SECONDARY_KEY_ENV];
  const secondary: EncryptionKey | undefined = rawSecondary
    ? {
        keyId: requireKeyId(SECONDARY_KEY_ID_ENV),
        key: parseKey(rawSecondary, SECONDARY_KEY_ENV),
      }
    : undefined;

  return { primary, secondary };
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
