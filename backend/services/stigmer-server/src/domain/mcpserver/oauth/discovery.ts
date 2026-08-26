/**
 * RFC 8414 authorization-server discovery — ports
 * pkg/domain/mcpserver/oauth/discovery.go. The well-known URI lives at the
 * URL ORIGIN (scheme + host), not under the server's path — a Linear-style
 * MCP URL like https://mcp.linear.app/mcp discovers at
 * https://mcp.linear.app/.well-known/oauth-authorization-server.
 * Proven by mcpserver-oauth.conformance.test.ts (CONFORMANCE_TARGET=local).
 */

/**
 * OAuth 2.0 Authorization Server Metadata discovered via RFC 8414
 * (Go AuthServerMetadata). Field names keep the RFC's snake_case on the
 * wire; this interface is the parsed camelCase view.
 */
export interface AuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopesSupported: string[];
  codeChallengeMethodsSupported: string[];
}

/** Go's discoveryHTTPClient 10s timeout — a named constant per guidelines. */
export const DISCOVERY_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Fetches the OAuth Authorization Server Metadata from the MCP server's
 * .well-known endpoint per RFC 8414 (Go DiscoverAuthorizationServer).
 * Throws with Go's message text on non-200, unparseable metadata, missing
 * endpoints, or an S256-less server — initiate embeds these messages in
 * its FailedPrecondition copy, so the text is contract.
 */
export async function discoverAuthorizationServer(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthServerMetadata> {
  const wellKnownUrl = buildWellKnownUrl(serverUrl);

  let response: Response;
  try {
    response = await fetchImpl(wellKnownUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `discovery request to ${wellKnownUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status !== 200) {
    // Drain the body so the connection can be reused; the status alone
    // classifies the failure.
    await response.text();
    throw new Error(
      `authorization server discovery failed: ${wellKnownUrl} returned HTTP ${response.status} (expected 200). ` +
        "This MCP server may not support the MCP Authorization specification",
    );
  }

  let raw: {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
    code_challenge_methods_supported?: string[];
  };
  try {
    raw = (await response.json()) as typeof raw;
  } catch (error) {
    throw new Error(
      `failed to parse authorization server metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const metadata: AuthServerMetadata = {
    issuer: raw.issuer ?? "",
    authorizationEndpoint: raw.authorization_endpoint ?? "",
    tokenEndpoint: raw.token_endpoint ?? "",
    registrationEndpoint: raw.registration_endpoint ?? "",
    scopesSupported: raw.scopes_supported ?? [],
    codeChallengeMethodsSupported: raw.code_challenge_methods_supported ?? [],
  };

  validateMetadata(metadata, wellKnownUrl);
  return metadata;
}

/**
 * Constructs the .well-known URL from the MCP server URL (Go
 * buildWellKnownURL). Per RFC 8414, the well-known URI is at the origin.
 */
export function buildWellKnownUrl(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch (error) {
    throw new Error(
      `invalid server URL for discovery: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(
      `invalid server URL for discovery: unsupported scheme "${scheme}": only http and https are supported`,
    );
  }
  if (parsed.host === "") {
    throw new Error("invalid server URL for discovery: server URL has no host");
  }

  const origin = `${scheme}://${parsed.host}`;
  return `${origin.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
}

function validateMetadata(m: AuthServerMetadata, sourceUrl: string): void {
  if (m.authorizationEndpoint === "") {
    throw new Error(
      `authorization server at ${sourceUrl} is missing authorization_endpoint`,
    );
  }
  if (m.tokenEndpoint === "") {
    throw new Error(
      `authorization server at ${sourceUrl} is missing token_endpoint`,
    );
  }
  if (
    m.codeChallengeMethodsSupported.length > 0 &&
    !m.codeChallengeMethodsSupported.includes("S256")
  ) {
    // Go renders the supported list with %v — space-separated in
    // brackets; matched exactly because initiate forwards this text.
    throw new Error(
      `authorization server at ${sourceUrl} does not support S256 PKCE (supports: [${m.codeChallengeMethodsSupported.join(" ")}]). ` +
        "S256 is required by the MCP Authorization specification",
    );
  }
}
