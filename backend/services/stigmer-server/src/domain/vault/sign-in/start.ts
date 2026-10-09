/**
 * Starting a sign-in at an address: the one start every door shares (a
 * person's `startSignIn` on the vault, a Connect link's
 * `startConnectLink`). The door authorizes; this finds the client, builds
 * the login page's URL and records the pending state.
 *
 * The client comes from one order (login-app.ts, client.ts):
 *
 *   1. the organization's own login app for the address;
 *   2. Stigmer's own login app for it (the catalog, switched on by
 *      settings);
 *   3. for a tool's URL only, the address's own login server, found by the
 *      RFC 9728 walk from the address: a Client ID Metadata Document where
 *      the login server takes one and the deployment is public, else a
 *      client registered once per login server;
 *   4. otherwise a refusal naming the address: "add a login app for it, or
 *      paste a token". A Git host (a bare host such as github.com) is no
 *      protected resource and stops at 2.
 *
 * A request to a login server found in step 3 carries `resource` (RFC
 * 8707): the MCP Authorization specification requires it, and a login
 * server that honours it mints a token for that address only, so a server
 * whose metadata names someone else's login server cannot obtain a token
 * minted for that someone. A login app's vendor endpoint is not asked for
 * it: those are not MCP login servers and may refuse an unknown parameter.
 * The scopes asked are the address's own `scopes_supported`, else the login
 * server's, else none; through an app, the app's.
 *
 * The login page sends the person back to a redirect the server builds
 * from the caller's choice (`signInRedirectUri`), never a URL the caller
 * writes: the console's callback, the same with the desktop bridge, or the
 * desktop's own page on a loopback port (RFC 8252 section 7.3).
 *
 * For a client registered with the login server, the authorize URL is
 * probed before the person is sent there (preflight.ts): a login server
 * that refuses the client outright (one it has forgotten) is given a new
 * registration once, and one that still refuses is reported here instead of
 * on a vendor error page inside the popup.
 *
 * Every outbound request goes through the deployment's egress guard
 * (`fetchImpl`), which matters because any member may name any address.
 * The handshake's secrets rest sealed (`sealPendingOAuthState`).
 *
 * Proven by __tests__/start.test.ts, __tests__/person.test.ts,
 * __tests__/faults.test.ts and the sign-in conformance suite.
 */
import { randomBytes } from "node:crypto";

import type { OutboundFetch } from "@stigmer/outbound/egress";

import { CONSOLE_OAUTH_CALLBACK_PATH } from "../../../boot/oauth-redirect-uri.js";
import type { Logger } from "../../../boot/logger.js";
import type { SecretService } from "../../../encryption/encryption.js";
import { EncryptionScope } from "../../../encryption/encryption.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../../pipeline/errors.js";
import type {
  OAuthClientRegistrationStore,
  PendingOAuthState,
  PendingOAuthStateStore,
  Store,
} from "../../../store/interface.js";
import { InvalidAddressError, isGitHostAddress, normalizeAddress } from "../address.js";
import { SIGN_IN_THROUGH_APP, SIGN_IN_THROUGH_LOGIN_SERVER } from "../constants.js";
import { findLoginApp } from "../login-app.js";
import type { AppLogin } from "../login-app.js";
import type { LoginProviderSettings } from "../login-providers.js";
import {
  ClientRegistrationError,
  NoSignInClientError,
  canObtainClient,
  obtainClient,
  replaceClient,
} from "./client.js";
import type { SignInClient } from "./client.js";
import { discoverForResource } from "./discovery.js";
import type { DiscoveredLoginServer } from "./discovery.js";
import { loginEndpointProblem } from "./endpoint.js";
import { generatePkce } from "./pkce.js";
import type { PkcePair } from "./pkce.js";
import { preflightAuthorize } from "./preflight.js";
import type { AuthorizeRejection } from "./preflight.js";

/** What a sign-in needs from the composition. */
export interface SignInDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly pendingOAuthStates: PendingOAuthStateStore;
  readonly clientRegistrations: OAuthClientRegistrationStore;
  /** Stigmer's own login apps switched on. */
  readonly loginProviders: LoginProviderSettings;
  /** The console's callback page; "" when the deployment has none (only a loopback sign-in can start then). */
  readonly oauthRedirectUri: string;
  /** Stigmer's Client ID Metadata Document URL; "" when the deployment has no public https origin. */
  readonly clientDocumentUrl: string;
  /** The egress-guarded fetch every login server is dialled with. */
  readonly outboundFetch: OutboundFetch;
}

/** Where the login page sends the person back to. */
export type SignInReturn =
  | { readonly kind: "web" }
  | { readonly kind: "desktop" }
  | { readonly kind: "loopback"; readonly port: number };

/** One sign-in to start: who it is for and where it saves. */
export interface SignInStart {
  readonly org: string;
  /** The vault it saves into; "" for the signer's My vault. */
  readonly vaultId: string;
  /** The address as the caller gave it; normalized here. */
  readonly address: string;
  readonly returnTo: SignInReturn;
  /** The signer; "" for a Connect link's sign-in, which has none. */
  readonly signer: string;
  /** The Connect link's SHA-256; "" for a person's sign-in. */
  readonly connectLink: string;
}

/** The login page to send the person to. */
export interface StartedSignIn {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly providerName: string;
  readonly scopes: readonly string[];
  /** The normalized address the login will be saved at. */
  readonly address: string;
}

/** The query parameter the console's callback page reads to hand a sign-in on to the desktop app. */
export const DESKTOP_RETURN_PARAM = "source";
const DESKTOP_RETURN_VALUE = "desktop";

/**
 * The redirect URI for a return choice. The web and desktop forms need the
 * deployment's callback page; the loopback form is the desktop's own page
 * on this machine.
 */
export function signInRedirectUri(oauthRedirectUri: string, returnTo: SignInReturn): string {
  if (returnTo.kind === "loopback") {
    return `http://127.0.0.1:${returnTo.port}${CONSOLE_OAUTH_CALLBACK_PATH}`;
  }
  if (oauthRedirectUri === "") {
    throw failedPreconditionError(
      "sign-in is not configured: STIGMER_OAUTH_REDIRECT_URI is not set",
    );
  }
  if (returnTo.kind === "desktop") {
    const separator = oauthRedirectUri.includes("?") ? "&" : "?";
    return `${oauthRedirectUri}${separator}${DESKTOP_RETURN_PARAM}=${DESKTOP_RETURN_VALUE}`;
  }
  return oauthRedirectUri;
}

/** The normalized address, or INVALID_ARGUMENT with the rule. */
export function signInAddress(input: string): string {
  try {
    return normalizeAddress(input);
  } catch (error) {
    throw error instanceof InvalidAddressError ? invalidArgumentError(error.message) : error;
  }
}

/** The refusal for an address nothing can sign in to, with what helps. */
export function noLoginRefusal(address: string, why: string): Error {
  return failedPreconditionError(
    `nothing can sign in to ${address}${why === "" ? "" : `: ${why}`}. Add a login app for ${address} in Settings, or paste a token`,
  );
}

/** Starts a sign-in: finds its client, records the pending state, answers the login page. */
export async function startSignIn(deps: SignInDeps, start: SignInStart): Promise<StartedSignIn> {
  const address = signInAddress(start.address);
  const redirectUri = signInRedirectUri(deps.oauthRedirectUri, start.returnTo);
  const pkce = generatePkce();
  const state = generateState();

  const app = await findLoginApp(deps, start.org, address);
  const planned =
    app !== undefined
      ? throughApp(app, redirectUri, pkce, state)
      : await throughLoginServer(deps, address, redirectUri, pkce, state);

  const pending: PendingOAuthState = {
    state,
    codeVerifier: pkce.codeVerifier,
    clientId: planned.clientId,
    clientSecret: planned.clientSecret,
    tokenEndpoint: planned.tokenEndpoint,
    identityAccountId: start.signer,
    authMethod: app !== undefined ? SIGN_IN_THROUGH_APP : SIGN_IN_THROUGH_LOGIN_SERVER,
    tokenAuthMethod: planned.tokenAuthMethod,
    redirectUri,
    org: start.org,
    vaultId: start.vaultId,
    address,
    loginApp: app?.ref ?? "",
    resource: planned.resource,
    clientRegistration: planned.registration,
    connectLink: start.connectLink,
    providerName: planned.providerName,
    userinfoUrl: planned.userinfoUrl,
    createdAt: 0,
  };

  // Fail-closed: an encryption error fails the request; plaintext never
  // reaches the store.
  let sealed: PendingOAuthState;
  try {
    sealed = await sealPendingOAuthState(deps.secretService, deps.logger, pending);
  } catch (error) {
    throw internalError(error, "failed to encrypt OAuth handshake secrets");
  }
  try {
    await deps.pendingOAuthStates.save(sealed);
  } catch (error) {
    throw internalError(error, "failed to save pending OAuth state");
  }

  deps.logger.info("Sign-in started", {
    address,
    login_app: pending.loginApp === "" ? "login server" : pending.loginApp,
    connect_link: start.connectLink !== "",
  });
  return {
    authorizationUrl: planned.authorizationUrl,
    state,
    providerName: planned.providerName,
    scopes: planned.scopes,
    address,
  };
}

/**
 * Whether anything can sign in at an address, asked without registering a
 * client or recording a state: a login app for it, or (for a tool's URL)
 * a login server it leads to that can give Stigmer a client. A Connect
 * link is refused at creation without one, so it never sends a customer
 * to a dead end.
 */
export async function signInAvailable(
  deps: SignInDeps,
  org: string,
  address: string,
): Promise<{ readonly available: true; readonly providerName: string } | { readonly available: false; readonly why: string }> {
  const app = await findLoginApp(deps, org, address);
  if (app !== undefined) {
    return app.unavailable === undefined
      ? { available: true, providerName: app.providerName }
      : { available: false, why: app.unavailable };
  }
  if (isGitHostAddress(address)) {
    return { available: false, why: "no login app serves this Git host" };
  }
  let discovered: DiscoveredLoginServer;
  try {
    discovered = await discoverForResource(address, deps.outboundFetch);
  } catch (error) {
    return { available: false, why: error instanceof Error ? error.message : String(error) };
  }
  return canObtainClient(discovered.metadata, deps.clientDocumentUrl)
    ? { available: true, providerName: hostOf(address) }
    : { available: false, why: "its login server does not allow automatic client registration" };
}

/** The pieces of a sign-in its client decides. */
interface PlannedSignIn {
  readonly authorizationUrl: string;
  readonly providerName: string;
  readonly scopes: readonly string[];
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenEndpoint: string;
  readonly tokenAuthMethod: string;
  readonly resource: string;
  readonly registration: string;
  readonly userinfoUrl: string;
}

function throughApp(app: AppLogin, redirectUri: string, pkce: PkcePair, state: string): PlannedSignIn {
  if (app.unavailable !== undefined) {
    throw failedPreconditionError(app.unavailable);
  }
  const endpoints: [string, string][] = [
    ["authorization URL", app.authorizationUrl],
    ["token URL", app.tokenUrl],
  ];
  if (app.userinfoUrl !== "") endpoints.push(["user-info URL", app.userinfoUrl]);
  for (const [field, value] of endpoints) {
    const problem = loginEndpointProblem(value);
    if (problem !== undefined) {
      throw failedPreconditionError(`the login app for '${app.providerName}': its ${field} ${problem}`);
    }
  }
  return {
    authorizationUrl: buildAuthorizationUrl(
      app.authorizationUrl,
      app.clientId,
      redirectUri,
      pkce.codeChallenge,
      state,
      app.scopes,
      app.scopeParameterName,
    ),
    providerName: app.providerName,
    scopes: app.scopes,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    tokenEndpoint: app.tokenUrl,
    tokenAuthMethod: app.tokenAuthMethod,
    resource: "",
    registration: "",
    userinfoUrl: app.userinfoUrl,
  };
}

async function throughLoginServer(
  deps: SignInDeps,
  address: string,
  redirectUri: string,
  pkce: PkcePair,
  state: string,
): Promise<PlannedSignIn> {
  if (isGitHostAddress(address)) {
    throw noLoginRefusal(address, "no login app serves this Git host");
  }
  let discovered: DiscoveredLoginServer;
  try {
    discovered = await discoverForResource(address, deps.outboundFetch);
  } catch (error) {
    throw noLoginRefusal(address, error instanceof Error ? error.message : String(error));
  }
  const { metadata, resourceScopes } = discovered;
  const scopes = resourceScopes.length > 0 ? resourceScopes : metadata.scopesSupported;
  const clientDeps = {
    registrations: deps.clientRegistrations,
    fetchImpl: deps.outboundFetch,
    clientDocumentUrl: deps.clientDocumentUrl,
  };
  const providerName = hostOf(address);

  let client: SignInClient;
  try {
    client = await obtainClient(clientDeps, metadata, redirectUri);
  } catch (error) {
    throw clientRefusal(address, error);
  }
  const urlFor = (clientId: string): string =>
    buildAuthorizationUrl(
      metadata.authorizationEndpoint,
      clientId,
      redirectUri,
      pkce.codeChallenge,
      state,
      scopes,
      "scope",
      address,
    );

  let authorizationUrl = urlFor(client.clientId);
  let rejection = await preflight(deps, authorizationUrl, address);
  if (rejection !== undefined && client.registration !== "" && !client.fresh && refusesTheClient(rejection)) {
    // A kept client the login server refuses as unknown is one it has
    // forgotten: register a new one, once. Any other refusal (a redirect
    // the login server does not allow) a new client would not cure, and
    // re-registering would churn the client every organization shares.
    deps.logger.info("The login server refused a kept client; registering a new one", { address });
    try {
      client = await replaceClient(clientDeps, metadata, redirectUri, client);
    } catch (error) {
      throw clientRefusal(address, error);
    }
    authorizationUrl = urlFor(client.clientId);
    rejection = await preflight(deps, authorizationUrl, address);
  }
  if (rejection !== undefined) {
    deps.logger.warn("authorization endpoint rejected the sign-in request pre-flight", {
      status_code: rejection.statusCode,
      address,
      body_snippet: rejection.bodySnippet,
    });
    throw failedPreconditionError(dcrRejectionMessage(providerName, redirectUri, rejection));
  }

  return {
    authorizationUrl,
    providerName,
    scopes,
    clientId: client.clientId,
    clientSecret: "",
    tokenEndpoint: metadata.tokenEndpoint,
    tokenAuthMethod: "",
    resource: address,
    registration: client.registration,
    userinfoUrl: "",
  };
}

/**
 * Nothing to sign in with, the login server's refusal of a registration,
 * or a fault keeping the client (the store's, answered as a fault, never
 * blamed on the login server).
 */
function clientRefusal(address: string, error: unknown): Error {
  if (error instanceof NoSignInClientError) {
    return noLoginRefusal(address, error.message);
  }
  if (error instanceof ClientRegistrationError) {
    return failedPreconditionError(`registering Stigmer with the login server for ${address} failed: ${error.message}`);
  }
  return internalError(error, "failed to keep Stigmer's client for the login server");
}

/** Whether a pre-flight refusal is about the client itself, the one refusal a new registration can cure. */
function refusesTheClient(rejection: AuthorizeRejection): boolean {
  return /invalid_client|unknown client|client.{0,20}not (found|registered|recognized)/i.test(
    `${rejection.vendorDetail} ${rejection.bodySnippet}`,
  );
}

/** The pre-flight probe, fail-open: only a definite rejection is answered. */
async function preflight(
  deps: SignInDeps,
  authorizationUrl: string,
  address: string,
): Promise<AuthorizeRejection | undefined> {
  try {
    return await preflightAuthorize(authorizationUrl, deps.outboundFetch);
  } catch (error) {
    deps.logger.debug("authorize pre-flight probe inconclusive; proceeding", {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/** The host of a tool's URL, or a Git host as it is. */
export function hostOf(address: string): string {
  return URL.canParse(address) ? new URL(address).host : address;
}

/**
 * Builds the authorization URL (Go buildAuthorizationURL). Parameters are
 * rendered SORTED by key — Go's url.Values.Encode() sorts, and the
 * conformance suite asserts the exact parameter set — with
 * form-urlencoding (spaces as +, both editions). `resource` (RFC 8707) is
 * added for a login server found by the address's own metadata.
 */
export function buildAuthorizationUrl(
  authEndpoint: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
  scopes: readonly string[],
  scopeParamName: string,
  resource = "",
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
  if (resource !== "") {
    params.set("resource", resource);
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
 * can act on it. Surfaces which render start errors pass this text
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
 * flow) and client_secret (a login app's) — before they rest in the store,
 * so handshake secrets never leak through filesystem backups of the
 * database (oss#394). The store itself stays a byte-faithful adapter; this
 * call site is the single write seam.
 *
 * The row is a self-contained SNAPSHOT: the app's secret was opened at
 * start (failing loudly if the key is unavailable), and the seal
 * re-encrypts that plaintext with a fresh nonce. The token exchange must use
 * the credentials the authorization code was minted for, not whatever a
 * later read of the app would return.
 *
 * A public client's empty secret stays empty — never ciphertext-of-"" — so
 * completion and the token exchange keep seeing the emptiness that means
 * "public client".
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

  // Tenancy-only scope from the row's own org — the handshake ephemera
  // seal under the vault's organization exactly like the durable rows
  // they snapshot from.
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
