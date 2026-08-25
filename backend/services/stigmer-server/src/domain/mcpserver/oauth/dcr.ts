/**
 * RFC 7591 Dynamic Client Registration — ports
 * pkg/domain/mcpserver/oauth/dcr.go. Registers a PUBLIC client
 * (token_endpoint_auth_method "none"): MCP OAuth uses PKCE instead of a
 * client secret, and an empty secret is what keeps the pending state's
 * "never ciphertext-of-empty" rule meaningful (oss#394).
 * Proven by mcpserver-oauth.conformance.test.ts (CONFORMANCE_TARGET=local).
 */
import { truncateBody } from "./truncate-body.js";

/** Dynamic Client Registration response per RFC 7591 (Go DCRResponse). */
export interface DcrResponse {
  clientId: string;
  clientSecret: string;
  clientName: string;
  tokenEndpointAuthMethod: string;
}

/** Go's dcrHTTPClient 15s timeout — a named constant per guidelines. */
export const DCR_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Performs OAuth Dynamic Client Registration at the given registration
 * endpoint (Go RegisterClient). The returned client_id is stored in the
 * user's OAuthGrant for subsequent token operations. Accepts 200 or 201
 * (RFC says 201; real providers answer both).
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DcrResponse> {
  const requestBody = JSON.stringify({
    redirect_uris: [redirectUri],
    client_name: clientName,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  let response: Response;
  try {
    response = await fetchImpl(registrationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(DCR_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `DCR request to ${registrationEndpoint} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = await response.text();
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(
      `DCR at ${registrationEndpoint} returned HTTP ${response.status}: ${truncateBody(body)}`,
    );
  }

  let raw: {
    client_id?: string;
    client_secret?: string;
    client_name?: string;
    token_endpoint_auth_method?: string;
  };
  try {
    raw = JSON.parse(body) as typeof raw;
  } catch (error) {
    throw new Error(
      `failed to parse DCR response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if ((raw.client_id ?? "") === "") {
    throw new Error(
      `DCR response from ${registrationEndpoint} is missing client_id`,
    );
  }

  return {
    clientId: raw.client_id as string,
    clientSecret: raw.client_secret ?? "",
    clientName: raw.client_name ?? "",
    tokenEndpointAuthMethod: raw.token_endpoint_auth_method ?? "",
  };
}
