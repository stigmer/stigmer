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
import { load, save } from "../config/index.js";
import { CliExitError, ExitCode } from "../errors/index.js";
import { log } from "../logger.js";
import { buildAuthorizeUrl, CALLBACK_PATH, CALLBACK_PORT } from "./auth0.js";
import { CallbackServer } from "./callback-server.js";
import { challengeS256, generateState, generateVerifier } from "./pkce.js";
import { exchangeCode } from "./token.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export async function login(): Promise<void> {
  const verifier = generateVerifier();
  const codeChallenge = challengeS256(verifier);
  const state = generateState();

  const server = new CallbackServer(CALLBACK_PORT, CALLBACK_PATH);
  await server.start();
  try {
    const authUrl = buildAuthorizeUrl({ state, codeChallenge });
    process.stderr.write("Opening browser for authentication...\n");
    process.stderr.write(`If the browser doesn't open automatically, visit:\n${authUrl}\n\n`);

    try {
      await open(authUrl);
    } catch (err) {
      log.debug(`failed to open browser automatically: ${(err as Error).message}`);
      process.stderr.write("Could not open the browser automatically. Please open the URL above.\n");
    }

    const callback = await server.waitForCallback(LOGIN_TIMEOUT_MS);
    if (callback.state !== state) {
      throw new CliExitError("OAuth state mismatch — possible CSRF attack, aborting login", ExitCode.Auth);
    }

    const tokens = await exchangeCode({ code: callback.code, codeVerifier: verifier });

    const config = load();
    config.backend.type = "cloud";
    config.backend.cloud = {
      ...config.backend.cloud,
      token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_expiry: tokens.expiresAt,
    };
    save(config);
  } finally {
    await server.shutdown();
  }
}
