/**
 * completeOAuthConnect — ports
 * pkg/domain/mcpserver/controller/complete_oauth_connect.go: finish the
 * OAuth flow by exchanging the authorization code for tokens and saving
 * the login in a vault, as a connection at the server's address
 * (domain/vault/address.ts `toolAddressOf`) with `source: sign_in`.
 *
 * The login is the signer's: it lands in the vault the flow started with
 * (initiate's `vault_id`, re-authorized here, since a grant can be revoked
 * in between) or, when none was named, in the signer's own My vault in the
 * flow's organization, created on this first save. It is saved at the
 * address initiate recorded, and only while the server still has it: a
 * server pointed elsewhere during the sign-in is refused, so a login never
 * reaches a host the signer did not sign in for. Both checks, the
 * vault's re-authorization, the signer's My vault (created here on a first
 * sign-in) and room in the vault for a new login run before the code is
 * exchanged, so a refused completion leaves no live token minted at the
 * provider; only a vault filled by another write in between still refuses
 * at the save, after it. A teammate's
 * sign-in to the same server lands in the teammate's vault and never
 * touches this one. A login already saved at the address that is not a
 * sign-in to this same server (a pasted login, or another server's
 * sign-in there) is never replaced: the completion is refused before the
 * exchange, naming the address, so the person removes that login first.
 * The save asks again inside its atomic write (`onlyOverSignInOf`), so a
 * login saved there during the exchange is not replaced either: that
 * completion is refused after the exchange, and the token it minted is
 * discarded.
 * Re-connecting the same server replaces its connection in place, keeping the previous
 * refresh token when the provider answers without one; the refresh token
 * is sealed on its sign-in record beside the expiry, client id and token
 * endpoint renewals use, and never reaches a run. The record also keeps
 * whether the server was a local program at sign-in, so the login stops
 * filling it if an editor switches it between HTTP and a local program.
 *
 * The RPC serves on a Temporal-less server where Go's composition gate
 * refuses — a deliberate divergence from Go.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution), __tests__/oauth-handshake.test.ts,
 * __tests__/sign-in-vault.test.ts and __tests__/store-faults.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type {
  CompleteOAuthConnectInput,
  CompleteOAuthConnectOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { CompleteOAuthConnectOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { SecretService } from "../../encryption/encryption.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import type { PendingOAuthState } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { toolAddressOf } from "../vault/address.js";
import {
  VaultConnectionSource,
  otherLoginAtRefusal,
  refuseNewConnectionOverCap,
} from "../vault/service.js";
import type { McpServerConnectDeps } from "./connect.js";
import { authorizeSignInVault } from "./initiate-oauth-connect.js";
import { exchangeCode } from "./oauth/token.js";

export async function completeOAuthConnect(
  deps: McpServerConnectDeps,
  input: CompleteOAuthConnectInput,
  identity: CallerIdentity,
): Promise<CompleteOAuthConnectOutput> {
  const mcpServerId = input.mcpServerId;
  if (mcpServerId === "") {
    throw invalidArgumentError("mcp_server_id is required");
  }

  const stateParam = input.state;
  if (stateParam === "") {
    throw invalidArgumentError("state is required");
  }

  const code = input.authorizationCode;
  if (code === "") {
    throw invalidArgumentError("authorization_code is required");
  }

  // Load and validate pending state (atomically consumed).
  let pendingState: PendingOAuthState | undefined;
  try {
    pendingState = await deps.pendingOAuthStates.getAndDelete(stateParam);
  } catch (error) {
    throw internalError(error, "failed to load pending OAuth state");
  }
  if (pendingState === undefined) {
    throw failedPreconditionError(
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  }

  if (pendingState.mcpServerId !== mcpServerId) {
    throw failedPreconditionError(
      "state parameter does not match the requested mcp_server_id",
    );
  }

  // The annotation's can_connect check against the PENDING RECORD's
  // server id — the Java McpServerCompleteOAuthConnectHandler discipline
  // (the server-side state is the truth; a caller-supplied id would be a
  // confused-deputy target). As in Java, the single-use state is already
  // burned when a denial lands — the denied caller costs the user one
  // re-initiate.
  await authorizeDirect(
    McpServerCommandController.method.completeOAuthConnect,
    deps.authorizer,
    identity,
    input,
    { resourceId: pendingState.mcpServerId },
  );

  // The signer who started the flow finishes it: a state handed to another
  // caller does not save into that caller's vault, and the
  // provider's code is never spent on a caller who may not finish.
  if (pendingState.identityAccountId !== identity.identityId) {
    throw failedPreconditionError(
      "this sign-in was started by another account; start it again from your own session",
    );
  }

  // Load the MCP server for the auth block metadata and name, and refuse
  // what would not be saved (another address, a vault the signer may no
  // longer edit) before the exchange: the provider mints a live token for
  // the code, and a refused completion must leave none behind.
  let mcpServer: McpServer;
  try {
    mcpServer = await deps.store.getResource(
      ApiResourceKind.mcp_server,
      mcpServerId,
      McpServerSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("mcp_server", mcpServerId);
    }
    // The pending state is consumed by now, so a retry of this call can
    // only fail: the copy names the way back.
    throw internalError(
      error,
      "failed to load mcp server — please retry the connect flow",
    );
  }

  const org = pendingState.org !== "" ? pendingState.org : (mcpServer.metadata?.org ?? "");

  const address = toolAddressOf(mcpServer);
  if (address === undefined) {
    throw failedPreconditionError(
      `MCP server '${mcpServerId}' no longer has an address to save a sign-in at — please retry the connect flow`,
    );
  }
  // The signer signed in for the address the server had when they started;
  // a login saved at another would go to a host they never chose.
  if (address !== pendingState.toolAddress) {
    throw failedPreconditionError(
      `MCP server '${mcpServerId}': the tool's address changed during sign-in, so the login was not saved — start the sign-in again`,
    );
  }

  const vaultId = pendingState.vaultId ?? "";
  const sharedVault = await authorizeSignInVault(deps, org, vaultId, identity);

  // The vault the login lands in, and room in it for a login that would
  // be new, settled before the exchange as well: a full vault, or a My
  // vault another request is still creating, refuses with no token minted.
  // A signer's first sign-in creates their My vault here, so an exchange
  // that then fails leaves it, empty. setConnection checks the cap again
  // inside its atomic write; only a vault filled in between refuses after
  // the exchange. A store fault propagates as itself; the serving chain's
  // error boundary answers it INTERNAL.
  const target = sharedVault ?? (await deps.vaults.ensureMine(org, identity));
  refuseNewConnectionOverCap(target, address);
  refuseOtherLoginAt(target, address, mcpServerId);

  // Unseal the handshake secrets that initiateOAuthConnect sealed at rest
  // (oss#394), at the last moment before their only use. The row was
  // consumed by getAndDelete (single-use is atomic), so a decryption
  // failure costs the user one re-initiate — the same posture as the
  // expiry refusal; the error message points them there.
  try {
    pendingState = await unsealPendingOAuthState(
      deps.secretService,
      pendingState,
    );
  } catch (error) {
    deps.logger.error("Failed to decrypt pending OAuth state secrets", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(
      error,
      "failed to decrypt OAuth handshake secrets — please retry the connect flow",
    );
  }

  // Exchange authorization code for tokens. Failure maps to UNAVAILABLE —
  // the pinned (unusual) Go mapping, complete_oauth_connect.go:96.
  let tokenResponse;
  try {
    tokenResponse = await exchangeCode(
      pendingState.tokenEndpoint,
      code,
      pendingState.redirectUri,
      pendingState.codeVerifier,
      pendingState.clientId,
      pendingState.clientSecret,
      pendingState.tokenAuthMethod,
      deps.outboundFetch,
    );
  } catch (error) {
    throw unavailableError(
      `token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let expiresAt = 0;
  if (tokenResponse.expiresIn > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expiresIn;
  }

  await deps.vaults.setConnection(
    target.metadata?.id ?? "",
    address,
    {
      token: tokenResponse.accessToken,
      source: VaultConnectionSource.sign_in,
      signIn: {
        expiresAt: BigInt(expiresAt),
        clientId: pendingState.clientId,
        authMethod: pendingState.authMethod,
        tokenEndpoint: pendingState.tokenEndpoint,
        refreshToken: tokenResponse.refreshToken,
        mcpServerId,
        // The kind the token was signed in for: a run fills this server's
        // login only while it is still that kind (domain/vault/resolve.ts).
        localProgram: mcpServer.spec?.serverType?.case === "stdio",
      },
      description: `Sign-in for ${mcpServer.metadata?.name ?? mcpServerId}`,
      keepRefreshToken: true,
      onlyOverSignInOf: mcpServerId,
    },
    identity,
  );


  const auth = mcpServer.spec?.auth;

  deps.logger.info("OAuth Connect completed: sign-in saved in the vault", {
    mcp_server_id: mcpServerId,
    auth_method: pendingState.authMethod,
    target_env_var: pendingState.targetEnvVar,
    vault: vaultId === "" ? "mine" : vaultId,
    expires_at: expiresAt,
    has_refresh_token: tokenResponse.refreshToken !== "",
  });

  return create(CompleteOAuthConnectOutputSchema, {
    connected: true,
    targetEnvVar: pendingState.targetEnvVar,
    tokenLifetimeHint: auth?.tokenLifetimeHint ?? "",
  });
}

/**
 * Refuses a sign-in that would replace a login saved at its address that
 * is not a sign-in to this same server: a pasted login, or another
 * server's sign-in at the same URL. The save replaces whatever the address
 * holds, so either would be lost without a word; the person removes it
 * first. A re-sign-in to the same server replaces its own.
 */
function refuseOtherLoginAt(vault: Vault, address: string, mcpServerId: string): void {
  const refusal = otherLoginAtRefusal(vault.spec?.connections ?? {}, address, mcpServerId);
  if (refusal !== undefined) {
    throw failedPreconditionError(refusal);
  }
}

/**
 * Decrypts the secrets sealPendingOAuthState encrypted before the row
 * rested (oss#394) — the read seam paired with the write seam in
 * initiate-oauth-connect.ts.
 *
 * decrypt() dispatches on the value's own enc:v1: prefix and passes
 * plaintext through unchanged, which quietly covers every legacy shape:
 * rows written before the sealing release, rows written while encryption
 * was disabled, and the DCR path's deliberately empty client secret. No
 * migration — the table turns over in 10 minutes.
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
