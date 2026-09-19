/**
 * OAuth-challenge classification for HTTP MCP endpoints.
 *
 * When an HTTP MCP endpoint requires OAuth (per the MCP Authorization spec /
 * RFC 9728), an unauthenticated or statically-tokened request is answered with
 * `401` and a `WWW-Authenticate: Bearer ...` header pointing at OAuth protected
 * resource metadata. The MCP client SDK surfaces this only as an opaque
 * aggregate error ("unhandled errors in a TaskGroup"), which tells the user
 * nothing.
 *
 * This module turns that opaque failure into a precise, actionable signal: it
 * re-probes the endpoint once (only on the failure path, so the happy path pays
 * nothing) and, if it sees an OAuth challenge, returns an {@link
 * OAuthRequiredError} whose message tells the user to connect via OAuth instead
 * of a manual token.
 *
 * The rule and the request have one home, `@stigmer/outbound/mcp-oauth`,
 * shared with the control plane (which asks the same question of a URL-only
 * server at save time, so the Sign in button exists before the first run)
 * and the catalogue audit. The request is the complete `initialize`
 * (protocol version, capabilities, client info): several hosted servers
 * validate the request before they check authentication and answer a bare
 * one with HTTP 200 and a JSON-RPC error, so the bare request this module
 * once sent never reached their 401 (stigmer #1188). What stays here is the
 * runner's own: its deadline, its name in the handshake, and the sentence
 * the user reads.
 */
import { probeEndpointAuth } from "@stigmer/outbound/mcp-oauth";

export { isOAuthChallenge, parseResourceMetadataUrl } from "@stigmer/outbound/mcp-oauth";

/** The failure path can afford a patient probe; a save cannot, and uses its own. */
const OAUTH_PROBE_TIMEOUT_MS = 10_000;

/** How the runner names itself in the handshake's `clientInfo`. */
const PROBE_CLIENT_NAME = "stigmer-runner";

/**
 * Raised when an HTTP MCP endpoint answers with an OAuth authentication
 * challenge. The message is self-contained and user-facing: it survives the
 * Temporal boundary and is shown by the connect error wrappers verbatim.
 *
 * The literal phrase "requires OAuth" is a stable marker the Go/Java connect
 * wrappers match to avoid appending a generic "check your credentials" suffix.
 */
export class OAuthRequiredError extends Error {
  constructor(
    public readonly serverSlug: string,
    public readonly resourceMetadataUrl?: string,
  ) {
    super(
      `MCP server '${serverSlug}' requires OAuth: its endpoint returned an ` +
        `authentication challenge (HTTP 401). A manually-entered API token will ` +
        `not work here — connect it with the OAuth "Sign in" flow instead.`,
    );
    this.name = "OAuthRequiredError";
  }
}

/**
 * Probe an HTTP MCP endpoint once to decide whether its failure is an OAuth
 * challenge. Returns an {@link OAuthRequiredError} to throw, or `null` when the
 * endpoint is not asking for OAuth (so the caller rethrows the original error).
 *
 * Never throws: any probe/network failure returns `null` so this classification
 * step can never mask or replace the original discovery error.
 */
export async function detectOAuthChallenge(
  url: string,
  headers: Record<string, string> | undefined,
  slug: string,
): Promise<OAuthRequiredError | null> {
  const outcome = await probeEndpointAuth(url, headers, {
    fetchImpl: fetch,
    timeoutMs: OAUTH_PROBE_TIMEOUT_MS,
    clientName: PROBE_CLIENT_NAME,
  });
  if (outcome.kind !== "oauth") return null;
  return new OAuthRequiredError(slug, outcome.resourceMetadataUrl);
}
