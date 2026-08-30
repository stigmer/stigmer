/**
 * The built-in enc:v1 static-key codec — the crypto that lived directly
 * on SecretService before the versioned-codec seam (20260830.04 Stage 1),
 * extracted byte-for-byte. Provenance: ports pkg/encryption/encryption.go
 * (the retired Go server), the Go twin of the cloud edition's RETIRED v1
 * codec (deleted 2026-08, PR-3 of the vault migration). Cross-edition
 * wire contract: same wire format, but a DIFFERENT key per deployment —
 * the OSS enc:v1 is a same-wire-format SIBLING of the cloud's retired v1,
 * never interchangeable ciphertext.
 *
 * Format: enc:v1:<base64(nonce || ciphertext || tag)>
 *   - AES-256-GCM, 12-byte crypto-random nonce (unique per encryption),
 *     16-byte GCM tag, standard padded Base64.
 *
 * Keyless ("disabled") semantics are load-bearing and asymmetric:
 *   - encrypt() passes plaintext through (the WARN-degrade posture — the
 *     write steps own the per-request warning, oss#394);
 *   - decrypt() fails loud (EncryptionDisabledError): stored ciphertext
 *     with no key must never be returned as-is.
 * The unprefixed-plaintext pass-through (pre-oss#405 rows) is FACADE
 * policy, not codec behavior — this codec only ever sees enc:v1: values.
 *
 * The scope parameter is deliberately ignored: v1 has one deployment-wide
 * key, no per-tenant KEK and no location. It is threaded anyway so every
 * call site already carries the tenancy a vault-backed codec needs — the
 * whole point of the seam.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SecretCodec } from "./codec.js";
import {
  DecryptionFailedError,
  EncryptionDisabledError,
  InvalidCiphertextError,
} from "./errors.js";
import { KEY_SIZE } from "./key-manager.js";
import type { EncryptionScope } from "./scope.js";

/** Nonce size for AES-GCM (12 bytes = 96 bits, NIST) — Go GCMNonceSize. */
export const GCM_NONCE_SIZE = 12;

/** GCM authentication tag size (128 bits) — Go's gcm.Overhead(). */
export const GCM_TAG_SIZE = 16;

/** Version prefix for v1-encrypted values — Go EncryptedPrefix. */
export const ENCRYPTED_PREFIX = "enc:v1:";

/** The version token the static-key codec serves. */
export const V1_VERSION = "v1";

export class StaticKeySecretCodec implements SecretCodec {
  readonly version = V1_VERSION;

  private readonly key: Buffer | undefined;

  /**
   * Go NewSecretService's key contract, now the codec's: nil/empty key →
   * disabled (keyless) codec; a present key must be exactly 32 bytes.
   */
  constructor(key: Buffer | undefined) {
    if (key === undefined || key.length === 0) {
      this.key = undefined;
      return;
    }
    if (key.length !== KEY_SIZE) {
      throw new Error(
        `encryption key must be exactly 32 bytes (256 bits): got ${key.length} bytes`,
      );
    }
    this.key = key;
  }

  /** Go IsEnabled: whether a key is configured. */
  isEnabled(): boolean {
    return this.key !== undefined;
  }

  /**
   * Go Encrypt's crypto arm: enc:v1:<base64(nonce || ct || tag)>;
   * disabled → plaintext unchanged (the WARN-degrade posture). The
   * already-prefixed idempotent pass-through is facade policy and never
   * reaches here.
   */
  // async without await: the interface is async for vault-backed codecs
  // (Transit/KV round trips); v1 is pure local crypto.
  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    if (this.key === undefined) {
      return plaintext;
    }
    const nonce = randomBytes(GCM_NONCE_SIZE);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Layout matches Go's gcm.Seal(nonce, nonce, plaintext, nil):
    // nonce || ciphertext || tag, then standard Base64.
    const sealed = Buffer.concat([nonce, ciphertext, tag]);
    return ENCRYPTED_PREFIX + sealed.toString("base64");
  }

  /**
   * Go Decrypt's crypto arm: the value carries this codec's prefix (the
   * facade dispatched it here) and decrypts or fails with the taxonomy
   * the callers branch on (invalid-ciphertext / decryption-failed /
   * encryption-disabled).
   */
  async decrypt(encrypted: string): Promise<string> {
    if (this.key === undefined) {
      throw new EncryptionDisabledError();
    }

    const base64Data = encrypted.slice(ENCRYPTED_PREFIX.length);
    const sealed = Buffer.from(base64Data, "base64");
    // Node's lenient decoder never throws; the round-trip check restores
    // Go's strict-decode error for corrupted Base64.
    if (sealed.toString("base64") !== base64Data) {
      throw new InvalidCiphertextError("invalid base64 encoding");
    }
    if (sealed.length < GCM_NONCE_SIZE + GCM_TAG_SIZE) {
      throw new InvalidCiphertextError("ciphertext too short");
    }

    const nonce = sealed.subarray(0, GCM_NONCE_SIZE);
    const ciphertext = sealed.subarray(
      GCM_NONCE_SIZE,
      sealed.length - GCM_TAG_SIZE,
    );
    const tag = sealed.subarray(sealed.length - GCM_TAG_SIZE);

    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      throw new DecryptionFailedError(error);
    }
  }
}
