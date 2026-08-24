/**
 * Pre-flight token refresh — ports pkg/domain/mcpserver/oauth/refresh.go.
 * Consumed by the agentexecution EC builder's OAuth injection (#17); the
 * connect-lane refresh callers arrive with #19.
 */
import type { OAuthGrant } from "../../../store/interface.js";
import type { Logger } from "../../../boot/logger.js";
import { refreshToken } from "./token.js";

/** The outcome of a refresh attempt (Go RefreshResult). */
export interface RefreshResult {
  refreshed: boolean;
  newAccessToken: string;
  newRefreshToken: string;
  /** Unix seconds; 0 = does not expire. */
  newExpiresAt: number;
}

/**
 * Refresh slightly before expiry — Go's 60-second buffer, named per the
 * guidelines' semantic-constant rule.
 */
export const REFRESH_EXPIRY_BUFFER_SECONDS = 60;

/**
 * Checks whether the grant's access token is expired and, if so, uses the
 * refresh token to obtain a new one. The caller updates the managed
 * environment and the grant record with the returned values.
 *
 * clientSecret is empty for DCR/public clients; tokenAuthMethod selects
 * how a non-empty secret is presented (empty falls back to Basic).
 * Returns refreshed=false when the token has no expiry (long-lived
 * Notion/Slack-style tokens) or is not yet within the buffer; throws when
 * the refresh is needed but impossible or fails (the caller surfaces a
 * re-auth error).
 */
export async function refreshTokenIfExpired(
  grant: OAuthGrant,
  currentRefreshToken: string,
  clientSecret: string,
  tokenAuthMethod: string,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  if (grant.accessTokenExpiresAt === 0) {
    // Token does not expire.
    return notRefreshed();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < grant.accessTokenExpiresAt - REFRESH_EXPIRY_BUFFER_SECONDS) {
    return notRefreshed();
  }

  if (currentRefreshToken === "") {
    throw new Error(
      `access token for resource '${grant.resourceId}' has expired and no refresh token is available. ` +
        "Please re-authenticate via OAuth Connect",
    );
  }

  logger.info("Access token expired, refreshing via refresh_token grant", {
    resourceId: grant.resourceId,
    resourceKind: grant.resourceKind,
    expiredAt: grant.accessTokenExpiresAt,
    tokenEndpoint: grant.tokenEndpoint,
  });

  let tokenResponse;
  try {
    tokenResponse = await refreshToken(
      grant.tokenEndpoint,
      currentRefreshToken,
      grant.clientId,
      clientSecret,
      tokenAuthMethod,
      fetchImpl,
    );
  } catch (error) {
    throw new Error(
      `token refresh failed for resource '${grant.resourceId}': ${error instanceof Error ? error.message : String(error)}. ` +
        "Please re-authenticate via OAuth Connect",
    );
  }

  let newExpiresAt = 0;
  if (tokenResponse.expiresIn > 0) {
    newExpiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expiresIn;
  }

  const newRefreshToken =
    tokenResponse.refreshToken !== ""
      ? tokenResponse.refreshToken
      : currentRefreshToken;

  logger.info("Token refresh successful", {
    resourceId: grant.resourceId,
    resourceKind: grant.resourceKind,
    newExpiresAt,
    refreshTokenRotated: tokenResponse.refreshToken !== "",
  });

  return {
    refreshed: true,
    newAccessToken: tokenResponse.accessToken,
    newRefreshToken,
    newExpiresAt,
  };
}

function notRefreshed(): RefreshResult {
  return {
    refreshed: false,
    newAccessToken: "",
    newRefreshToken: "",
    newExpiresAt: 0,
  };
}
