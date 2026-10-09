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
 * A sign-in made through a login app renews with that app's client secret,
 * found by the app its sign-in record names (`sign_in.login_app`: an
 * organization's OAuthApp by id, or a catalog entry from the deployment's
 * settings, login-app.ts), read live so an admin's fix to the app applies
 * at once. The secret is sent only while that app's client id and token URL
 * are the ones the sign-in recorded: the renewal always goes to the
 * sign-in's own token endpoint and client, so after an admin repoints the
 * app, its secret would reach an endpoint it was never issued for. Such a
 * sign-in renews without a secret, as one whose app is gone does, and the
 * provider decides. A sign-in saved before login apps were recorded
 * (`vendor_oauth` with no `login_app`) is renewed through the app the
 * address finds now, under the same client id and token URL guard, and
 * records it on write-back. A public client of the address's own login
 * server (`mcp_oauth`) renews without a secret, and with `resource` set to
 * the address, as its sign-in was made (RFC 8707); a login app's renewal
 * never carries `resource`.
 *
 * Proven by __tests__/token-refresh.test.ts (the expiry arithmetic) and
 * __tests__/person.test.ts (renewal written through the vault, rotation,
 * the guarded write-back, the no-refresh-token refusal, the app's secret
 * presented or withheld, another app's secret never sent, `resource` on a
 * public client's renewal).
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";

import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";

import type { Logger } from "../../../boot/logger.js";
import type { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import { isGitHostAddress } from "../address.js";
import { SIGN_IN_THROUGH_APP, SIGN_IN_THROUGH_LOGIN_SERVER } from "../constants.js";
import { findLoginApp, loginAppByRef } from "../login-app.js";
import type { LoginProviderSettings } from "../login-providers.js";
import { SignInRenewalError } from "../resolve.js";
import type { SignInFreshener } from "../resolve.js";
import type {
  OpenedConnection,
  VaultService,
  VaultSignIn,
  VaultSignInRecord,
} from "../service.js";
import { VaultConnectionSource } from "../service.js";
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
  resource = "",
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
      resource,
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

/** What renewal reads: the vault door, the login apps (the store's and the catalog's), sealing, the egress fetch. */
export interface SignInFreshenerDeps {
  readonly vaults: VaultService;
  readonly store: Store;
  readonly secretService: SecretService;
  readonly loginProviders: LoginProviderSettings;
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

      let loginApp = signIn.loginApp;
      let clientSecret = "";
      let tokenAuthMethod = "";
      try {
        if (loginApp === "" && signIn.authMethod === SIGN_IN_THROUGH_APP) {
          // Saved before sign-ins recorded their app: the app the address
          // finds now, held to the same guard as a recorded one.
          loginApp = (await findLoginApp(deps, vault.metadata?.org ?? "", connection.address))?.ref ?? "";
        }
        if (loginApp !== "") {
          ({ clientSecret, tokenAuthMethod } = await loadSignInClientCredentials(deps, {
            ...signIn,
            loginApp,
          }));
        }
      } catch (error) {
        deps.logger.warn("Failed to load the login app's client secret for renewal", {
          login_app: loginApp,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // A public client of the address's own login server was signed in
      // for the address as its resource; its renewal says so again.
      const resource =
        signIn.authMethod === SIGN_IN_THROUGH_LOGIN_SERVER && !isGitHostAddress(connection.address) ? connection.address : "";

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
          resource,
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
            // A legacy sign-in records the app whose secret renewed it.
            loginApp: signIn.loginApp !== "" || clientSecret === "" ? signIn.loginApp : loginApp,
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

/** What reading a login app's client credentials needs. */
export interface ClientCredentialDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly loginProviders: LoginProviderSettings;
}

/**
 * The client secret and token-endpoint auth method of the login app a
 * sign-in recorded, for its renewal. Empty for an app that is gone or
 * switched off, and for one whose client id or token URL is no longer the
 * sign-in's: its secret was never issued for the endpoint the renewal posts
 * to.
 */
async function loadSignInClientCredentials(
  deps: ClientCredentialDeps,
  signIn: VaultSignInRecord,
): Promise<{ clientSecret: string; tokenAuthMethod: string }> {
  const none = { clientSecret: "", tokenAuthMethod: "" };
  const app = await loginAppByRef(deps, signIn.loginApp);
  if (app === undefined || app.clientSecret === "") {
    return none;
  }
  if (app.clientId !== signIn.clientId || app.tokenUrl !== signIn.tokenEndpoint) {
    deps.logger.warn(
      "The login app is not the one the sign-in was made with; renewing without its secret",
      { login_app: signIn.loginApp },
    );
    return none;
  }
  return { clientSecret: app.clientSecret, tokenAuthMethod: app.tokenAuthMethod };
}
