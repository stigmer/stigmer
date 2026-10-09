/**
 * Sign-in renewal: the access token of a vault connection saved by a
 * sign-in, renewed with its sealed refresh token before it is used.
 *
 * `newSignInFreshener` is the one renewal path. Its readers are the run
 * credential resolver and the MCP connect lane (both through
 * domain/vault/resolve.ts, which declares the `SignInFreshener` contract so
 * the vault domain never imports this one). A renewal is written back
 * through `VaultService.setConnection`, the vault's atomic entry write, so
 * it never undoes a secret saved in the same moment, and guarded by the
 * sealed token it read, so it never overwrites a sign-in made since; the
 * refresh token is rotated when the provider rotates it and kept otherwise.
 * A renewal that cannot happen (no refresh token, the provider refused)
 * throws the contract's SignInRenewalError, whose message is the cause
 * alone (the resolver adds the address and the instruction); a fault
 * writing it back is thrown as it is, so the resolver answers it as a
 * fault, not a refusal.
 *
 * A vendor sign-in renews with its OAuth app's client secret, found through
 * the MCP server its sign-in record names (`sign_in.mcp_server_id`) and that
 * server's `auth.oauth_app_ref`, read live so an admin's fix to the app
 * applies at once. The secret is sent only when that app's client id and
 * token URL are the ones the sign-in recorded: the renewal always goes to
 * the sign-in's own token endpoint and client, so after an editor points
 * the server at another app, that app's secret would reach an endpoint it
 * was never issued for. Such a sign-in renews without a secret, as one
 * whose app is gone does, and the provider decides; a DCR or public client
 * renews without a secret too.
 *
 * Proven by __tests__/token-refresh.test.ts (the expiry arithmetic) and
 * ../__tests__/sign-in-vault.test.ts (renewal written through the vault,
 * rotation, the guarded write-back, the no-refresh-token refusal, the
 * app's secret presented or withheld, another app's secret never sent).
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";

import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { Logger } from "../../../boot/logger.js";
import type { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { resolveOAuthAppRef } from "../../oauthapp/refresolution.js";
import { SignInRenewalError } from "../../vault/resolve.js";
import type { SignInFreshener } from "../../vault/resolve.js";
import type {
  OpenedConnection,
  VaultService,
  VaultSignIn,
  VaultSignInRecord,
} from "../../vault/service.js";
import { VaultConnectionSource } from "../../vault/service.js";
import {
  TOKEN_AUTH_METHOD_BASIC,
  TOKEN_AUTH_METHOD_POST,
  refreshToken,
} from "./token.js";

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

/** Whether a sign-in's access token has expired, counting the buffer. 0 never expires. */
export function signInExpired(expiresAt: bigint, nowSeconds?: number): boolean {
  if (expiresAt === 0n) {
    return false;
  }
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return BigInt(now) >= expiresAt - BigInt(REFRESH_EXPIRY_BUFFER_SECONDS);
}

/**
 * Checks whether a sign-in's access token is expired and, if so, uses the
 * refresh token to obtain a new one. The caller writes the returned values
 * back to the vault.
 *
 * clientSecret is empty for DCR/public clients; tokenAuthMethod selects
 * how a non-empty secret is presented (empty falls back to Basic).
 * Returns refreshed=false when the token has no expiry (long-lived
 * Notion/Slack-style tokens) or is not yet within the buffer; throws when
 * the refresh is needed but impossible or fails. The error states the
 * cause alone: the resolver names the address and vault and gives the one
 * instruction to sign in again (domain/vault/resolve.ts).
 */
export async function refreshTokenIfExpired(
  signIn: VaultSignIn,
  address: string,
  clientSecret: string,
  tokenAuthMethod: string,
  logger: Logger,
  fetchImpl: OutboundFetch,
): Promise<RefreshResult> {
  if (!signInExpired(signIn.expiresAt)) {
    return notRefreshed();
  }

  if (signIn.refreshToken === "") {
    throw new Error("it has expired and no refresh token is available");
  }

  logger.info("Access token expired, refreshing via refresh_token grant", {
    address,
    expiredAt: signIn.expiresAt.toString(),
    tokenEndpoint: signIn.tokenEndpoint,
  });

  let tokenResponse;
  try {
    tokenResponse = await refreshToken(
      signIn.tokenEndpoint,
      signIn.refreshToken,
      signIn.clientId,
      clientSecret,
      tokenAuthMethod,
      fetchImpl,
    );
  } catch (error) {
    throw new Error(
      `renewing it failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let newExpiresAt = 0;
  if (tokenResponse.expiresIn > 0) {
    newExpiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expiresIn;
  }

  const newRefreshToken =
    tokenResponse.refreshToken !== ""
      ? tokenResponse.refreshToken
      : signIn.refreshToken;

  logger.info("Token refresh successful", {
    address,
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

/** What renewal reads: the vault door, the store (servers, OAuth apps), sealing, the egress fetch. */
export interface SignInFreshenerDeps {
  readonly vaults: VaultService;
  readonly store: Store;
  readonly secretService: SecretService;
  readonly logger: Logger;
  /** The egress-guarded fetch login servers are dialled with; defaults to global fetch. */
  readonly fetchImpl?: OutboundFetch;
}

export function newSignInFreshener(deps: SignInFreshenerDeps): SignInFreshener {
  const fetchImpl: OutboundFetch = deps.fetchImpl ?? fetch;
  return {
    async freshToken(
      vault: Vault,
      connection: OpenedConnection,
      caller: CallerIdentity,
    ): Promise<string> {
      const signIn = connection.signIn;
      if (
        connection.source !== VaultConnectionSource.sign_in ||
        signIn === undefined ||
        !signInExpired(signIn.expiresAt)
      ) {
        return connection.token;
      }

      let clientSecret = "";
      let tokenAuthMethod = "";
      if (signIn.authMethod === "vendor_oauth") {
        try {
          ({ clientSecret, tokenAuthMethod } =
            await loadSignInClientCredentials(deps, signIn));
        } catch (error) {
          deps.logger.warn("Failed to load the OAuth app's client secret for renewal", {
            mcp_server_id: signIn.mcpServerId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // The refresh token is opened only here, for a renewal.
      const renewing: VaultSignIn = {
        ...signIn,
        refreshToken: (await connection.refreshToken?.()) ?? "",
      };
      let result: RefreshResult;
      try {
        result = await refreshTokenIfExpired(
          renewing,
          connection.address,
          clientSecret,
          tokenAuthMethod,
          deps.logger,
          fetchImpl,
        );
      } catch (error) {
        throw new SignInRenewalError(error instanceof Error ? error.message : String(error));
      }
      // Expiry was checked above, so the renewal either happened or threw.
      await deps.vaults.setConnection(
        vault.metadata?.id ?? "",
        connection.address,
        {
          token: result.newAccessToken,
          source: VaultConnectionSource.sign_in,
          signIn: {
            ...renewing,
            expiresAt: BigInt(result.newExpiresAt),
            refreshToken: result.newRefreshToken,
          },
          // A sign-in made since the run read this one stands.
          expectStoredToken: connection.storedToken,
        },
        caller,
      );
      return result.newAccessToken;
    },
  };
}

/** What reading an OAuth app's client credentials needs. */
export interface ClientCredentialDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
}

/**
 * The client secret and token-endpoint auth method of the OAuth app the
 * sign-in's server references, for a vendor renewal. Empty for a server
 * that is gone or references no app, and for an app whose client id or
 * token URL is not the sign-in's: its secret was never issued for the
 * endpoint the renewal posts to.
 */
async function loadSignInClientCredentials(
  deps: ClientCredentialDeps,
  signIn: VaultSignInRecord,
): Promise<{ clientSecret: string; tokenAuthMethod: string }> {
  const none = { clientSecret: "", tokenAuthMethod: "" };
  const mcpServerId = signIn.mcpServerId;
  if (mcpServerId === "") {
    return none;
  }
  let server: McpServer;
  try {
    server = await deps.store.getResource(
      ApiResourceKind.mcp_server,
      mcpServerId,
      McpServerSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return none;
    }
    throw error;
  }
  const app = await loadOAuthAppClientCredentials(deps, server);
  if (app.clientSecret === "") {
    return none;
  }
  if (
    app.clientId !== signIn.clientId ||
    app.tokenUrl !== signIn.tokenEndpoint
  ) {
    deps.logger.warn(
      "The server's OAuth app is not the one the sign-in was made with; renewing without its secret",
      { mcp_server_id: mcpServerId },
    );
    return none;
  }
  return { clientSecret: app.clientSecret, tokenAuthMethod: app.tokenAuthMethod };
}

/** An OAuth app's client credentials: its secret, opened, and where they apply. */
export interface OAuthAppClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl: string;
  readonly tokenAuthMethod: string;
}

/**
 * Loads the decrypted client_secret, the token-endpoint auth method, and
 * the client id and token URL they belong to, from the OAuthApp the server
 * references now (Go loadOAuthAppClientCredentials). Read LIVE so an admin
 * correcting a misconfigured OAuthApp fixes renewals immediately.
 *
 * Resolution goes through refresolution, the same lookup the initiate
 * path uses (stigmer/stigmer#584). The reference can have been repointed
 * at another app since a sign-in, so the app found here is not
 * necessarily the one that sign-in was made with: a caller sending the
 * secret for a sign-in compares the client id and token URL first
 * (`loadSignInClientCredentials`).
 */
export async function loadOAuthAppClientCredentials(
  deps: ClientCredentialDeps,
  mcpServer: McpServer,
): Promise<OAuthAppClientCredentials> {
  const ref = mcpServer.spec?.auth?.oauthAppRef;
  if (ref === undefined || ref.slug === "") {
    return { clientId: "", clientSecret: "", tokenUrl: "", tokenAuthMethod: "" };
  }

  let app;
  try {
    app = await resolveOAuthAppRef(deps.store, ref, deps.logger);
  } catch (error) {
    throw new Error(
      `failed to list oauth apps: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (app === undefined) {
    throw new Error(`OAuthApp '${ref.slug}' not found`);
  }

  const tokenAuthMethod = tokenAuthMethodFromSpec(
    app.spec?.tokenEndpointAuthMethod ?? TokenEndpointAuthMethod.UNSPECIFIED,
  );

  let secret = app.spec?.clientSecret ?? "";
  if (deps.secretService.isEncrypted(secret)) {
    secret = await deps.secretService.decrypt(secret);
  }
  return {
    clientId: app.spec?.clientId ?? "",
    clientSecret: secret,
    tokenUrl: app.spec?.tokenUrl ?? "",
    tokenAuthMethod,
  };
}

/**
 * Maps the OAuthAppSpec enum onto the oauth package's RFC 8414 strings
 * (Go tokenAuthMethodFromSpec). UNSPECIFIED means Basic — every OAuthApp
 * created before the field existed authenticated via HTTP Basic.
 */
export function tokenAuthMethodFromSpec(
  method: TokenEndpointAuthMethod,
): string {
  if (method === TokenEndpointAuthMethod.CLIENT_SECRET_POST) {
    return TOKEN_AUTH_METHOD_POST;
  }
  return TOKEN_AUTH_METHOD_BASIC;
}
