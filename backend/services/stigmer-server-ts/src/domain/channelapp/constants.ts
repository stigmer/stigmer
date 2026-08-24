/**
 * ChannelApp domain constants — the byte-pinned wire copy shared with the
 * Go server and the cloud edition. Every string here is asserted by the
 * conformance suite or the cross-edition error contract; none is editable
 * without an owner-ratified wire change.
 */

/**
 * The sentinel the response path substitutes for secret values before they
 * leave the server — Go channelapp RedactedMarker, equal to the
 * platform-wide marker (environment/oauthapp here, the cloud edition's
 * SecretEncryptionService.REDACTED_MARKER). A client sending it back on
 * update means "keep the stored secret".
 */
export const REDACTED_MARKER = "***REDACTED***";

/**
 * InvalidArgument copy for client-supplied enc:v<N>: input (oss#395) — Go
 * steps.go resolveSecret, byte-pinned. Unconditional: the prefix is
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
 * preserve) — Go steps.go preserveExistingSecret, byte-pinned.
 */
export function markerOnCreateMessage(fieldName: string): string {
  return `cannot use the redaction marker as ${fieldName} on create`;
}

/**
 * InvalidArgument copy for the marker on an update whose stored field is
 * empty — Go steps.go preserveExistingSecret, byte-pinned.
 */
export function noExistingSecretMessage(fieldName: string): string {
  return `cannot preserve ${fieldName}: no existing secret value found`;
}

/**
 * InvalidArgument copy for a provider-arm change on update — Go steps.go
 * validateProviderImmutableStep, byte-pinned. Deliberately a DIFFERENT
 * code than agentchannel's provider rule (InvalidArgument here vs
 * FailedPrecondition there) — a pinned cross-domain inconsistency both
 * editions share; harmonization is a post-cutover wire change.
 */
export const PROVIDER_IMMUTABLE_MESSAGE =
  "the provider of a channel app cannot be changed";

/**
 * FailedPrecondition copy for deleting a ChannelApp still referenced by an
 * AgentChannel — Go steps.go checkNoReferencingChannelsStep, byte-pinned.
 * Names the referencing channel by metadata.name (not slug), as Go does.
 */
export function deleteBlockedByChannelMessage(
  org: string,
  slug: string,
  channelName: string,
): string {
  return `cannot delete ChannelApp '${org}/${slug}': referenced by agent channel '${channelName}'`;
}
