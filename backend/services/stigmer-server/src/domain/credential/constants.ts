/**
 * Credential domain constants — the wire copy the credential surfaces
 * answer with. Every string here is a client-visible refusal or a
 * contract a client sends back (the redaction marker); a change is a
 * deliberate wire change, pinned by the domain's tests and the
 * conformance suite.
 */

/**
 * The sentinel replacing every non-empty secret field value at every
 * Credential-returning boundary. A client sending it BACK on a write means
 * "keep the stored secret" (the round-trip contract; see
 * newPreserveRedactedSecretsStep). Defined once in the encryption facade,
 * which also refuses to seal it.
 */
export { REDACTED_MARKER } from "../../encryption/encryption.js";

/** InvalidArgument copy for a redaction marker with nothing to keep. */
export function markerRejectionMessage(field: string): string {
  return `field '${field}': cannot use the redaction marker as a secret value`;
}

/** InvalidArgument copy for client-supplied ciphertext-shaped input. */
export function forgedCiphertextMessage(field: string): string {
  return (
    `field '${field}' must be plaintext — values carrying the 'enc:' ` +
    "encryption prefix are not accepted from clients"
  );
}

/** PermissionDenied copy for a person's credential created for someone else. */
export const PERSON_IS_NOT_CALLER =
  "a person's credential can only be created by that person";

/** InvalidArgument copy for an organization owner that is not the credential's own organization. */
export const ORG_IS_NOT_METADATA_ORG =
  "an organization's credential must belong to its own organization (spec.org must equal metadata.org)";

/** FailedPrecondition copy for an update that would change who a credential belongs to. */
export const OWNER_IS_FIXED =
  "a credential's owner is fixed when it is created; create a new credential instead";

/** FailedPrecondition copy for a hand edit of a sign-in's values. */
export const SIGN_IN_FIELDS_ARE_THE_PLATFORMS =
  "this credential holds an MCP server sign-in; its values are kept fresh by the platform and cannot be set or removed by hand — sign out and sign in again instead";

/** FailedPrecondition copy for a reveal of an organization's credential. */
export const ORG_CREDENTIAL_IS_WRITE_ONLY =
  "an organization's credential is write-only: its values can be replaced, never read back";

/**
 * AlreadyExists copy for a second credential of one owner serving one
 * target: a run's default for a target must never be a choice between two.
 */
export function servesTakenMessage(target: string, existingSlug: string): string {
  return `${target} is already served by credential '${existingSlug}' of the same owner; a target takes at most one default per owner — remove it from that credential first`;
}
