// Browser-based PKCE OAuth login orchestration.
//
// Flow:
//   1. Start a loopback server to receive the Auth0 callback.
//   2. Open the browser to /authorize with a PKCE code_challenge.
//   3. Wait for the redirect carrying the authorization code (5-min timeout).
//   4. Validate the state parameter (CSRF), then exchange code -> tokens.
//   5. Persist tokens and switch the backend to cloud mode.
//
// Progress goes to stderr; the command layer renders the final result.

import open from "open";
import {
  CLOUD_BACKEND_NAME,
  activeBackend,
  load,
  save,
} from "../config/index.js";
import { CliExitError, ExitCode } from "../errors/index.js";
import { log } from "../logger.js";
import { buildAuthorizeUrl, CALLBACK_PATH, CALLBACK_PORT } from "./auth0.js";
import { CallbackServer } from "./callback-server.js";
import { challengeS256, generateState, generateVerifier } from "./pkce.js";
import { exchangeCode } from "./token.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export async function login(): Promise<void> {
  // Browser PKCE targets Stigmer Cloud only: the Auth0 coordinates are
  // compiled in. From the local backend, login lands on (creating if
  // needed) the reserved "cloud" entry — today's behavior in the named
  // model. On a selfhost backend the flow refuses with the self-host
  // credential story (API tokens) instead of silently writing cloud
  // credentials the active backend would never send.
  const preflight = load();
  const { name, entry } = activeBackend(preflight);
  if (entry?.type === "selfhost") {
    throw new CliExitError(
      `backend "${name}" is self-hosted — browser login targets Stigmer Cloud only`,
      ExitCode.Usage,
      [
        "Authenticate a self-hosted backend with an API token:",
        "  stigmer apikey create --name cli",
        `  stigmer config backend add ${name} --endpoint <host:port> --api-key <key>`,
        "or switch first:  stigmer config backend use cloud",
      ],
    );
  }

  const verifier = generateVerifier();
  const codeChallenge = challengeS256(verifier);
  const state = generateState();

  const server = new CallbackServer(CALLBACK_PORT, CALLBACK_PATH);
  await server.start();
  try {
    const authUrl = buildAuthorizeUrl({ state, codeChallenge });
    process.stderr.write("Opening browser for authentication...\n");
    process.stderr.write(
      `If the browser doesn't open automatically, visit:\n${authUrl}\n\n`,
    );

    try {
      await open(authUrl);
    } catch (err) {
      log.debug(
        `failed to open browser automatically: ${(err as Error).message}`,
      );
      process.stderr.write(
        "Could not open the browser automatically. Please open the URL above.\n",
      );
    }

    const callback = await server.waitForCallback(LOGIN_TIMEOUT_MS);
    if (callback.state !== state) {
      throw new CliExitError(
        "OAuth state mismatch — possible CSRF attack, aborting login",
        ExitCode.Auth,
      );
    }

    const tokens = await exchangeCode({
      code: callback.code,
      codeVerifier: verifier,
    });

    const config = load();
    const active = activeBackend(config);
    // A cloud-type backend keeps its own login; anything else (the local
    // daemon) lands on the reserved "cloud" entry and switches to it.
    const targetName =
      active.entry?.type === "cloud" ? active.name : CLOUD_BACKEND_NAME;
    const backends = (config.backends ??= {});
    backends[targetName] = {
      ...(backends[targetName] ?? { type: "cloud" }),
      type: "cloud",
      token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_expiry: tokens.expiresAt,
    };
    config.current_backend = targetName;
    save(config);
  } finally {
    await server.shutdown();
  }
}
