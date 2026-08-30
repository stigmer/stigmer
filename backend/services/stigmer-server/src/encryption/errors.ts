/**
 * The secret-encryption error taxonomy — two arms, mirroring the cloud
 * edition's SecretEncryptionService exception pair (EncryptionException →
 * InvalidCiphertext / EncryptionUnavailable), because "skip this one
 * value" is safe for exactly one of them:
 *
 *   - InvalidCiphertextError (and its wrong-key/tampered specialization
 *     DecryptionFailedError): the VALUE is bad — tampered, truncated,
 *     malformed Base64, or sealed under a different key. Retrying cannot
 *     help and the failure is scoped to that one value, so per-key skip
 *     policies (the environment/executioncontext resolution lanes) may
 *     drop it and continue.
 *
 *   - EncryptionUnavailableError (and its keyless specialization
 *     EncryptionDisabledError): the MACHINERY is missing — the value's
 *     version has no codec in this deployment, no key is configured, or a
 *     codec's external key provider is unreachable. The stored value may
 *     be perfectly valid, so skipping would silently drop a credential on
 *     a transient infrastructure failure; callers must let this arm
 *     propagate (the resolution lanes fail the request on it).
 *
 * The four concrete classes predate the arms (they are blessed exports the
 * commit-pin consumer catches); the arms were introduced by re-parenting
 * (20260830.04 Stage 1) so every existing `instanceof` keeps its meaning
 * and every `.name` and message byte stays exactly as shipped.
 */

/**
 * Go ErrInvalidCiphertext — the value itself is bad (bad base64, too
 * short, or — via the DecryptionFailedError subclass — wrong key or
 * tampered bytes). The value-scoped arm: per-key skip policies may skip
 * it and continue.
 */
export class InvalidCiphertextError extends Error {
  constructor(detail: string) {
    super(`invalid ciphertext format: ${detail}`);
    this.name = "InvalidCiphertextError";
  }
}

/**
 * Go ErrDecryptionFailed — wrong key or tampered data. A specialization
 * of InvalidCiphertextError (the cloud edition folds this case into
 * InvalidCiphertext outright): the failure is still scoped to the one
 * value, so it rides the value-scoped arm.
 */
export class DecryptionFailedError extends InvalidCiphertextError {
  constructor(cause: unknown) {
    super("wrong key or tampered data");
    // This class shipped before the taxonomy fold, so its copy does not
    // carry the parent's "invalid ciphertext format:" prefix — preserved
    // byte-for-byte (the message reaches logs at the resolution lanes).
    this.message = "decryption failed - wrong key or tampered data";
    this.name = "DecryptionFailedError";
    this.cause = cause;
  }
}

/**
 * The machinery needed to process an otherwise-plausible value is
 * unavailable: the value carries a format version this deployment has no
 * codec for, or a codec's key machinery cannot be reached. The stored
 * value may be perfectly valid — treating this like InvalidCiphertextError
 * and skipping would silently drop a credential, so callers must let it
 * propagate. Ports the cloud edition's EncryptionUnavailableException.
 */
export class EncryptionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionUnavailableError";
  }
}

/**
 * Go ErrEncryptionDisabled — decrypting a prefixed value with no key
 * configured. A specialization of EncryptionUnavailableError: keyless is
 * one instance of "machinery missing" (the stored ciphertext may be
 * perfectly valid — e.g. the key file was lost), so it rides the
 * infrastructure arm the resolution lanes propagate.
 */
export class EncryptionDisabledError extends EncryptionUnavailableError {
  constructor() {
    super("encryption is not enabled - no key configured");
    this.name = "EncryptionDisabledError";
  }
}
