/**
 * Finishing a sign-in: exchanging the code the login page handed back and
 * saving the login in the vault the sign-in was started for, as a
 * connection at its address with `source: sign_in`. The one completion
 * every door shares (a person's `completeSignIn`, a Connect link's
 * `completeConnectLink`); the door consumes the pending state, checks it is
 * its own, re-authorizes the vault and resolves it, then calls here.
 *
 * Whatever the vault holds at the address is replaced: a sign-in and a
 * pasted login serve the same tools (every HTTP tool at the address), and
 * the signer may edit the vault anyway. Room in the vault for a login that
 * would be new is settled before the exchange, so a full vault refuses with
 * no live token minted at the provider; the save checks again inside its
 * atomic write. A new sign-in that arrives without a refresh token keeps
 * the previous one only when the same person saved it through the same
 * login app, client and token endpoint (`keepRefreshToken`, the vault
 * service's rule), and never through a Connect link, whose saver is the
 * link's maker for every customer.
 *
 * The exchange sends `resource` again when the start did (a login server
 * found by the address's own metadata). A login server that answers
 * `invalid_client` has forgotten the client Stigmer registered with it: the
 * kept registration is dropped, so the person's next sign-in registers anew.
 *
 * The saved login is described by the account when the login app names an
 * endpoint that answers who signed in ("GitHub @ana", from `login` or
 * `preferred_username`, else `email`), read once with the new token through
 * the egress guard; otherwise "Signed in at HOST". A failed read only
 * shortens the description.
 *
 * Proven by __tests__/person.test.ts, __tests__/faults.test.ts and the
 * sign-in conformance suite.
 */
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";

import type { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  unavailableError,
} from "../../../pipeline/errors.js";
import type { PendingOAuthState } from "../../../store/interface.js";
import { refuseNewConnectionOverCap, VaultConnectionSource } from "../service.js";
import type { VaultService } from "../service.js";
import { forgetClient } from "./client.js";
import { hostOf } from "./start.js";
import type { SignInDeps } from "./start.js";
import { TokenEndpointError, exchangeCode } from "./token.js";

/** The login a sign-in saved. */
export interface FinishedSignIn {
  readonly address: string;
  readonly description: string;
}

/** How long reading who signed in may take: one interactive round trip. */
export const USERINFO_TIMEOUT_MS = 10_000;

/**
 * Exchanges the code and saves the login in `target`, as `saver` (the
 * signer, or a Connect link's creator).
 */
export async function finishSignIn(
  deps: SignInDeps & { readonly vaults: VaultService },
  pending: PendingOAuthState,
  code: string,
  target: Vault,
  saver: CallerIdentity,
): Promise<FinishedSignIn> {
  const address = pending.address;
  refuseNewConnectionOverCap(target, address);

  // Unseal the handshake secrets the start sealed at rest (oss#394), at
  // the last moment before their only use. The row is consumed, so a
  // decryption failure costs the person one new start.
  let opened: PendingOAuthState;
  try {
    opened = await unsealPendingOAuthState(deps.secretService, pending);
  } catch (error) {
    deps.logger.error("Failed to decrypt pending OAuth state secrets", {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to decrypt OAuth handshake secrets — please sign in again");
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeCode(
      opened.tokenEndpoint,
      code,
      opened.redirectUri,
      opened.codeVerifier,
      opened.clientId,
      opened.clientSecret,
      opened.tokenAuthMethod,
      deps.outboundFetch,
      opened.resource,
    );
  } catch (error) {
    if (error instanceof TokenEndpointError && error.oauthError === "invalid_client") {
      await forgetClient(deps.clientRegistrations, opened.clientRegistration, opened.redirectUri, opened.clientId);
      throw failedPreconditionError(
        `the login server for ${address} no longer knows Stigmer's client: sign in again`,
      );
    }
    // The pinned (unusual) Go mapping for a failed exchange,
    // complete_oauth_connect.go:96.
    throw unavailableError(
      `token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const expiresAt =
    tokenResponse.expiresIn > 0 ? Math.floor(Date.now() / 1000) + tokenResponse.expiresIn : 0;
  const description = await describeLogin(deps, opened, tokenResponse.accessToken);

  await deps.vaults.setConnection(
    target.metadata?.id ?? "",
    address,
    {
      token: tokenResponse.accessToken,
      source: VaultConnectionSource.sign_in,
      signIn: {
        expiresAt: BigInt(expiresAt),
        clientId: opened.clientId,
        authMethod: opened.authMethod,
        tokenEndpoint: opened.tokenEndpoint,
        refreshToken: tokenResponse.refreshToken,
        loginApp: opened.loginApp,
      },
      description,
      // A Connect link saves every customer as the link's maker, so "the
      // same saver" says nothing about the account: a link's sign-in never
      // inherits the refresh token another customer's sign-in left.
      keepRefreshToken: pending.connectLink === "",
    },
    saver,
  );

  deps.logger.info("Sign-in saved in the vault", {
    address,
    auth_method: opened.authMethod,
    login_app: opened.loginApp === "" ? "login server" : opened.loginApp,
    vault: opened.vaultId === "" ? "mine" : opened.vaultId,
    connect_link: opened.connectLink !== "",
    expires_at: expiresAt,
    has_refresh_token: tokenResponse.refreshToken !== "",
  });
  return { address, description };
}

/**
 * How the saved login is described: the account the login app's endpoint
 * names, else the host signed in at.
 */
async function describeLogin(
  deps: Pick<SignInDeps, "outboundFetch" | "logger">,
  pending: PendingOAuthState,
  accessToken: string,
): Promise<string> {
  const fallback = `Signed in at ${hostOf(pending.address)}`;
  if (pending.userinfoUrl === "") {
    return fallback;
  }
  let account: Record<string, unknown>;
  try {
    const response = await deps.outboundFetch(pending.userinfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Stigmer",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed: unknown = await response.json();
    account = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    deps.logger.warn("Could not read who signed in; describing the login by its host", {
      address: pending.address,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
  const handle = firstString(account, ["login", "preferred_username"]);
  if (handle !== "") {
    return `${pending.providerName} @${handle}`;
  }
  const email = firstString(account, ["email"]);
  return email !== "" ? `${pending.providerName} ${email}` : fallback;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

/**
 * Decrypts the secrets sealPendingOAuthState encrypted before the row
 * rested (oss#394) — the read seam paired with the write seam in start.ts.
 *
 * decrypt() dispatches on the value's own enc:v1: prefix and passes
 * plaintext through unchanged, which covers rows written while encryption
 * was disabled and a public client's deliberately empty secret.
 *
 * A sealed row on a deployment whose key has since vanished fails here
 * (loudly, before any token-exchange attempt) rather than sending
 * ciphertext to the vendor's token endpoint.
 */
export async function unsealPendingOAuthState(
  secretService: SecretService,
  state: PendingOAuthState,
): Promise<PendingOAuthState> {
  let verifier: string;
  try {
    verifier = await secretService.decrypt(state.codeVerifier);
  } catch (error) {
    throw new Error(
      `failed to decrypt code_verifier: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let secret: string;
  try {
    secret = await secretService.decrypt(state.clientSecret);
  } catch (error) {
    throw new Error(
      `failed to decrypt client_secret: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { ...state, codeVerifier: verifier, clientSecret: secret };
}
