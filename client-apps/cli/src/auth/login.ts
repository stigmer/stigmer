// Signing a person in to the server the CLI points at.
//
// The server says how, as it does for the desktop app: `getServerInfo()`'s
// `native_sign_in` names the issuer, the audience and the public native
// client. Nothing about any provider is compiled in. The flow:
//   1. The target: the active named backend, or, from the local daemon
//      (which trusts every caller), the reserved "cloud" entry, created at
//      Stigmer Cloud's address when it is missing.
//   2. Ask that server how it signs people in. One that trusts every caller
//      has nothing to sign in to; one that signs people in but announces no
//      native client is not set up for installed apps, and the API key is the
//      way in. A provider on another site than the server is named and
//      refused until the person says `--trust-provider` (oidc.ts says why).
//   3. Read the issuer's discovery document for its endpoints.
//   4. Sign in through the person's browser (Authorization Code with S256
//      PKCE, the callback on 127.0.0.1:17234-17236, the first free), or, with
//      `--device` or where no browser can open and the issuer offers it, with
//      a code typed on any device (device.ts).
//   5. Store the token set in that backend's entry beside the issuer and the
//      client it came from, so a refresh goes back to the same provider
//      (token.ts), and make that backend the active one.
//
// Progress goes to stderr; the command layer renders the final result. The
// address is printed before the CLI waits, so a coding agent running this in
// the background can hand it to the person.

import { createBackendClient } from "../client/index.js";
import {
  CLOUD_BACKEND_NAME,
  type Config,
  type NamedBackendConfig,
  activeBackend,
  load,
  save,
} from "../config/index.js";
import { DEFAULT_CLOUD_ENDPOINT } from "../config/resolve.js";
import { CliExitError, ExitCode } from "../errors/index.js";
import { log } from "../logger.js";
import { type BrowserOpener, canOpenBrowser, openBrowser } from "./browser.js";
import { CallbackServer } from "./callback-server.js";
import { type DeviceTiming, deviceInstructions, pollDeviceToken, realTiming, requestDeviceCode } from "./device.js";
import {
  authorizeUrl,
  type Discovery,
  discover,
  hostOf,
  type NativeSignIn,
  postTokenForm,
  providerOnServersSite,
  type TokenSet,
} from "./oidc.js";
import { challengeS256, generateState, generateVerifier } from "./pkce.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** The loopback callbacks an operator registers for the native client. */
export const LOOPBACK_PORTS: readonly number[] = [17234, 17235, 17236];
export const CALLBACK_PATH = "/auth/callback";

export interface LoginOptions {
  /** Sign in with a code typed on any device instead of a browser here. */
  readonly device?: boolean;
  /** The person's yes to a provider on another site than the server. */
  readonly trustProvider?: boolean;
}

/** What a server answers about signing in. */
export interface ServerSignIn {
  readonly authenticationRequired: boolean | undefined;
  readonly nativeSignIn: NativeSignIn | undefined;
}

/** The parts of the world a sign-in touches; tests pass their own. */
export interface LoginDeps {
  readonly readServerSignIn: (config: Config) => Promise<ServerSignIn>;
  readonly openBrowser: BrowserOpener;
  readonly canOpenBrowser: () => boolean;
  readonly progress: (text: string) => void;
  readonly timing: DeviceTiming;
  readonly ports: readonly number[];
  readonly timeoutMs: number;
}

/** Where the sign-in landed. */
export interface LoginOutcome {
  readonly backendName: string;
  readonly type: NamedBackendConfig["type"];
  readonly address: string;
  readonly provider: string;
}

export const defaultLoginDeps: LoginDeps = {
  readServerSignIn: readServerSignIn,
  openBrowser: (url) => openBrowser(url),
  canOpenBrowser: () => canOpenBrowser(),
  progress: (text) => process.stderr.write(text),
  timing: realTiming,
  ports: LOOPBACK_PORTS,
  timeoutMs: LOGIN_TIMEOUT_MS,
};

export async function login(options: LoginOptions = {}, deps: LoginDeps = defaultLoginDeps): Promise<LoginOutcome> {
  const target = signInTarget(load());
  const info = await deps.readServerSignIn(target.config);
  const signIn = admitSignIn(target, info, options);
  const discovery = await discover(signIn.issuer);

  const useDevice =
    options.device === true || (!deps.canOpenBrowser() && discovery.deviceAuthorizationEndpoint !== undefined);
  const tokens = useDevice
    ? await signInWithCode(discovery, signIn, deps)
    : await signInWithBrowser(discovery, signIn, target.address, deps);

  persist(target.name, target.entry, signIn, tokens);
  return { backendName: target.name, type: target.entry.type, address: target.address, provider: hostOf(signIn.issuer) };
}

interface SignInTarget {
  readonly name: string;
  readonly entry: NamedBackendConfig;
  readonly address: string;
  /** The config with the target active, for reading its server. */
  readonly config: Config;
}

/** The backend this sign-in is for, and the address its server answers on. */
export function signInTarget(config: Config): SignInTarget {
  const active = activeBackend(config);
  const name = active.entry === undefined ? CLOUD_BACKEND_NAME : active.name;
  const entry: NamedBackendConfig = active.entry ?? config.backends?.[CLOUD_BACKEND_NAME] ?? { type: "cloud" };
  const address =
    entry.endpoint !== undefined && entry.endpoint !== ""
      ? entry.endpoint
      : entry.type === "cloud"
        ? DEFAULT_CLOUD_ENDPOINT
        : "";
  if (address === "") {
    throw new CliExitError(`backend "${name}" has no endpoint configured`, ExitCode.Usage, [
      `Re-add it with one:  stigmer config backend add ${name} --endpoint <host:port>`,
    ]);
  }
  const override = process.env.STIGMER_SERVER_ADDRESS;
  if (override !== undefined && override !== "" && override !== address) {
    throw new CliExitError(
      `STIGMER_SERVER_ADDRESS points at ${override}, but the sign-in is for backend "${name}" at ${address}`,
      ExitCode.Usage,
      ["Unset STIGMER_SERVER_ADDRESS, or add that server as a backend and use it:",
        "  stigmer config backend add <name> --endpoint <host:port>",
        "  stigmer config backend use <name>"],
    );
  }
  return {
    name,
    entry,
    address,
    config: { ...config, backends: { ...config.backends, [name]: entry }, current_backend: name },
  };
}

/** The server's announced sign-in, or the refusal that fits what it answered. */
export function admitSignIn(target: SignInTarget, info: ServerSignIn, options: LoginOptions): NativeSignIn {
  if (info.authenticationRequired === false) {
    throw new CliExitError(`the server at ${target.address} trusts every caller: there is nothing to sign in to`, ExitCode.Usage, [
      "Commands against it work as they are, e.g.:  stigmer list agents",
    ]);
  }
  const signIn = info.nativeSignIn;
  if (signIn === undefined || signIn.issuer === "" || signIn.clientId === "") {
    throw new CliExitError(
      `the server at ${target.address} signs people in, but isn't set up for this app`,
      ExitCode.Auth,
      [
        "Its operator registers a native client for installed apps (the desktop app and this CLI).",
        "Until then, sign in to its console, create an API key, and add it:",
        `  stigmer config backend add ${target.name} --endpoint ${target.address} --api-key <key>`,
      ],
    );
  }
  if (!providerOnServersSite(target.address, signIn.issuer) && options.trustProvider !== true) {
    throw new CliExitError(
      `${hostOf(target.address)} signs people in at ${hostOf(signIn.issuer)}, on another site`,
      ExitCode.Auth,
      [
        "A server can name another site's sign-in to collect tokens that site's servers accept.",
        "If you trust this server and its provider, run:  stigmer auth login --trust-provider",
      ],
    );
  }
  return signIn;
}

async function signInWithBrowser(
  discovery: Discovery,
  signIn: NativeSignIn,
  address: string,
  deps: LoginDeps,
): Promise<TokenSet> {
  const verifier = generateVerifier();
  const state = generateState();
  const server = new CallbackServer(deps.ports, CALLBACK_PATH);
  await server.start();
  try {
    const url = authorizeUrl({
      discovery,
      signIn,
      redirectUri: server.redirectUri,
      state,
      codeChallenge: challengeS256(verifier),
    });
    deps.progress(`Signing in to ${hostOf(address)} at ${hostOf(signIn.issuer)}. Opening your browser...\n`);
    deps.progress(`If it doesn't open, visit:\n${url}\n\n`);
    try {
      await deps.openBrowser(url);
    } catch (err) {
      log.debug(`failed to open browser automatically: ${(err as Error).message}`);
      deps.progress("Could not open the browser automatically. Please open the address above.\n");
    }

    const callback = await server.waitForCallback(deps.timeoutMs);
    if (callback.state !== state) {
      throw new CliExitError("OAuth state mismatch — possible CSRF attack, aborting login", ExitCode.Auth);
    }
    return await postTokenForm(discovery.tokenEndpoint, {
      grant_type: "authorization_code",
      client_id: signIn.clientId,
      code: callback.code,
      redirect_uri: server.redirectUri,
      code_verifier: verifier,
    });
  } finally {
    await server.shutdown();
  }
}

async function signInWithCode(discovery: Discovery, signIn: NativeSignIn, deps: LoginDeps): Promise<TokenSet> {
  const code = await requestDeviceCode(discovery, signIn);
  deps.progress(deviceInstructions(code));
  return pollDeviceToken(discovery, signIn, code, deps.timing);
}

/**
 * Store the token set in the backend's entry, as the file is on disk now (a
 * command saved while the browser was open survives), and make it active.
 */
function persist(name: string, entry: NamedBackendConfig, signIn: NativeSignIn, tokens: TokenSet): void {
  const config = load();
  const backends = (config.backends ??= {});
  backends[name] = {
    ...(backends[name] ?? entry),
    token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_expiry: tokens.expiresAt,
    oidc_issuer: signIn.issuer,
    oidc_client_id: signIn.clientId,
  };
  config.current_backend = name;
  save(config);
}

/** Ask the target's server how it signs people in, with no credential. */
async function readServerSignIn(config: Config): Promise<ServerSignIn> {
  const client = createBackendClient({ config, getAccessToken: async () => null });
  await client.connect();
  const info = await client.serverInfo();
  const native = info.nativeSignIn;
  return {
    authenticationRequired: info.authenticationRequired,
    nativeSignIn:
      native === undefined ? undefined : { issuer: native.issuer, audience: native.audience, clientId: native.clientId },
  };
}
