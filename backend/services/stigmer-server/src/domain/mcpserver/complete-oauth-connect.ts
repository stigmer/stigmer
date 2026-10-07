/**
 * completeOAuthConnect: finish the OAuth flow by exchanging the
 * authorization code for tokens, saving the access token as a sign-in
 * credential (domain/credential/sign-in.ts) and recording the OAuthGrant,
 * with the refresh token sealed on it. The sign-in is the caller's own,
 * or the organization's for a server with organization sign-in
 * (oauth/sign-in.ts): the pending state recorded whose at initiate, and
 * only that person (or, for the organization's, an admin) completes it.
 * On re-connect the grant's credential is reused, its token replaced.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution), __tests__/oauth-handshake.test.ts
 * and __tests__/store-faults.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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
import { signInOwner } from "../credential/sign-in.js";
import type { McpServerConnectDeps } from "./connect.js";
import {
  requireOrganizationSignInAdmin,
  sealRefreshToken,
} from "./oauth/sign-in.js";
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
  // A personal sign-in is completed by the person who started it, never
  // by someone the link reached: the token is saved as theirs.
  if (
    pendingState.identityAccountId !== "" &&
    pendingState.identityAccountId !== identity.identityId
  ) {
    throw failedPreconditionError(
      "this sign-in was started by another person; start your own sign-in from the MCP server's page",
    );
  }

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

  // Load the MCP server for the auth block metadata and name.
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
    // The pending state is consumed and the code exchanged by now, so a
    // retry of this call can only fail: the copy names the way back.
    throw internalError(
      error,
      "failed to load mcp server — please retry the connect flow",
    );
  }

  let org = pendingState.org;
  if (org === "") {
    org = mcpServer.metadata?.org ?? "";
  }

  if (pendingState.identityAccountId === "") {
    await requireOrganizationSignInAdmin(deps.authorizer, identity, mcpServer, org);
  }

  let existingGrant;
  try {
    existingGrant = await deps.oauthGrants.find(
      pendingState.identityAccountId,
      mcpServerId,
      org,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to look up an existing OAuth grant (non-fatal, a new sign-in credential is saved)",
      {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  // Save the access token as the sign-in's credential, AS THE COMPLETING
  // CALLER, so a personal sign-in's credential is theirs.
  let credentialId: string;
  try {
    credentialId = await deps.signIns.save({
      existingCredentialId: existingGrant?.credentialId ?? "",
      owner: signInOwner(pendingState.identityAccountId, org),
      server: mcpServer,
      org,
      field: pendingState.targetEnvVar,
      token: tokenResponse.accessToken,
      caller: identity,
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    throw internalError(error, "failed to save the sign-in's access token");
  }

  let expiresAt = 0;
  if (tokenResponse.expiresIn > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expiresIn;
  }

  let refreshToken: string;
  try {
    refreshToken = await sealRefreshToken(
      deps.secretService,
      deps.logger,
      tokenResponse.refreshToken,
      org,
    );
  } catch (error) {
    throw internalError(error, "failed to seal the refresh token");
  }

  try {
    await deps.oauthGrants.upsert({
      identityAccountId: pendingState.identityAccountId,
      resourceId: mcpServerId,
      resourceKind: "mcp_server",
      orgId: org,
      accessTokenExpiresAt: expiresAt,
      clientId: pendingState.clientId,
      authMethod: pendingState.authMethod,
      tokenEndpoint: pendingState.tokenEndpoint,
      accessTokenEnvVar: pendingState.targetEnvVar,
      credentialId,
      refreshToken,
      createdAt: 0,
      updatedAt: 0,
    });
  } catch (error) {
    throw internalError(error, "failed to create OAuth grant record");
  }

  const auth = mcpServer.spec?.auth;

  deps.logger.info("OAuth Connect completed: the sign-in is saved", {
    mcp_server_id: mcpServerId,
    auth_method: pendingState.authMethod,
    target_env_var: pendingState.targetEnvVar,
    credential_id: credentialId,
    organization_sign_in: pendingState.identityAccountId === "",
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
