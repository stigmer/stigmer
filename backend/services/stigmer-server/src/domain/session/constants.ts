/**
 * Session byte-pinned wire copy — every string a client can observe from
 * this domain that is not already a proto annotation's error_msg. Wire
 * once merged: the conformance run-gate suite asserts these characters.
 */

/**
 * The run gate's deny copy when a session names, or changes to, an agent
 * the caller may not run. Quotes the handle single-quoted (the quoting rule
 * since 2026-08-26). Identical to the agent-execution domain's agent copy
 * on purpose — one fact, one sentence — the ENGINE_UNAVAILABLE_MESSAGE
 * precedent for cross-domain twins: each domain owns its constant, the twin
 * is named here.
 */
export function runAgentDeniedMessage(agentId: string): string {
  return `unauthorized to run agent '${agentId}'`;
}

/**
 * ResolveSessionAgent's refusal when the reference names a version the
 * agent does not hold: no tag and no content hash by that name. Names the
 * reference as written.
 */
export function agentVersionNotFoundMessage(
  org: string,
  slug: string,
  version: string,
): string {
  return `referenced agent '${org}/${slug}' has no version '${version}'; name one of its tags or content hashes, or 'latest' for its current version.`;
}

/**
 * ResolveSessionAgent's refusal when the agent the reference rule found
 * has gone before its version could be read (deleted by another write
 * between the two reads).
 */
export function agentGoneMessage(org: string, slug: string): string {
  return `referenced agent '${org}/${slug}' no longer exists.`;
}
