// Signing in with a code typed on any device (OAuth 2.0 Device Authorization
// Grant, RFC 8628), for a machine where no browser can open: an SSH session,
// a remote sandbox, a coding agent's container.
//
// 1. POST the issuer's `device_authorization_endpoint` (from its discovery
//    document) with the native client, the scopes and the audience; the
//    answer is a device code, a short user code and the address to type it at.
// 2. Tell the person: the address, the code, and the address with the code
//    filled in when the issuer gives one.
// 3. Poll the token endpoint with the device grant at the issuer's interval:
//    `authorization_pending` waits, `slow_down` adds five seconds (section
//    3.5), `access_denied` and `expired_token` end it in plain words.

import { CliExitError, ExitCode } from "../errors/index.js";
import {
  DEVICE_CODE_GRANT,
  type Discovery,
  type NativeSignIn,
  postForm,
  ProviderError,
  SCOPES,
  type TokenSet,
  tokenSetOf,
} from "./oidc.js";

/** What the issuer answered for a device sign-in, as the person sees it. */
export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

/** The waits and clock a device sign-in uses; tests pass their own. */
export interface DeviceTiming {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_SECONDS = 5;

export const realTiming: DeviceTiming = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Ask the issuer for a device code. */
export async function requestDeviceCode(discovery: Discovery, signIn: NativeSignIn): Promise<DeviceCode> {
  const endpoint = discovery.deviceAuthorizationEndpoint;
  if (endpoint === undefined) {
    throw new CliExitError("this server's sign-in provider doesn't offer sign-in with a code", ExitCode.Auth, [
      "Sign in from a machine with a browser (stigmer auth login), or use an API key:",
      "  stigmer apikey create --name cli   (on a machine that is signed in)",
      "  stigmer config backend add <name> --endpoint <host:port> --api-key <key>",
    ]);
  }
  let body: Record<string, unknown>;
  try {
    body = await postForm(endpoint, {
      client_id: signIn.clientId,
      scope: SCOPES,
      audience: signIn.audience,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new CliExitError(`the sign-in provider refused a sign-in with a code: ${err.message}`, ExitCode.Auth, [
        err.code === "unauthorized_client"
          ? "The server's operator has to allow the device grant for its native client."
          : "Sign in from a machine with a browser instead: stigmer auth login",
      ]);
    }
    throw err;
  }
  const deviceCode = body.device_code;
  const userCode = body.user_code;
  const verificationUri = body.verification_uri ?? body.verification_url;
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUri !== "string") {
    throw new CliExitError("the sign-in provider answered no code to sign in with", ExitCode.Auth);
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(typeof body.verification_uri_complete === "string"
      ? { verificationUriComplete: body.verification_uri_complete }
      : {}),
    expiresInSeconds: typeof body.expires_in === "number" ? body.expires_in : 600,
    intervalSeconds: typeof body.interval === "number" && body.interval > 0 ? body.interval : DEFAULT_INTERVAL_SECONDS,
  };
}

/** The lines that tell the person where to type the code. */
export function deviceInstructions(code: DeviceCode): string {
  const lines = [`To sign in, open ${code.verificationUri} and enter ${code.userCode}`];
  if (code.verificationUriComplete !== undefined) {
    lines.push(`or open ${code.verificationUriComplete}`);
  }
  lines.push(`The code works for ${Math.round(code.expiresInSeconds / 60)} minutes. Waiting...`);
  return `${lines.join("\n")}\n`;
}

/** Poll the token endpoint until the person approves, refuses, or the code expires. */
export async function pollDeviceToken(
  discovery: Discovery,
  signIn: NativeSignIn,
  code: DeviceCode,
  timing: DeviceTiming = realTiming,
): Promise<TokenSet> {
  const deadline = timing.now() + code.expiresInSeconds * 1000;
  let interval = code.intervalSeconds;
  for (;;) {
    await timing.sleep(interval * 1000);
    if (timing.now() > deadline) throw expired();
    try {
      const body = await postForm(discovery.tokenEndpoint, {
        grant_type: DEVICE_CODE_GRANT,
        device_code: code.deviceCode,
        client_id: signIn.clientId,
      });
      return tokenSetOf(body);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      switch (err.code) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += SLOW_DOWN_SECONDS;
          continue;
        case "expired_token":
          throw expired();
        case "access_denied":
          throw new CliExitError("the sign-in was refused on the other device", ExitCode.Auth, [
            "Run 'stigmer auth login --device' to try again.",
          ]);
        default:
          throw new CliExitError(`the sign-in provider ended the sign-in: ${err.message}`, ExitCode.Auth, [
            "Run 'stigmer auth login --device' to try again.",
          ]);
      }
    }
  }
}

function expired(): CliExitError {
  return new CliExitError("the sign-in code expired before it was entered", ExitCode.Auth, [
    "Run 'stigmer auth login --device' for a new code.",
  ]);
}
