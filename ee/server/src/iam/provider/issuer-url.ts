/**
 * Canonical issuer URLs. OIDC providers spell their `iss` inconsistently (Auth0 ends in a
 * slash, `https://tenant.us.auth0.com/`; Okta and Cognito do not,
 * `https://acme.okta.com/oauth2/default`), so every issuer comparison in
 * the IdentityProvider domain runs through this one function first:
 *
 *   - WRITE time: the IdP command handlers canonicalize
 *     `spec.allowed_issuers` before the uniqueness check and the store's
 *     side-table rewrite, so equivalent spellings collide.
 *   - LOOKUP time: the federated verifier canonicalizes both the stored
 *     values as it builds its issuer map and the incoming token's `iss`
 *     before the lookup, so a trailing slash on either side never leaves
 *     a login unclaimed; normalizing only at write time left every login
 *     on an Auth0-backed IdP unclaimed.
 *
 * The rules are RFC 3986 §6.2.2 syntax-based normalization: trim, strip
 * trailing slashes, lowercase scheme and host, drop the scheme's default
 * port, keep the path. Anything `URL` cannot parse comes back trimmed and
 * slash-stripped, so a malformed value fails its
 * own validation downstream instead of throwing here.
 */

/** Canonicalize one issuer URL; `""` in, `""` out. */
export function normalizeIssuerUrl(issuer: string): string {
  let trimmed = issuer.trim();
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  try {
    const uri = new URL(trimmed);
    const scheme = uri.protocol.replace(/:$/, "").toLowerCase();
    const defaultPort = scheme === "https" ? "443" : "80";
    const portSuffix =
      uri.port !== "" && uri.port !== defaultPort ? `:${uri.port}` : "";
    return `${scheme}://${uri.hostname.toLowerCase()}${portSuffix}${uri.pathname === "/" ? "" : uri.pathname}`;
  } catch {
    return trimmed;
  }
}
