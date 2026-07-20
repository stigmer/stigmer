// The server-side secret-redaction contract, mirrored for client UX.

/**
 * Sentinel the server substitutes for secret values before they leave the
 * backend (Cloud environment reads, ChannelApp/OAuthApp reads on both
 * editions). Sending the marker back in an `apply` means "keep the stored
 * secret" — the update pipelines restore the existing encrypted value.
 */
export const REDACTED_SECRET_MARKER = "***REDACTED***";

/**
 * Whether manifest content contains redacted secret values.
 *
 * Used by editing UIs to explain the marker to users ("redacted secrets
 * keep their stored values when applied") instead of letting it read like
 * a bug.
 */
export function containsRedactedSecrets(content: string): boolean {
  return content.includes(REDACTED_SECRET_MARKER);
}
