/**
 * ChannelApp domain constants — the byte-pinned wire copy every edition
 * shares. Every string here is asserted by the
 * conformance suite or the cross-edition error contract; none is editable
 * without an deliberate wire change.
 */

/**
 * The sentinel the response path substitutes for secret values before they
 * leave the server, equal to the platform-wide marker (oauthapp, the
 * session's own values, encryption.ts REDACTED_MARKER). A client sending it back on
 * update means "keep the stored secret".
 */
export const REDACTED_MARKER = "***REDACTED***";

/**
 * InvalidArgument copy for client-supplied enc:v<N>: input (oss#395),
 * byte-pinned. Unconditional: the prefix is
 * server-reserved regardless of key state.
 */
export function plaintextRequiredMessage(fieldName: string): string {
  return (
    `${fieldName} must be plaintext — values carrying the 'enc:' ` +
    "encryption prefix are not accepted from clients"
  );
}

/**
 * InvalidArgument copy for the redaction marker on create (nothing to
 * preserve), byte-pinned.
 */
export function markerOnCreateMessage(fieldName: string): string {
  return `cannot use the redaction marker as ${fieldName} on create`;
}

/**
 * InvalidArgument copy for the marker on an update whose stored field is
 * empty, byte-pinned.
 */
export function noExistingSecretMessage(fieldName: string): string {
  return `cannot preserve ${fieldName}: no existing secret value found`;
}

/**
 * InvalidArgument copy for a provider-arm change on update, byte-pinned.
 * Deliberately a DIFFERENT code than the channel's type rule
 * (InvalidArgument here vs FailedPrecondition there) — a pinned
 * cross-domain inconsistency both editions share; harmonizing them is a
 * wire change.
 */
export const PROVIDER_IMMUTABLE_MESSAGE =
  "the provider of a channel app cannot be changed";

/**
 * FailedPrecondition copy for deleting a ChannelApp still referenced by a
 * Slack or WhatsApp channel. Names the referencing channel by
 * metadata.name (not slug).
 */
export function deleteBlockedByChannelMessage(
  org: string,
  slug: string,
  channelName: string,
): string {
  return `cannot delete ChannelApp '${org}/${slug}': referenced by channel '${channelName}'`;
}
