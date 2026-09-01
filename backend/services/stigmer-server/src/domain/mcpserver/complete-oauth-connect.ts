/**
 * completeOAuthConnect — ports
 * pkg/domain/mcpserver/controller/complete_oauth_connect.go: finish the
 * OAuth flow by exchanging the authorization code for tokens, storing
 * them in a managed environment, and creating an OAuthGrant record. On
 * re-connect (same user + server + org already has a grant with an
 * environment ID), the existing managed environment is reused — only its
 * secrets are updated with the fresh tokens.
 *
 * DB-1 (owner-ratified, sub-project 20260825.02): the managed-env service
 * is wired unconditionally here, so this RPC serves on a Temporal-less
 * server where Go's composition gate refuses ("managed environment
 * service not initialized" — a wiring artifact CW-1 deliberately did NOT
 * pin). Disclosed divergence; the Go-side issue files at wrap-up.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution) and
 * __tests__/complete-oauth-connect.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { EnvironmentValue as EnvironmentSpecValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
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
import type { McpServerConnectDeps } from "./connect.js";
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
  // re-initiate. C2 Stage 4.
  await authorizeDirect(
    McpServerCommandController.method.completeOAuthConnect,
    deps.authorizer,
    identity,
    input,
    { resourceId: pendingState.mcpServerId },
  );

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
  } catch {
    throw notFoundError("mcp_server", mcpServerId);
  }

  let org = pendingState.org;
  if (org === "") {
    org = mcpServer.metadata?.org ?? "";
  }

  // Resolve the managed environment: reuse from an existing grant or
  // create new — the create AS THE COMPLETING CALLER (ruling R5, parity
  // entry 20260830.05): ownership tuples land on the connecting user
  // under a composed tuple-lifecycle driver, so the environment stays
  // visible in their scoped lists (the Java createAsCaller posture).
  const managedEnvId = await resolveOrCreateManagedEnvironment(
    deps,
    pendingState.identityAccountId,
    mcpServerId,
    org,
    mcpServer.metadata?.name ?? "",
    identity,
  );

  // Build token variables (plaintext — the environment pipeline encrypts).
  const tokenVars: { [key: string]: EnvironmentSpecValue } = {
    [pendingState.targetEnvVar]: create(EnvironmentValueSchema, {
      value: tokenResponse.accessToken,
      isSecret: true,
    }),
  };

  const refreshTokenEnvVar = `${pendingState.targetEnvVar}_REFRESH_TOKEN`;
  if (tokenResponse.refreshToken !== "") {
    tokenVars[refreshTokenEnvVar] = create(EnvironmentValueSchema, {
      value: tokenResponse.refreshToken,
      isSecret: true,
    });
  }

  try {
    await deps.managedEnv.updateSecrets(managedEnvId, tokenVars);
  } catch (error) {
    throw internalError(
      error,
      "failed to store OAuth tokens in managed environment",
    );
  }

  let expiresAt = 0;
  if (tokenResponse.expiresIn > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expiresIn;
  }

  // Create or update the OAuthGrant record. RefreshTokenEnvVar is set
  // UNCONDITIONALLY — even when no refresh token was issued — which is
  // exactly why evaluateHealth's TOKEN_EXPIRED arm is unreachable through
  // the real flow: the filed defect oss#863, ported as-is (parity, not a
  // fix).
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
      refreshTokenEnvVar,
      environmentId: managedEnvId,
      createdAt: 0,
      updatedAt: 0,
    });
  } catch (error) {
    throw internalError(error, "failed to create OAuth grant record");
  }

  const auth = mcpServer.spec?.auth;

  deps.logger.info(
    "OAuth Connect completed: tokens stored in managed environment",
    {
      mcp_server_id: mcpServerId,
      auth_method: pendingState.authMethod,
      target_env_var: pendingState.targetEnvVar,
      managed_env_id: managedEnvId,
      expires_at: expiresAt,
      has_refresh_token: tokenResponse.refreshToken !== "",
    },
  );

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

/**
 * Reuses the managed environment an existing OAuthGrant points to
 * (re-connect case), or creates a new one (Go
 * resolveOrCreateManagedEnvironment).
 */
async function resolveOrCreateManagedEnvironment(
  deps: McpServerConnectDeps,
  identityAccountId: string,
  mcpServerId: string,
  org: string,
  mcpServerName: string,
  caller: CallerIdentity,
): Promise<string> {
  let existingGrant;
  try {
    existingGrant = await deps.oauthGrants.find(
      identityAccountId,
      mcpServerId,
      org,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to look up existing OAuth grant (non-fatal, will create new managed env)",
      {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  if (existingGrant !== undefined && existingGrant.environmentId !== "") {
    deps.logger.info(
      "Reusing existing managed environment for OAuth re-connect",
      {
        mcp_server_id: mcpServerId,
        environment_id: existingGrant.environmentId,
      },
    );
    return existingGrant.environmentId;
  }

  const envName = `OAuth: ${mcpServerName}`;
  try {
    return await deps.managedEnv.createManagedEnvironment(envName, org, caller);
  } catch (error) {
    throw internalError(
      error,
      "failed to create managed environment for OAuth tokens",
    );
  }
}
