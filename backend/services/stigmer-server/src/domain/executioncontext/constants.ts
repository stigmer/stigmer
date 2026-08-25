/**
 * ExecutionContext domain constants — the byte-pinned wire copy shared
 * with the Go server. Every string here reaches clients verbatim (the
 * conformance suite and the runner's error surfaces read them), so none
 * is editable without an owner-ratified wire change.
 *
 * The redaction marker itself is NOT defined here: it is imported from
 * the environment domain's constants (the single source of truth both Go
 * domains share — Go's redact_secret_values.go imports
 * envsteps.RedactedMarker the same way).
 */

/**
 * InvalidArgument copy for client-supplied enc:v<N>: input — Go
 * encrypt_secret_values.go's rejectCiphertextShapedStep, byte-pinned.
 * Note the copy differs from the environment domain's forged-ciphertext
 * message: each domain pins its own Go string.
 */
export function ciphertextShapedMessage(key: string): string {
  return (
    `value for '${key}' looks like stored ciphertext (enc:v<N>: prefix); ` +
    "supply the plaintext value"
  );
}

/**
 * Internal copy for an encrypt failure at write — Go
 * encrypt_secret_values.go (no "variable" wording, unlike environment).
 */
export function encryptFailureMessage(key: string): string {
  return `failed to encrypt secret value for '${key}'`;
}

/**
 * Internal copy for the fail-loud decrypt arm: the row holds ciphertext
 * but the server has no key (key file lost). Dropping the value would
 * start the execution silently missing a credential — a confusing
 * downstream failure instead of a clear one here (the oss#405 doctrine).
 * Go resolve_values_for_caller.go, byte-pinned.
 */
export function encryptionKeyMissingMessage(
  executionId: string,
  key: string,
): string {
  return (
    `execution context for ${executionId} holds encrypted secret '${key}' ` +
    "but no encryption key is configured"
  );
}
