/**
 * initiateOAuthConnect — ports
 * pkg/domain/mcpserver/controller/initiate_oauth_connect.go: start the
 * OAuth authorization flow for an MCP server. For DCR servers (no
 * oauth_app_ref): discover the authorization server, register a client
 * via RFC 7591, generate PKCE, pre-flight the authorize endpoint, return
 * the auth URL. For vendor OAuth servers: load the OAuthApp for client
 * credentials and build the auth URL from its endpoints.
 *
 * Proven by mcpserver-oauth.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and
 * __tests__/initiate-oauth-connect.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { randomBytes } from "node:crypto";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type {
  InitiateOAuthConnectInput,
  InitiateOAuthConnectOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { InitiateOAuthConnectOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import type { PendingOAuthState } from "../../store/interface.js";
import { resolveOAuthAppRef } from "../oauthapp/refresolution.js";
import { tokenAuthMethodFromSpec } from "./connect.js";
import type { McpServerConnectDeps } from "./connect.js";
import { generatePkce } from "./oauth/pkce.js";
import type { PkcePair } from "./oauth/pkce.js";
import { discoverAuthorizationServer } from "./oauth/discovery.js";
import { registerClient } from "./oauth/dcr.js";
import { preflightAuthorize } from "./oauth/preflight.js";
import type { AuthorizeRejection } from "./oauth/preflight.js";

export async function initiateOAuthConnect(
  deps: McpServerConnectDeps,
  input: InitiateOAuthConnectInput,
  identity: CallerIdentity,
): Promise<InitiateOAuthConnectOutput> {
  if (deps.oauthRedirectUri === "") {
    throw failedPreconditionError(
      "OAuth Connect is not configured: STIGMER_OAUTH_REDIRECT_URI is not set",
    );
  }

  const mcpServerId = input.mcpServerId;
  if (mcpServerId === "") {
    throw invalidArgumentError("mcp_server_id is required");
  }

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

  // The annotation's can_connect check AFTER the load — the Java
  // McpServerInitiateOAuthConnectHandler order (load-before-authorize,
  // stigmer#224). C2 Stage 4.
  await authorizeDirect(
    McpServerCommandController.method.initiateOAuthConnect,
    deps.authorizer,
    identity,
    input,
  );

  const auth = mcpServer.spec?.auth;
  if (auth === undefined) {
    throw failedPreconditionError(
      `MCP server '${mcpServerId}' does not have an auth block configured`,
    );
  }

  const pkcePair = generatePkce();
  const stateParam = generateState();

  const oauthAppRef = auth.oauthAppRef;
  const isDcr = oauthAppRef === undefined || oauthAppRef.slug === "";
  const result = isDcr
    ? await initiateDcr(deps, mcpServer, pkcePair, stateParam)
    : await initiateVendorOAuth(deps, mcpServer, pkcePair, stateParam);
  const authMethod = isDcr ? "mcp_oauth" : "vendor_oauth";

  const pendingState: PendingOAuthState = {
    state: stateParam,
    codeVerifier: pkcePair.codeVerifier,
    clientId: result.clientId,
    clientSecret: result.clientSecret,
    tokenEndpoint: result.tokenEndpoint,
    mcpServerId,
    // OSS mode: single user, no identity account.
    identityAccountId: "",
    targetEnvVar: auth.targetEnvVar,
    authMethod,
    tokenAuthMethod: result.tokenAuthMethod,
    redirectUri: deps.oauthRedirectUri,
    org: input.org,
    createdAt: 0,
  };

  // Fail-closed: an encryption error fails the request; plaintext never
  // reaches the store.
  let sealed: PendingOAuthState;
  try {
    sealed = sealPendingOAuthState(deps.secretService, deps.logger, pendingState);
  } catch (error) {
    throw internalError(error, "failed to encrypt OAuth handshake secrets");
  }

  try {
    await deps.pendingOAuthStates.save(sealed);
  } catch (error) {
    throw internalError(error, "failed to save pending OAuth state");
  }

  deps.logger.info("Initiated OAuth Connect flow", {
    mcp_server_id: mcpServerId,
    auth_method: authMethod,
    provider: result.providerName,
  });

  return create(InitiateOAuthConnectOutputSchema, {
    authorizationUrl: result.authorizationUrl,
    state: stateParam,
    scopes: result.scopes,
    providerName: result.providerName,
  });
}

interface InitiateResult {
  readonly authorizationUrl: string;
  readonly providerName: string;
  readonly scopes: string[];
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenEndpoint: string;
  /** RFC 8414 string; set on the vendor OAuth arm only. */
  readonly tokenAuthMethod: string;
}

async function initiateDcr(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  pkcePair: PkcePair,
  stateParam: string,
): Promise<InitiateResult> {
  // Resolve the URL for OAuth authorization server discovery. Priority:
  // auth.discovery_url > http.url — discovery_url enables DCR for stdio
  // servers that have no HTTP URL.
  let serverUrl = mcpServer.spec?.auth?.discoveryUrl ?? "";
  if (serverUrl === "") {
    const serverType = mcpServer.spec?.serverType;
    if (serverType?.case === "http") {
      serverUrl = serverType.value.url;
    }
  }
  if (serverUrl === "") {
    throw failedPreconditionError(
      `DCR requires a discoverable URL. MCP server '${mcpServer.metadata?.id ?? ""}' has no http.url and no auth.discovery_url. ` +
        "Set auth.discovery_url for stdio servers, oauth_app_ref for vendor OAuth, or switch to HTTP transport",
    );
  }

  let metadata;
  try {
    metadata = await discoverAuthorizationServer(serverUrl);
  } catch (error) {
    throw failedPreconditionError(
      `OAuth authorization server discovery failed for ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (metadata.registrationEndpoint === "") {
    throw failedPreconditionError(
      `MCP server at ${serverUrl} does not advertise a registration_endpoint for DCR`,
    );
  }

  const clientName = `Stigmer (${mcpServer.metadata?.name ?? ""})`;
  let dcrResponse;
  try {
    dcrResponse = await registerClient(
      metadata.registrationEndpoint,
      deps.oauthRedirectUri,
      clientName,
    );
  } catch (error) {
    throw failedPreconditionError(
      `DCR registration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let scopes = mcpServer.spec?.auth?.scopeHints ?? [];
  if (scopes.length === 0 && metadata.scopesSupported.length > 0) {
    scopes = metadata.scopesSupported;
  }

  const authUrl = buildAuthorizationUrl(
    metadata.authorizationEndpoint,
    dcrResponse.clientId,
    deps.oauthRedirectUri,
    pkcePair.codeChallenge,
    stateParam,
    scopes,
    "scope",
  );

  // Some providers accept DCR for any redirect URI but enforce a
  // redirect-host allowlist at the authorization endpoint; without this
  // pre-flight the rejection would surface only as a vendor error page
  // inside the popup, which never redirects back (stigmer/stigmer#235).
  // Fail-open by contract: only a definite rejection blocks initiate.
  let rejection: AuthorizeRejection | undefined;
  try {
    rejection = await preflightAuthorize(authUrl);
  } catch (probeError) {
    deps.logger.debug("authorize pre-flight probe inconclusive; proceeding", {
      mcp_server_id: mcpServer.metadata?.id ?? "",
      error: probeError instanceof Error ? probeError.message : String(probeError),
    });
  }
  if (rejection !== undefined) {
    deps.logger.warn(
      "authorization endpoint rejected the sign-in request pre-flight",
      {
        status_code: rejection.statusCode,
        mcp_server_id: mcpServer.metadata?.id ?? "",
        body_snippet: rejection.bodySnippet,
      },
    );
    throw failedPreconditionError(
      dcrRejectionMessage(
        mcpServer.metadata?.name ?? "",
        deps.oauthRedirectUri,
        rejection,
      ),
    );
  }

  return {
    authorizationUrl: authUrl,
    providerName: mcpServer.metadata?.name ?? "",
    scopes,
    clientId: dcrResponse.clientId,
    clientSecret: "",
    tokenEndpoint: metadata.tokenEndpoint,
    tokenAuthMethod: "",
  };
}

async function initiateVendorOAuth(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  pkcePair: PkcePair,
  stateParam: string,
): Promise<InitiateResult> {
  const ref = mcpServer.spec?.auth?.oauthAppRef;

  let oauthApp;
  try {
    oauthApp = await resolveOAuthAppRef(deps.store, ref, deps.logger);
  } catch (error) {
    throw internalError(error, "failed to list oauth apps");
  }
  if (oauthApp === undefined) {
    throw notFoundError("oauth_app", ref?.slug ?? "");
  }

  const approvalStatus = oauthApp.spec?.vendorApprovalStatus;
  if (
    approvalStatus === VendorApprovalStatus.PENDING ||
    approvalStatus === VendorApprovalStatus.REJECTED
  ) {
    const statusLabel =
      approvalStatus === VendorApprovalStatus.REJECTED
        ? "rejected"
        : "pending approval";
    // The suggested alternative must be one that can actually work:
    // oauth_only endpoints reject static tokens, so recommending manual
    // entry there sends the user down a dead end (stigmer/stigmer#412).
    const alternative = mcpServer.spec?.auth?.oauthOnly
      ? "This server only accepts OAuth sign-in; an org admin can configure your own OAuth app instead."
      : "Please enter a token manually instead.";
    throw failedPreconditionError(
      `OAuth sign-in is unavailable: the platform's OAuth app for '${oauthApp.spec?.provider ?? ""}' is ${statusLabel} by the vendor. ${alternative}`,
    );
  }

  let clientSecret = oauthApp.spec?.clientSecret ?? "";
  if (deps.secretService.isEncrypted(clientSecret)) {
    try {
      clientSecret = deps.secretService.decrypt(clientSecret);
    } catch (error) {
      throw internalError(error, "failed to decrypt OAuthApp client secret");
    }
  }

  const scopes = oauthApp.spec?.scopes ?? [];
  const authUrl = buildAuthorizationUrl(
    oauthApp.spec?.authorizationUrl ?? "",
    oauthApp.spec?.clientId ?? "",
    deps.oauthRedirectUri,
    pkcePair.codeChallenge,
    stateParam,
    scopes,
    oauthApp.spec?.scopeParameterName ?? "",
  );

  return {
    authorizationUrl: authUrl,
    providerName: oauthApp.spec?.provider ?? "",
    scopes,
    clientId: oauthApp.spec?.clientId ?? "",
    clientSecret,
    tokenEndpoint: oauthApp.spec?.tokenUrl ?? "",
    tokenAuthMethod: tokenAuthMethodFromSpec(
      oauthApp.spec?.tokenEndpointAuthMethod ??
        TokenEndpointAuthMethod.UNSPECIFIED,
    ),
  };
}

/**
 * Builds the authorization URL (Go buildAuthorizationURL). Parameters are
 * rendered SORTED by key — Go's url.Values.Encode() sorts, and the
 * conformance suite asserts the exact parameter set — with
 * form-urlencoding (spaces as +, both editions).
 */
export function buildAuthorizationUrl(
  authEndpoint: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
  scopes: string[],
  scopeParamName: string,
): string {
  const scopeParam = scopeParamName === "" ? "scope" : scopeParamName;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  if (scopes.length > 0) {
    params.set(scopeParam, scopes.join(" "));
  }
  params.sort();

  const separator = authEndpoint.includes("?") ? "&" : "?";
  return authEndpoint + separator + params.toString();
}

/**
 * Renders the user-facing copy for a pre-flight authorize rejection (Go
 * dcrRejectionMessage). The wording is hedged — a 400 can in principle
 * have other causes — but leads with the redirect-host allowlist because
 * it is the only cause observed in the wild (Canva, stigmer/stigmer#235),
 * and it names this deployment's callback host so self-hosted operators
 * can act on it. Surfaces which render initiate errors pass this text
 * through verbatim (getUserMessage in @stigmer/sdk), so it must stand on
 * its own for an end user.
 */
export function dcrRejectionMessage(
  providerName: string,
  redirectUri: string,
  rejection: AuthorizeRejection,
): string {
  let callbackHost = redirectUri;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.host !== "") {
      callbackHost = parsed.host;
    }
  } catch {
    // Keep the raw URI when it does not parse — Go's err-tolerant arm.
  }
  let message =
    `${providerName} rejected the sign-in request before showing a login page (HTTP ${rejection.statusCode}). ` +
    `The most common cause is a redirect-host allowlist: this deployment's OAuth callback host (${callbackHost}) ` +
    "is not on the provider's approved list. Self-hosted deployments with a localhost callback are typically unaffected.";
  if (rejection.vendorDetail !== "") {
    message += " Provider detail: " + rejection.vendorDetail;
  }
  return message;
}

/** 32 random bytes, base64url — CSRF state (Go generateState). */
function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Encrypts the two real secrets in the pending row — code_verifier (every
 * flow) and client_secret (vendor flow) — before they rest in SQLite, so
 * handshake secrets never leak through filesystem backups of the database
 * (oss#394; ports stigmer-cloud#294). The store itself stays a
 * byte-faithful adapter; this call site is the single write seam.
 *
 * The row is a self-contained SNAPSHOT, never an alias of the OAuthApp's
 * stored ciphertext: initiateVendorOAuth decrypts the app's secret
 * (failing loudly if the key is unavailable), and the seal re-encrypts
 * that plaintext with a fresh nonce. The token exchange must use the
 * credentials the authorization code was minted for, not whatever a later
 * resolution of the OAuthApp would return.
 *
 * The DCR path's empty client secret stays empty — never
 * ciphertext-of-"" — so completeOAuthConnect and the token exchange keep
 * seeing the emptiness that means "public client".
 *
 * Disabled encryption (no key configured) passes plaintext through with a
 * WARN, matching the deployment-wide posture for environment, OAuthApp
 * and ChannelApp secrets under the same key. A real encryption error
 * while enabled throws so the caller fails the request instead of
 * persisting plaintext.
 */
export function sealPendingOAuthState(
  secretService: SecretService,
  logger: Logger,
  state: PendingOAuthState,
): PendingOAuthState {
  if (!secretService.isEnabled()) {
    logger.warn(
      "Encryption disabled: pending OAuth state secrets will be stored in plaintext",
    );
    return state;
  }

  let sealedVerifier: string;
  try {
    sealedVerifier = secretService.encrypt(state.codeVerifier);
  } catch (error) {
    throw new Error(
      `failed to encrypt code_verifier: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let sealedSecret = state.clientSecret;
  if (state.clientSecret !== "") {
    try {
      sealedSecret = secretService.encrypt(state.clientSecret);
    } catch (error) {
      throw new Error(
        `failed to encrypt client_secret: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { ...state, codeVerifier: sealedVerifier, clientSecret: sealedSecret };
}
