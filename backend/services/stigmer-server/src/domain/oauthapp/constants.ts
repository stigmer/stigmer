/**
 * OAuthApp domain constants — byte-pinned wire copy (the redaction marker
 * and the secret contract's error messages). These strings are cross-edition API surface:
 * the CLI, console, and SDK show them verbatim, and the conformance suite
 * asserts codes against them — never reword.
 */

/**
 * The sentinel the response path substitutes for client_secret before it
 * leaves the server. A client sending this value back
 * on update/apply means "keep the existing secret" — not "store the
 * literal marker". Deliberately domain-local:
 * the encryption module's redaction marker is a separate constant with the
 * same text, and collapsing them would couple two domains' wire contracts.
 */
export const REDACTED_MARKER = "***REDACTED***";

/** The redaction marker on create has no existing secret to preserve. */
export const MARKER_ON_CREATE_MESSAGE =
  "cannot use the redaction marker as client_secret on create";

/** The marker sent on update but the stored resource has no secret. */
export const PRESERVE_NO_EXISTING_SECRET_MESSAGE =
  "cannot preserve client_secret: no existing secret value found";

/**
 * A client-supplied enc:v<N>:-shaped value is refused on every write
 * door (oss#395) — the prefix is server-reserved, so a prefixed request
 * value is either forged ciphertext or an attempt to pin stale ciphertext.
 */
export const CIPHERTEXT_SHAPED_SECRET_MESSAGE =
  "client_secret must be plaintext — values carrying the 'enc:' " +
  "encryption prefix are not accepted from clients";
