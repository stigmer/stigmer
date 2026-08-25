/**
 * getOAuthGrantStatus — ports
 * pkg/domain/mcpserver/controller/get_oauth_grant_status.go: whether the
 * authenticated user has an active OAuth grant for the specified MCP
 * server in the given org. Returns grant metadata (connected status,
 * token expiry, auth method, connection health) without exposing secret
 * token values; the frontend renders the OAuth state in the MCP server
 * detail page and session composer from it. In OSS mode the
 * identity_account_id is always empty (single-user).
 *
 * Proven by mcpserver-oauth.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and
 * __tests__/get-oauth-grant-status.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type {
  GetOAuthGrantStatusInput,
  GetOAuthGrantStatusOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";

import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { OAuthGrant } from "../../store/interface.js";
import type { McpServerConnectDeps } from "./connect.js";
import { REFRESH_EXPIRY_BUFFER_SECONDS } from "./oauth/refresh.js";

export async function getOAuthGrantStatus(
  deps: McpServerConnectDeps,
  input: GetOAuthGrantStatusInput,
): Promise<GetOAuthGrantStatusOutput> {
  if (input.resourceId === "") {
    throw invalidArgumentError("resource_id is required");
  }
  if (input.org === "") {
    throw invalidArgumentError("org is required");
  }

  let grant: OAuthGrant | undefined;
  try {
    grant = await deps.oauthGrants.find("", input.resourceId, input.org);
  } catch (error) {
    throw internalError(error, "failed to look up OAuth grant");
  }

  if (grant === undefined) {
    return create(GetOAuthGrantStatusOutputSchema, {
      connected: false,
      connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    });
  }

  return create(GetOAuthGrantStatusOutputSchema, {
    connected: true,
    accessTokenExpiresAt: BigInt(grant.accessTokenExpiresAt),
    targetEnvVar: grant.accessTokenEnvVar,
    authMethod: grant.authMethod,
    connectionHealth: evaluateHealth(grant),
  });
}

/**
 * Determines the health of an OAuth connection from locally available
 * grant metadata (Go evaluateHealth). Uses the same 60-second expiry
 * buffer as oauth/refresh.ts so the UX signal matches execution behavior.
 *
 * Ported bug, as-is (oss#863): "refreshable" keys off
 * refreshTokenEnvVar != "" — but completeOAuthConnect sets that field
 * unconditionally, so TOKEN_EXPIRED is unreachable through the real flow
 * and an expired grant always claims refreshable even when no refresh
 * token was ever issued. The conformance suite pins this behavior;
 * fixing it is a both-editions change tracked on the issue.
 */
export function evaluateHealth(grant: OAuthGrant): OAuthConnectionHealth {
  if (grant.accessTokenExpiresAt === 0) {
    return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < grant.accessTokenExpiresAt - REFRESH_EXPIRY_BUFFER_SECONDS) {
    return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY;
  }

  if (grant.refreshTokenEnvVar !== "") {
    return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE;
  }

  return OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
}
