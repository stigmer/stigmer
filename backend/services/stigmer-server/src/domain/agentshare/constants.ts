/**
 * AgentShare domain constants — the byte-pinned wire copy shared with the
 * Go server and the cloud edition. Every string here is asserted by the
 * conformance suite or the cross-edition error contract; none is editable
 * without an owner-ratified wire change.
 */

/**
 * Entropy behind a rotated link: 20 bytes → 27 url-safe base64 characters
 * — Go shareLinkTokenBytes. Comfortably beyond guessability for a
 * rate-limited public endpoint while keeping the share URL short.
 */
export const SHARE_LINK_TOKEN_BYTES = 20;

/**
 * InvalidArgument copy when metadata.org is absent — Go
 * resolveShareDefaultsStep, byte-pinned. The share's org appears in the
 * hosted chat URL and is the billing org, so it can never be inferred.
 */
export const ORG_REQUIRED_MESSAGE =
  "metadata.org is required for an agent share";

/** InvalidArgument copy when spec.agent_ref.slug is absent — Go, pinned. */
export const AGENT_REF_SLUG_REQUIRED_MESSAGE =
  "spec.agent_ref.slug is required";

/**
 * InvalidArgument copy for BOTH profile lanes when org is absent — Go
 * loadShareForProfileStep / loadShareForMemberProfileStep, byte-pinned.
 * Anti-enumeration: an empty org would mean "match slug across all orgs"
 * on a public endpoint.
 */
export const ORG_REQUIRED_FOR_LOOKUP_MESSAGE =
  "org is required for shared agent lookup";

/**
 * FailedPrecondition copy when spec.agent_ref names another organization's
 * agent — the schedule's and the channel's same-organization sentence in
 * the share's own words. A share offers an agent its own organization
 * owns; to share another organization's agent, install the plugin that
 * carries it and share the installed copy.
 */
export function sameOrgInvariantMessage(refOrg: string): string {
  return (
    "spec.agent_ref.org must match metadata.org — a share must live in " +
    `the referenced agent's organization (${refOrg})`
  );
}

/**
 * FailedPrecondition copy for an agent_ref change on update — Go
 * validateShareUpdateStep, byte-pinned. A share is a channel FOR one
 * agent; re-pointing it would silently move guest traffic (and billing).
 */
export function agentRefImmutableMessage(org: string, slug: string): string {
  return (
    `spec.agent_ref is immutable (share references ${org}/${slug}) — ` +
    "create a new share to distribute a different agent"
  );
}
