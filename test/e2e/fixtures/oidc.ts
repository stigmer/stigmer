/**
 * The OIDC stack shape's one set of coordinates (20260913.02 sp.console-login,
 * Q-CL-7), read by playwright.config.ts (to give `next dev` its
 * NEXT_PUBLIC_* before anything runs), by global-setup.ts (to spawn the
 * issuer and boot the server in the posture) and by the console-login spec
 * (to recognise the issuer's origin). Defined once so the three can never
 * disagree — the console, the server and the issuer must all name the same
 * issuer URL, audience and client id or the sign-in fails somewhere silent.
 *
 * The issuer itself is the conformance harness's hermetic local issuer, run
 * as a PROCESS (`local-oidc-issuer-main.ts`): the e2e package never imports
 * across test packages.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export const OIDC_STACK =
  process.env.STIGMER_E2E_OIDC === "1" ||
  process.env.STIGMER_E2E_OIDC === "true";

/** The issuer's pinned port: the config must know the URL before the browser starts. */
export const OIDC_ISSUER_PORT = Number(
  process.env.STIGMER_E2E_OIDC_PORT ?? "7299",
);
export const OIDC_ISSUER = `http://127.0.0.1:${OIDC_ISSUER_PORT}`;
/** Any value the server is told to expect; a fixture constant, not a contract. */
export const OIDC_AUDIENCE = "https://e2e.stigmer.test/api";
/** The console's public PKCE client, as an operator would register it. */
export const OIDC_CONSOLE_CLIENT_ID = "stigmer-console";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ISSUER_MAIN = path.join(
  REPO_ROOT,
  "test/conformance/src/harness/local-oidc-issuer-main.ts",
);
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");

/** What the issuer process prints once it is listening. */
export interface IssuerReady {
  readonly issuer: string;
  readonly audience: string;
  readonly person: { readonly sub: string; readonly email: string };
}

/**
 * Spawn the hermetic issuer on the pinned port with RP-initiated logout on
 * (`--end-session`), so the e2e run drives the sign-out arm a real
 * Keycloak/Auth0/Okta would; the local-only arm is pinned by the console's
 * unit tests. Resolves once the process has printed its ready line.
 */
export function startIssuerProcess(): Promise<{
  child: ChildProcess;
  ready: IssuerReady;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX,
      [
        ISSUER_MAIN,
        "--port",
        String(OIDC_ISSUER_PORT),
        "--audience",
        OIDC_AUDIENCE,
        "--end-session",
      ],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffered = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error("[e2e] the OIDC issuer did not report ready within 20s"),
      );
    }, 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      const ready = JSON.parse(buffered.slice(0, newline)) as IssuerReady;
      resolve({ child, ready });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[e2e:issuer] ${chunk.toString("utf8")}`);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `[e2e] the OIDC issuer exited before it was ready (code ${String(code)})`,
        ),
      );
    });
  });
}
