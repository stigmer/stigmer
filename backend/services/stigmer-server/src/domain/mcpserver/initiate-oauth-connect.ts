/**
 * initiateOAuthConnect — ports
 * pkg/domain/mcpserver/controller/initiate_oauth_connect.go: start the
 * OAuth authorization flow for an MCP server. For DCR servers (no
 * oauth_app_ref): discover the authorization server, register a client
 * via RFC 7591, generate PKCE, pre-flight the authorize endpoint, return
 * the auth URL. For vendor OAuth servers: load the OAuthApp for client
 * credentials and build the auth URL from its endpoints.
 *
 * The sign-in is the caller's: the pending state records who started it
 * (a caller with no identity cannot start one), which vault it saves into
 * (`vault_id`, empty for the caller's own My vault, which needs
 * can_create_vault on the organization; a named vault must be one of the
 * request's organization the caller may edit) and the server's
 * address as it stands now, and completeOAuthConnect saves the login there
 * as a connection at that address, refusing a server whose address has
 * changed since. A server with no address (a local program with no
 * auth.discovery_url, or an HTTP server whose URL holds a ${VAR}
 * placeholder) has nowhere to save one and is refused before any round
 * trip: no discovery, client registration or pre-flight reaches the
 * vendor for a sign-in that could not be kept.
 *
 * Proven by mcpserver-oauth.conformance.test.ts
 * (CONFORMANCE_TARGET=local), __tests__/oauth-handshake.test.ts,
 * __tests__/sign-in-vault.test.ts and __tests__/store-faults.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { randomBytes } from "node:crypto";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
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
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import {
  authorizeDirect,
  authorizeResolvedResource,
} from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { PendingOAuthState } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { resolveOAuthAppRef } from "../oauthapp/refresolution.js";
import { toolAddressOf } from "../vault/address.js";
import type { McpServerConnectDeps } from "./connect.js";
import { tokenAuthMethodFromSpec } from "./oauth/refresh.js";
import { generatePkce } from "./oauth/pkce.js";
import type { PkcePair } from "./oauth/pkce.js";
import { discoverAtIssuer, discoverForResource } from "./oauth/discovery.js";
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
  // The pending state names its signer, and completion admits only that
  // caller: a state recorded with no signer would be nobody's to finish.
  if (identity.identityId === "") {
    throw new ConnectError(
      "a sign-in is saved for a signed-in caller: sign in to Stigmer first",
      Code.Unauthenticated,
    );
  }

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
    throw internalError(error, "failed to load mcp server");
  }

  // The annotation's can_connect check AFTER the load — the Java
  // McpServerInitiateOAuthConnectHandler order (load-before-authorize,
  // stigmer#224).
  await authorizeDirect(
    McpServerCommandController.method.initiateOAuthConnect,
    deps.authorizer,
    identity,
    input,
  );
  // The grant is the caller's in this organization: a credential bound to
  // another may not open one here.
  refuseBoundElsewhere(identity, input.org);

  const auth = mcpServer.spec?.auth;
  if (auth === undefined) {
    throw failedPreconditionError(
      `MCP server '${mcpServerId}' does not have an auth block configured`,
    );
  }
  await authorizeSignInVault(deps, input.org, input.vaultId, identity);

  const oauthAppRef = auth.oauthAppRef;
  const isDcr = oauthAppRef === undefined || oauthAppRef.slug === "";
  // The login is saved at the server's address, so a server with none
  // cannot keep it. Every refusal comes before the one round trip a
  // sign-in makes here (DCR's discovery and registration): a DCR server
  // with no URL at all says so first, then one with no address. The vendor
  // arm makes no round trip, and its app's own refusals come first.
  const discovery = isDcr ? dcrDiscoveryTarget(mcpServer) : undefined;
  const toolAddress = toolAddressOf(mcpServer);
  if (discovery !== undefined && toolAddress === undefined) {
    throw noAddressRefusal(mcpServer);
  }

  const pkcePair = generatePkce();
  const stateParam = generateState();

  const result =
    discovery !== undefined
      ? await initiateDcr(deps, mcpServer, discovery, pkcePair, stateParam)
      : await initiateVendorOAuth(deps, mcpServer, pkcePair, stateParam);
  if (toolAddress === undefined) {
    throw noAddressRefusal(mcpServer);
  }
  const authMethod = isDcr ? "mcp_oauth" : "vendor_oauth";

  const pendingState: PendingOAuthState = {
    state: stateParam,
    codeVerifier: pkcePair.codeVerifier,
    clientId: result.clientId,
    clientSecret: result.clientSecret,
    tokenEndpoint: result.tokenEndpoint,
    mcpServerId,
    identityAccountId: identity.identityId,
    vaultId: input.vaultId,
    toolAddress,
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
    sealed = await sealPendingOAuthState(
      deps.secretService,
      deps.logger,
      pendingState,
    );
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

/**
 * The vault a sign-in saves into must be one the caller may change: their
 * own My vault (empty id; created on the first save), or a vault of the
 * request's organization they hold can_edit on. Asked at initiate and
 * again at complete, since a grant can be revoked in between. A vault of
 * another organization answers NOT_FOUND, as a missing one does. Answers
 * the shared vault it checked, or undefined for My vault.
 */
export async function authorizeSignInVault(
  deps: McpServerConnectDeps,
  org: string,
  vaultId: string,
  identity: CallerIdentity,
): Promise<Vault | undefined> {
  if (vaultId === "") {
    await authorizeResolvedResource(
      deps.authorizer,
      identity,
      {
        permission: IamPermission.can_create_vault,
        resourceKind: ApiResourceKind.organization,
        resourceId: org,
      },
      "unauthorized to keep a My vault in this organization: only its members do",
    );
    return undefined;
  }
  const vault = await deps.vaults.findById(vaultId);
  if (vault === undefined || (vault.metadata?.org ?? "") !== org) {
    throw notFoundError("vault", vaultId);
  }
  await authorizeResolvedResource(
    deps.authorizer,
    identity,
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.vault,
      resourceId: vaultId,
    },
    "unauthorized to save a sign-in in this vault",
  );
  return vault;
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

/**
 * The refusal for a server with no address to save a sign-in at, saying
 * why: an HTTP server's URL that names no fixed address (a ${VAR}
 * placeholder in it), or a local program with no auth.discovery_url.
 */
function noAddressRefusal(mcpServer: McpServer): ConnectError {
  const id = mcpServer.metadata?.id ?? "";
  const serverType = mcpServer.spec?.serverType;
  if (serverType?.case === "http") {
    const why = serverType.value.url.includes("${")
      ? "its URL holds a ${VAR} placeholder, so it names no fixed address"
      : "its URL is not a fixed http or https URL";
    return failedPreconditionError(
      `MCP server '${id}' has no address to save a sign-in at: ${why}. Give the server a fixed URL to sign in to it`,
    );
  }
  return failedPreconditionError(
    `MCP server '${id}' has no address to save a sign-in at: a local program needs ` +
      "auth.discovery_url (its login server's URL)",
  );
}

/** Where DCR discovers the login server: the URLs it reads, and the one it names. */
interface DcrDiscoveryTarget {
  readonly discoveryUrl: string;
  readonly resourceUrl: string;
  readonly serverUrl: string;
}

/**
 * Resolves the URL for OAuth authorization server discovery, refusing a
 * server with none. Priority: auth.discovery_url > http.url —
 * discovery_url is the author naming the login server itself (and the
 * only route for a stdio server, which has no HTTP URL) and is read as an
 * issuer; http.url is the protected resource, whose login server the RFC
 * 9728 walk finds (oauth/discovery.ts).
 */
function dcrDiscoveryTarget(mcpServer: McpServer): DcrDiscoveryTarget {
  const discoveryUrl = mcpServer.spec?.auth?.discoveryUrl ?? "";
  const serverType = mcpServer.spec?.serverType;
  const resourceUrl = serverType?.case === "http" ? serverType.value.url : "";
  const serverUrl = discoveryUrl !== "" ? discoveryUrl : resourceUrl;
  if (serverUrl === "") {
    throw failedPreconditionError(
      `DCR requires a discoverable URL. MCP server '${mcpServer.metadata?.id ?? ""}' has no http.url and no auth.discovery_url. ` +
        "Set auth.discovery_url for stdio servers, oauth_app_ref for vendor OAuth, or switch to HTTP transport",
    );
  }
  return { discoveryUrl, resourceUrl, serverUrl };
}

async function initiateDcr(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  target: DcrDiscoveryTarget,
  pkcePair: PkcePair,
  stateParam: string,
): Promise<InitiateResult> {
  const { discoveryUrl, resourceUrl, serverUrl } = target;

  let metadata;
  try {
    metadata =
      discoveryUrl !== ""
        ? await discoverAtIssuer(discoveryUrl, deps.outboundFetch)
        : await discoverForResource(resourceUrl, deps.outboundFetch);
  } catch (error) {
    throw failedPreconditionError(
      `OAuth authorization server discovery failed for ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (metadata.registrationEndpoint === "") {
    // A login server without RFC 7591 registration cannot take a client
    // Stigmer mints on the spot; the sentence keeps its opening (the
    // conformance suite's pin before this clause joined it) and tells the
    // user the one thing that helps: an OAuth app registered with the
    // vendor, referenced from the server's definition.
    throw failedPreconditionError(
      `MCP server at ${serverUrl} does not advertise a registration_endpoint for DCR: ` +
        `${loginServerHost(metadata, serverUrl)} does not allow automatic client registration, so this server needs ` +
        "an OAuth app registered with the vendor and referenced from its definition (auth.oauth_app_ref)",
    );
  }

  const clientName = `Stigmer (${mcpServer.metadata?.name ?? ""})`;
  let dcrResponse;
  try {
    dcrResponse = await registerClient(
      metadata.registrationEndpoint,
      deps.oauthRedirectUri,
      clientName,
      deps.outboundFetch,
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
    rejection = await preflightAuthorize(authUrl, deps.outboundFetch);
  } catch (probeError) {
    deps.logger.debug("authorize pre-flight probe inconclusive; proceeding", {
      mcp_server_id: mcpServer.metadata?.id ?? "",
      error:
        probeError instanceof Error ? probeError.message : String(probeError),
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

/** The login server a user must register with: its metadata's issuer, else its authorization endpoint, else the URL we asked. */
function loginServerHost(metadata: { issuer: string; authorizationEndpoint: string }, serverUrl: string): string {
  for (const candidate of [metadata.issuer, metadata.authorizationEndpoint, serverUrl]) {
    try {
      const host = new URL(candidate).host;
      if (host !== "") return host;
    } catch {
      // Not a URL; try the next candidate.
    }
  }
  return serverUrl;
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
      clientSecret = await deps.secretService.decrypt(clientSecret);
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
 * (oss#394). The store itself stays a
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
 * WARN, matching the deployment-wide posture for vault, OAuthApp and
 * ChannelApp secrets under the same key. A real encryption error
 * while enabled throws so the caller fails the request instead of
 * persisting plaintext.
 */
export async function sealPendingOAuthState(
  secretService: SecretService,
  logger: Logger,
  state: PendingOAuthState,
): Promise<PendingOAuthState> {
  if (!secretService.isEnabled()) {
    logger.warn(
      "Encryption disabled: pending OAuth state secrets will be stored in plaintext",
    );
    return state;
  }

  // Tenancy-only scope from the row's own org (proto-required min_len 1
  // on the initiate input, so never empty here) — the handshake ephemera
  // seal under the caller's org exactly like the durable rows they
  // snapshot from.
  const scope = EncryptionScope.forOrganization(state.org);

  let sealedVerifier: string;
  try {
    sealedVerifier = await secretService.encrypt(state.codeVerifier, scope);
  } catch (error) {
    throw new Error(
      `failed to encrypt code_verifier: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let sealedSecret = state.clientSecret;
  if (state.clientSecret !== "") {
    try {
      sealedSecret = await secretService.encrypt(state.clientSecret, scope);
    } catch (error) {
      throw new Error(
        `failed to encrypt client_secret: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { ...state, codeVerifier: sealedVerifier, clientSecret: sealedSecret };
}
