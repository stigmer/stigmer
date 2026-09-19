/**
 * The OAuth-challenge rule: what a `WWW-Authenticate` header must say for
 * Stigmer to tell a user "this server requires OAuth".
 *
 * One home for a rule three processes apply. The runner applies it at the
 * first failed tool call (shared/mcp-oauth-detect.ts, where the rule was
 * born); the control plane applies it at save time so a URL-only server
 * gets its Sign in button before anyone runs it; the catalogue audit applies
 * it to decide what the official catalogue may promise. A rule with one copy
 * per process would let the storefront call OAuth what the runner calls a
 * bad token.
 *
 * The rule, per the MCP Authorization specification and RFC 9728: the
 * scheme is `Bearer`, and the challenge names either an OAuth realm or a
 * `resource_metadata` pointer. A plain `Bearer` 401 (an invalid static API
 * key) is not an OAuth requirement and must not be read as one, or a user
 * with a mistyped token would be sent to a Sign in that does not exist.
 *
 * Proven by __tests__/challenge.test.ts, the runner's cases moved here.
 */

/** Whether a `WWW-Authenticate` value is an OAuth challenge. */
export function isOAuthChallenge(wwwAuthenticate: string): boolean {
  const value = wwwAuthenticate.toLowerCase();
  if (!value.includes("bearer")) return false;
  return value.includes("oauth") || value.includes("resource_metadata");
}

/** The `resource_metadata` URL a challenge points at (RFC 9728 section 5.1), if any. */
export function parseResourceMetadataUrl(wwwAuthenticate: string): string | undefined {
  const match = /resource_metadata="([^"]+)"/i.exec(wwwAuthenticate);
  return match?.[1];
}
