/**
 * Authorization-server discovery for the DCR arm of Sign in: finding the
 * login server that protects an MCP endpoint, and validating what it says.
 *
 * Two entry points, because the spec gives Sign in two kinds of URL:
 *
 *   - `discoverForResource(mcpUrl)`: the MCP endpoint itself (`http.url`).
 *     Its login server is found by the RFC 9728 walk in
 *     `@stigmer/outbound/mcp-oauth`: the protected-resource document at the
 *     endpoint (path-suffixed, then bare) names `authorization_servers`;
 *     each issuer's metadata is read by RFC 8414 with the issuer's path
 *     inserted, then at its origin, then OpenID's document. When no
 *     protected-resource document exists the endpoint's origin is the one
 *     issuer to try, which is exactly what this module did before the walk
 *     (a Linear-style https://mcp.linear.app/mcp read
 *     https://mcp.linear.app/.well-known/oauth-authorization-server), so
 *     no server that signed in before signs in less now. Of the 41
 *     OAuth-protected servers the catalogue audit resolved, 21 keep their
 *     login server on another origin; only the walk reaches them.
 *   - `discoverAtIssuer(issuerUrl)`: the author's `auth.discovery_url`, an
 *     override naming the login server. It is read as an issuer: RFC 8414
 *     with its path, then its origin, then OpenID's.
 *
 * Both return the same `AuthServerMetadata` (the Go AuthServerMetadata's
 * parsed camelCase view) and hold the login server to the same rules:
 * both endpoints present, and S256 offered when methods are listed. The
 * error copy is contract: initiate embeds it in its FailedPrecondition, the
 * conformance suite pins it, and the failure names the FIRST document the
 * walk tried (for a bare issuer, the RFC 8414 document at its origin, the
 * one the retired reader named) with its status or its network error.
 * Proven by __tests__/discovery.test.ts and
 * mcpserver-oauth.conformance.test.ts (CONFORMANCE_TARGET=local).
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";
import {
  authorizationServerMetadataUrls,
  readAuthorizationServerMetadata,
  resolveAuthorizationServers,
  type AuthorizationServerMetadata,
  type MetadataAttempt,
} from "@stigmer/outbound/mcp-oauth";

/**
 * OAuth 2.0 Authorization Server Metadata (Go AuthServerMetadata). Field
 * names keep the RFC's snake_case on the wire; this interface is the parsed
 * camelCase view.
 */
export interface AuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopesSupported: string[];
  codeChallengeMethodsSupported: string[];
}

/** Go's discoveryHTTPClient 10s timeout — a named constant per guidelines; per document read. */
export const DISCOVERY_REQUEST_TIMEOUT_MS = 10_000;

/** The login server protecting an MCP endpoint, by the RFC 9728 walk with the origin as the last resort. */
export async function discoverForResource(mcpUrl: string, fetchImpl: OutboundFetch): Promise<AuthServerMetadata> {
  const resource = parseDiscoveryUrl(mcpUrl);
  const deps = { fetchImpl, timeoutMs: DISCOVERY_REQUEST_TIMEOUT_MS };
  const resolved = await resolveAuthorizationServers(resource.href, undefined, deps);
  const issuers = resolved.issuers.length > 0 ? resolved.issuers : [resource.origin];
  return readIssuers(issuers, deps);
}

/** The login server an author named in `auth.discovery_url`, read as an issuer. */
export async function discoverAtIssuer(issuerUrl: string, fetchImpl: OutboundFetch): Promise<AuthServerMetadata> {
  const issuer = parseDiscoveryUrl(issuerUrl);
  return readIssuers([issuer.href], { fetchImpl, timeoutMs: DISCOVERY_REQUEST_TIMEOUT_MS });
}

/**
 * The document the retired reader named, kept so a failure names a URL the
 * suites and the operators already know: RFC 8414 at the issuer's origin.
 * Exported for the tests that pin the shape.
 */
export function buildWellKnownUrl(serverUrl: string): string {
  const parsed = parseDiscoveryUrl(serverUrl);
  return `${parsed.origin}/.well-known/oauth-authorization-server`;
}

async function readIssuers(issuers: readonly string[], deps: { fetchImpl: OutboundFetch; timeoutMs: number }): Promise<AuthServerMetadata> {
  const attempts: MetadataAttempt[] = [];
  for (const issuer of issuers) {
    const read = await readAuthorizationServerMetadata(issuer, deps);
    attempts.push(...read.attempts);
    if (read.kind === "found") {
      const metadata = toAuthServerMetadata(read.metadata);
      validateMetadata(metadata, read.metadata.metadataUrl);
      return metadata;
    }
  }
  throw discoveryFailure(issuers, attempts);
}

function toAuthServerMetadata(m: AuthorizationServerMetadata): AuthServerMetadata {
  return {
    issuer: m.issuer,
    authorizationEndpoint: m.authorizationEndpoint,
    tokenEndpoint: m.tokenEndpoint,
    registrationEndpoint: m.registrationEndpoint,
    scopesSupported: [...m.scopesSupported],
    codeChallengeMethodsSupported: [...m.codeChallengeMethodsSupported],
  };
}

/**
 * The failure names the first document tried for the first issuer: for a
 * bare issuer that is RFC 8414 at its origin, the URL the retired reader
 * named, so the pinned copy reads as it always did.
 */
function discoveryFailure(issuers: readonly string[], attempts: readonly MetadataAttempt[]): Error {
  const firstIssuer = issuers[0] ?? "";
  const named = firstDocumentFor(firstIssuer);
  const attempt = attempts.find((a) => a.url === named) ?? attempts[0];
  if (attempt?.error !== undefined) {
    return new Error(`discovery request to ${attempt.url} failed: ${attempt.error}`);
  }
  if (attempt?.missing !== undefined) {
    return new Error(`authorization server at ${attempt.url} is missing ${attempt.missing}`);
  }
  const status = attempt?.status ?? 0;
  return new Error(
    `authorization server discovery failed: ${named} returned HTTP ${status} (expected 200). ` +
      "This MCP server may not support the MCP Authorization specification",
  );
}

function firstDocumentFor(issuer: string): string {
  try {
    return authorizationServerMetadataUrls(new URL(issuer))[0] ?? issuer;
  } catch {
    return issuer;
  }
}

/** Parse and screen a discovery URL; the copy is the Go buildWellKnownURL's, embedded by initiate. */
function parseDiscoveryUrl(serverUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch (error) {
    throw new Error(`invalid server URL for discovery: ${error instanceof Error ? error.message : String(error)}`);
  }
  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(`invalid server URL for discovery: unsupported scheme "${scheme}": only http and https are supported`);
  }
  if (parsed.host === "") {
    throw new Error("invalid server URL for discovery: server URL has no host");
  }
  return parsed;
}

function validateMetadata(m: AuthServerMetadata, sourceUrl: string): void {
  if (m.authorizationEndpoint === "") {
    throw new Error(`authorization server at ${sourceUrl} is missing authorization_endpoint`);
  }
  if (m.tokenEndpoint === "") {
    throw new Error(`authorization server at ${sourceUrl} is missing token_endpoint`);
  }
  if (m.codeChallengeMethodsSupported.length > 0 && !m.codeChallengeMethodsSupported.includes("S256")) {
    // Go renders the supported list with %v — space-separated in
    // brackets; matched exactly because initiate forwards this text.
    throw new Error(
      `authorization server at ${sourceUrl} does not support S256 PKCE (supports: [${m.codeChallengeMethodsSupported.join(" ")}]). ` +
        "S256 is required by the MCP Authorization specification",
    );
  }
}
