/**
 * Environment domain constants — the byte-pinned wire copy and label
 * contract shared with the Go server and the cloud edition. Every string
 * here is asserted by clients, the conformance suite, or the cross-edition
 * error contract; none is editable without an owner-ratified wire change.
 */

/**
 * The sentinel replacing every non-empty is_secret value at every
 * Environment-returning boundary — Go steps.RedactedMarker, pinned by the
 * conformance suite and mirrored by the cloud edition. A client sending it
 * BACK on a write means "keep the existing secret" (the round-trip
 * contract; see preserveRedactedSecrets). The definition moved to the
 * encryption facade with the codec seam (20260830.04 Stage 1 — reencrypt
 * refuses the marker, and domain → encryption is the dependency
 * direction); re-exported here for the historical importers, byte
 * unchanged.
 */
export { REDACTED_MARKER } from "../../encryption/encryption.js";

/** Label marking a user's personal environment — Go personalLabelKey. */
export const PERSONAL_LABEL_KEY = "stigmer.ai/personal";
export const PERSONAL_LABEL_VALUE = "true";

/** Label marking a system-created OAuth-token holder — Go managedLabelKey. */
export const MANAGED_LABEL_KEY = "stigmer.ai/managed";
export const MANAGED_LABEL_VALUE = "true";

/**
 * InvalidArgument copy for a redaction marker with nothing to preserve
 * (create, or an update key that had no prior secret) — Go
 * preserve_redacted_secrets.go, byte-pinned.
 */
export function markerRejectionMessage(key: string): string {
  return `variable '${key}': cannot use the redaction marker as a secret value`;
}

/**
 * InvalidArgument copy for client-supplied enc:v<N>: input (oss#395) — Go
 * preserve_redacted_secrets.go / merge_variables_and_persist.go, byte-pinned.
 */
export function forgedCiphertextMessage(key: string): string {
  return (
    `variable '${key}' must be plaintext — values carrying the 'enc:' ` +
    "encryption prefix are not accepted from clients"
  );
}

/**
 * AlreadyExists copy for a second personal environment in an org — Go
 * enforce_personal_uniqueness.go, byte-pinned (regression guard for
 * stigmer#193 in the conformance suite).
 */
export function personalEnvironmentExistsMessage(existingId: string): string {
  return `a personal environment already exists for this organization: ${existingId}`;
}

/**
 * FailedPrecondition reasons for share-restricted environments — Go
 * share_restricted.go, byte-pinned; both editions enforce identically.
 */
export const PERSONAL_SHARE_RESTRICTION =
  "personal environments cannot be shared with the organization - " +
  "create a dedicated environment with only the credentials the agent needs";
export const MANAGED_SHARE_RESTRICTION =
  "OAuth-managed environments cannot be shared with the organization - " +
  "OAuth tokens are per-user credentials";
