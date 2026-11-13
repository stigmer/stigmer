// The identity provider a server names, read the way the desktop app reads it.
//
// A server that signs its callers in announces how an installed app signs a
// person in (`getServerInfo().native_sign_in`): the issuer, the audience its
// access tokens must carry and the public native client registered for
// installed apps. Nothing about any provider is built into the CLI. This module
// holds the parts every flow shares:
//   - `discover`: the issuer's `/.well-known/openid-configuration`, whose
//     `issuer` must equal the announced one exactly (the server's own reader
//     holds the same rule) and whose endpoints must be `https`, or `http` on
//     this machine; read once per process per issuer;
//   - `providerOnServersSite`: whether the provider sits on the server's own
//     site (the same registrable domain, by the Public Suffix List with its
//     private section, so `evil.github.io` and `victim.github.io` are two
//     sites; the same host; or both on this computer). A server the person was talked into
//     adding could announce another server's provider to collect tokens that
//     server accepts; a provider elsewhere is shown and needs the person's yes;
//   - `authorizeUrl`: S256 PKCE, `state`, `openid profile email
//     offline_access`, `audience` (Auth0 needs it to mint an access token for
//     the API; other providers ignore it) and `prompt=login`;
//   - `postTokenForm`: one form POST to a token or device endpoint, answered as
//     a token set or as the provider's own error code and words.

import { getDomain } from "tldts";
import { CliExitError, ExitCode } from "../errors/index.js";

/** What a server announces for an installed app's sign-in. */
export interface NativeSignIn {
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
}

/** The endpoints an issuer's discovery document names. */
export interface Discovery {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** RFC 8628's endpoint, when the issuer offers the device grant. */
  readonly deviceAuthorizationEndpoint?: string;
}

/** A provider's answer to a token request. */
export interface TokenSet {
  readonly accessToken: string;
  /** Present when `offline_access` was granted; may rotate on refresh. */
  readonly refreshToken?: string;
  /** Absolute expiry as an RFC 3339 string, derived from `expires_in`. */
  readonly expiresAt?: string;
}

export const SCOPES = "openid profile email offline_access";

/** The device grant's type (RFC 8628, section 3.4). */
export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const discovered = new Map<string, Promise<Discovery>>();

/** Where an issuer publishes its discovery document. */
export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * The endpoints a discovery document names, once it is the announced issuer's
 * own and every endpoint is one the CLI may send a person or a credential to.
 */
export function readDiscovery(expectedIssuer: string, body: unknown): Discovery {
  const document = (body ?? {}) as Record<string, unknown>;
  const authorization = document.authorization_endpoint;
  const token = document.token_endpoint;
  if (typeof document.issuer !== "string" || typeof authorization !== "string" || typeof token !== "string") {
    throw new CliExitError(
      `${expectedIssuer} published no OpenID Connect discovery document the CLI can read`,
      ExitCode.Auth,
    );
  }
  if (document.issuer !== expectedIssuer) {
    throw new CliExitError(
      `the sign-in provider says it is ${document.issuer}, but this server named ${expectedIssuer}`,
      ExitCode.Auth,
      ["Ask the server's operator to set the issuer exactly as the provider spells it."],
    );
  }
  const device =
    typeof document.device_authorization_endpoint === "string" ? document.device_authorization_endpoint : undefined;
  for (const endpoint of [authorization, token, device]) {
    if (endpoint !== undefined && !isTrustedEndpoint(endpoint)) {
      throw new CliExitError(
        `the sign-in provider names ${endpoint}, which is not https`,
        ExitCode.Auth,
        ["The CLI signs in only over https, or http on this computer."],
      );
    }
  }
  return {
    authorizationEndpoint: authorization,
    tokenEndpoint: token,
    ...(device === undefined ? {} : { deviceAuthorizationEndpoint: device }),
  };
}

/** The issuer's endpoints, read once per process. A failed read is not kept. */
export function discover(issuer: string): Promise<Discovery> {
  let pending = discovered.get(issuer);
  if (pending === undefined) {
    pending = fetchDiscovery(issuer);
    discovered.set(issuer, pending);
    pending.catch(() => discovered.delete(issuer));
  }
  return pending;
}

/** Forget every issuer read so far (tests). */
export function forgetDiscovery(): void {
  discovered.clear();
}

async function fetchDiscovery(issuer: string): Promise<Discovery> {
  if (!isTrustedEndpoint(issuer)) {
    throw new CliExitError(`the server names the sign-in provider ${issuer}, which is not https`, ExitCode.Auth, [
      "The CLI signs in only over https, or http on this computer.",
    ]);
  }
  let response: Response;
  try {
    response = await fetch(discoveryUrl(issuer));
  } catch (err) {
    throw new CliExitError(
      `failed to reach the sign-in provider ${issuer}: ${(err as Error).message}`,
      ExitCode.Connection,
    );
  }
  if (!response.ok) {
    throw new CliExitError(
      `the sign-in provider ${issuer} answered ${response.status} for its discovery document`,
      ExitCode.Auth,
    );
  }
  return readDiscovery(issuer, await response.json().catch(() => undefined));
}

/** Whether `raw` is `https`, or `http` on this machine. */
export function isTrustedEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** The host of a gRPC address (`host:port`) or a URL. */
export function hostOf(address: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `http://${address}`;
  try {
    return new URL(withScheme).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Whether `issuer` sits on the server's own site: both on this computer, the
 * same host, or the same registrable domain (`api.acme.co.uk` and
 * `id.acme.co.uk`, never two names under a public suffix).
 */
export function providerOnServersSite(serverAddress: string, issuer: string): boolean {
  const server = hostOf(serverAddress);
  const provider = hostOf(issuer);
  if (server === "" || provider === "") return false;
  if (isLoopbackHost(server) && isLoopbackHost(provider)) return true;
  if (server === provider) return true;
  // The private section too: hosting suffixes (github.io, fly.dev) give each
  // tenant its own site, as the desktop app's check does.
  const a = getDomain(server, { allowPrivateDomains: true });
  const b = getDomain(provider, { allowPrivateDomains: true });
  return a !== null && b !== null && a === b;
}

/** The authorize address for the PKCE Authorization Code flow. */
export function authorizeUrl(params: {
  readonly discovery: Discovery;
  readonly signIn: NativeSignIn;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL(params.discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.signIn.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("audience", params.signIn.audience);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  return url.toString();
}

/** A provider's refusal: its error code and, when it gave them, its words. */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly description: string | undefined,
    readonly status: number,
  ) {
    super(description === undefined || description === "" ? code : `${code}: ${description}`);
  }
}

/** POST a form and answer the JSON body; a refusal throws {@link ProviderError}. */
export async function postForm(endpoint: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    throw new CliExitError(
      `failed to reach the sign-in provider: ${(err as Error).message}`,
      ExitCode.Connection,
    );
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    const description = typeof body.error_description === "string" ? body.error_description : undefined;
    throw new ProviderError(code, description, response.status);
  }
  return body;
}

/** POST a token request and answer the token set; any refusal is an auth failure in the provider's words. */
export async function postTokenForm(tokenEndpoint: string, form: Record<string, string>): Promise<TokenSet> {
  let body: Record<string, unknown>;
  try {
    body = await postForm(tokenEndpoint, form);
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new CliExitError(`authentication failed: ${err.message}`, ExitCode.Auth);
    }
    throw err;
  }
  return tokenSetOf(body);
}

/** Normalize a successful token response. */
export function tokenSetOf(body: Record<string, unknown>): TokenSet {
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new CliExitError("authentication failed: the provider answered no access token", ExitCode.Auth);
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === "string" && body.refresh_token !== ""
      ? { refreshToken: body.refresh_token }
      : {}),
    ...(expiresIn === undefined ? {} : { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }),
  };
}
