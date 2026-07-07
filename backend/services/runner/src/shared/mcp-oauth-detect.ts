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
 * Kept transport-library-agnostic (uses global `fetch`) so it is reusable by
 * connect-time discovery, execution-time error enrichment, and any other caller
 * that holds an MCP endpoint URL + headers.
 */

const OAUTH_PROBE_TIMEOUT_MS = 10_000;

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
 * Whether a `WWW-Authenticate` header value is an OAuth challenge.
 *
 * The MCP auth spec emits `Bearer realm="OAuth", resource_metadata="..."`. We
 * require the `Bearer` scheme plus either an OAuth realm or a resource-metadata
 * pointer, so a plain `Bearer` 401 from a static-token API (an invalid key, not
 * an OAuth requirement) is not misclassified.
 */
export function isOAuthChallenge(wwwAuthenticate: string): boolean {
  const value = wwwAuthenticate.toLowerCase();
  if (!value.includes("bearer")) return false;
  return value.includes("oauth") || value.includes("resource_metadata");
}

/** Extract the `resource_metadata` URL from a `WWW-Authenticate` value, if present. */
export function parseResourceMetadataUrl(
  wwwAuthenticate: string,
): string | undefined {
  const match = /resource_metadata="([^"]+)"/i.exec(wwwAuthenticate);
  return match?.[1];
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
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(headers ?? {}),
      },
      // A minimal MCP initialize request — enough to trigger the endpoint's
      // auth check without establishing a session.
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
      signal: AbortSignal.timeout(OAUTH_PROBE_TIMEOUT_MS),
    });

    if (response.status !== 401) return null;

    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
    if (!isOAuthChallenge(wwwAuthenticate)) return null;

    return new OAuthRequiredError(
      slug,
      parseResourceMetadataUrl(wwwAuthenticate),
    );
  } catch {
    return null;
  }
}
