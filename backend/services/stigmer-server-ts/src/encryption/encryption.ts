/**
 * Secret encryption service — ports pkg/encryption/encryption.go, the Go
 * twin of the cloud edition's Java EnvironmentSecretService. Cross-edition
 * wire contract: ciphertext produced by any edition decrypts in the others
 * (proven by the Go-generated fixture, sub-project DD-001).
 *
 * Format: enc:v1:<base64(nonce || ciphertext || tag)>
 *   - AES-256-GCM, 12-byte crypto-random nonce (unique per encryption),
 *     16-byte GCM tag, standard padded Base64.
 *
 * Keyless ("disabled") semantics are load-bearing and asymmetric:
 *   - encrypt() passes plaintext through (the WARN-degrade posture — the
 *     write steps own the per-request warning, oss#394);
 *   - decrypt() of a PREFIXED value fails loud (EncryptionDisabledError):
 *     stored ciphertext with no key must never be returned as-is;
 *   - decrypt() of an unprefixed value passes through (legacy plaintext
 *     rows, pre-oss#405).
 *
 * NOT ported: pkg/encryption/payloadcodec — that is the Temporal payload
 * lane, already extracted to backend/libs/ts/temporal-codecs (D4 #1); the
 * server's decode side arrives with the worker sub-projects.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { KEY_SIZE, getOrCreateNamedKey } from "./key-manager.js";
import type { KeyLoaderOptions } from "./key-manager.js";

/** Nonce size for AES-GCM (12 bytes = 96 bits, NIST) — Go GCMNonceSize. */
export const GCM_NONCE_SIZE = 12;

/** GCM authentication tag size (128 bits) — Go's gcm.Overhead(). */
export const GCM_TAG_SIZE = 16;

/** Version prefix for encrypted values — Go EncryptedPrefix. */
export const ENCRYPTED_PREFIX = "enc:v1:";

/** Env var configuring the secrets key (Base64 32B) — Go EnvKeyName. */
export const ENCRYPTION_KEY_ENV_VAR = "STIGMER_ENCRYPTION_KEY";

/** Key file under ~/.stigmer — Go KeyFileName. */
export const ENCRYPTION_KEY_FILE_NAME = "encryption.key";

/**
 * Matches ciphertext in ANY supported-or-future version of the enc:v<N>:
 * family. Matching all versions (not just v1) is load-bearing: an
 * unmatched version would be treated as plaintext at every dispatch site
 * and fail open (returned or re-encrypted as if it were a real value).
 * Mirrors the cloud edition's SecretEncryptionService.VERSIONED_PREFIX.
 */
const VERSIONED_PREFIX = /^enc:v\d+:/;

/** Go ErrInvalidCiphertext — malformed input (bad base64, too short). */
export class InvalidCiphertextError extends Error {
  constructor(detail: string) {
    super(`invalid ciphertext format: ${detail}`);
    this.name = "InvalidCiphertextError";
  }
}

/** Go ErrDecryptionFailed — wrong key or tampered data. */
export class DecryptionFailedError extends Error {
  constructor(cause: unknown) {
    super("decryption failed - wrong key or tampered data");
    this.name = "DecryptionFailedError";
    this.cause = cause;
  }
}

/** Go ErrEncryptionDisabled — decrypting a prefixed value with no key. */
export class EncryptionDisabledError extends Error {
  constructor() {
    super("encryption is not enabled - no key configured");
    this.name = "EncryptionDisabledError";
  }
}

/**
 * Go IsCiphertextShaped: whether a value merely has the SHAPE of
 * ciphertext — the enc:v<N>: prefix — regardless of whether it is genuine.
 *
 * This is the request-boundary provenance test (oss#395, the Go twin of
 * cloud#229): the prefix is a server-reserved sentinel, so client-supplied
 * values matching it must be rejected with INVALID_ARGUMENT before they
 * reach encrypt(), whose idempotent pass-through would otherwise persist
 * them verbatim (letting a client store forged ciphertext that
 * getSecretValue later decrypts with the deployment key). Module-level,
 * like the redaction-marker constant, so boundary steps need no service
 * instance and the rejection stays unconditional on keyless deployments.
 */
export function isCiphertextShaped(value: string): boolean {
  return VERSIONED_PREFIX.test(value);
}

/**
 * Encryption/decryption for environment (and other domain) secrets. Safe
 * for concurrent use; construct via one of the factories below.
 */
export class SecretService {
  private readonly key: Buffer | undefined;

  private constructor(key: Buffer | undefined) {
    this.key = key;
  }

  /**
   * Go NewSecretService: nil/empty key → disabled (pass-through) service;
   * a present key must be exactly 32 bytes.
   */
  static create(key: Buffer | undefined): SecretService {
    if (key === undefined || key.length === 0) {
      return new SecretService(undefined);
    }
    if (key.length !== KEY_SIZE) {
      throw new Error(
        `encryption key must be exactly 32 bytes (256 bits): got ${key.length} bytes`,
      );
    }
    return new SecretService(key);
  }

  /**
   * Go NewSecretServiceFromEnv: key via the shared ladder (env var → key
   * file → auto-generate). Throws only on unusable explicit configuration;
   * the composition root maps that to the WARN-degrade posture.
   */
  static fromEnv(options: KeyLoaderOptions = {}): SecretService {
    const key = getOrCreateNamedKey(
      ENCRYPTION_KEY_ENV_VAR,
      ENCRYPTION_KEY_FILE_NAME,
      options,
    );
    return SecretService.create(key);
  }

  /** Go IsEnabled: whether a key is configured. */
  isEnabled(): boolean {
    return this.key !== undefined;
  }

  /**
   * Go IsEncrypted — dispatch on STORED values (decrypt, preserve,
   * re-encrypt). For CLIENT-SUPPLIED input at a request boundary use the
   * module-level isCiphertextShaped — same test, different intent.
   */
  isEncrypted(value: string): boolean {
    return isCiphertextShaped(value);
  }

  /**
   * Go Encrypt: enc:v1:<base64(nonce || ct || tag)>; disabled → plaintext
   * unchanged; already-prefixed input → unchanged.
   *
   * The idempotent pass-through TRUSTS its callers: it exists for
   * store-restored ciphertext (the ***REDACTED*** round-trip copies stored
   * values back into the new state before this runs), which must survive a
   * second pass unchanged. It is NOT a safe place to validate provenance —
   * only the request pipeline knows whether a prefixed value came from the
   * store or from a client. Client-supplied enc:v<N>: input is rejected at
   * every write boundary via isCiphertextShaped (oss#395); do not "fix"
   * smuggling here, it would break the marker round-trip.
   */
  encrypt(plaintext: string): string {
    if (this.key === undefined) {
      return plaintext;
    }
    if (this.isEncrypted(plaintext)) {
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
   * Go Decrypt: unprefixed values pass through (legacy plaintext
   * compatibility); prefixed values decrypt or fail with the taxonomy the
   * callers branch on (invalid-ciphertext / decryption-failed /
   * encryption-disabled).
   */
  decrypt(encrypted: string): string {
    if (!this.isEncrypted(encrypted)) {
      return encrypted;
    }
    if (this.key === undefined) {
      throw new EncryptionDisabledError();
    }

    // Go TrimPrefix semantics: only the LITERAL enc:v1: prefix is
    // stripped. A future-version value (enc:v2:…) is matched by
    // isEncrypted but keeps its prefix here, fails the strict Base64
    // check below, and surfaces as invalid ciphertext — exactly Go's
    // fail-closed handling of versions this build cannot decrypt.
    const base64Data = encrypted.startsWith(ENCRYPTED_PREFIX)
      ? encrypted.slice(ENCRYPTED_PREFIX.length)
      : encrypted;
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
