/**
 * Authorization-server discovery for a sign-in at a tool's address with no
 * login app: finding the login server that protects the address, and
 * validating what it says.
 *
 * `discoverForResource(address)` reads the address itself. Its login
 * server is found by the RFC 9728 walk in
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
 *     login server on another origin; only the walk reaches them. A
 *     protected-resource document that names another resource is
 *     discarded (RFC 9728 section 3.3), so the walk then falls back to the
 *     address's own origin.
 *
 * It answers the login server's `AuthServerMetadata` (the Go
 * AuthServerMetadata's parsed camelCase view), held to its rules: the
 * document names the issuer it was read for (RFC 8414 section 3.3, checked
 * by the reader, so registrations kept per issuer are kept under a name the
 * document could not choose), both endpoints are present, every endpoint is
 * https or loopback http (endpoint.ts), and S256 is offered when methods
 * are listed. It also answers the
 * scopes the address's own document lists, which a sign-in asks for ahead
 * of the login server's. The error copy is contract: the sign-in embeds it
 * in its refusal, the conformance suite pins it, and the failure names the
 * FIRST document the walk tried (for a bare issuer, the RFC 8414 document at
 * its origin, the one the retired reader named) with its status or its
 * network error.
 * Proven by __tests__/discovery.test.ts and
 * plugin-oauth.conformance.test.ts (CONFORMANCE_TARGET=local).
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";
import {
  authorizationServerMetadataUrls,
  readAuthorizationServerMetadata,
  resolveAuthorizationServers,
  type AuthorizationServerMetadata,
  type MetadataAttempt,
} from "@stigmer/outbound/mcp-oauth";

import { loginEndpointProblem } from "./endpoint.js";

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
  /** Whether the login server takes a Client ID Metadata Document URL as a client id. */
  clientIdMetadataDocumentSupported: boolean;
}

/** A tool address's login server, and the scopes the address itself lists. */
export interface DiscoveredLoginServer {
  readonly metadata: AuthServerMetadata;
  /** `scopes_supported` from the address's protected-resource document; empty when it lists none. */
  readonly resourceScopes: readonly string[];
}

/** Go's discoveryHTTPClient 10s timeout — a named constant per guidelines; per document read. */
export const DISCOVERY_REQUEST_TIMEOUT_MS = 10_000;

/** The login server protecting a tool's address, by the RFC 9728 walk with the origin as the last resort. */
export async function discoverForResource(address: string, fetchImpl: OutboundFetch): Promise<DiscoveredLoginServer> {
  const resource = parseDiscoveryUrl(address);
  const deps = { fetchImpl, timeoutMs: DISCOVERY_REQUEST_TIMEOUT_MS };
  const resolved = await resolveAuthorizationServers(resource.href, undefined, deps);
  const issuers = resolved.issuers.length > 0 ? resolved.issuers : [resource.origin];
  return { metadata: await readIssuers(issuers, deps), resourceScopes: resolved.scopesSupported };
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
    clientIdMetadataDocumentSupported: m.clientIdMetadataDocumentSupported,
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
  if (attempt?.missing === "issuer") {
    return new Error(`authorization server at ${attempt.url} does not name ${firstIssuer} as its issuer`);
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
  for (const [field, value] of [
    ["authorization_endpoint", m.authorizationEndpoint],
    ["token_endpoint", m.tokenEndpoint],
    ["registration_endpoint", m.registrationEndpoint],
  ] as const) {
    const problem = value === "" ? undefined : loginEndpointProblem(value);
    if (problem !== undefined) {
      throw new Error(`authorization server at ${sourceUrl}: its ${field} ${problem}`);
    }
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
