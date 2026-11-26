/**
 * The OIDC stack shape's one set of coordinates, read by playwright.config.ts
 * (to give `next dev` its NEXT_PUBLIC_* before anything runs), by
 * global-setup.ts (to spawn the issuer and boot the server in the posture)
 * and by the console-login spec (to recognise the issuer's origin). Defined
 * once so the three can never disagree — the console, the server and the
 * issuer must all name the same issuer URL, audience and client id or the
 * sign-in fails somewhere silent.
 *
 * The issuer itself is test/support's hermetic local issuer, run as a
 * PROCESS (`test/support/src/local-oidc-issuer-main.ts`) like the stack's
 * servers, so it serves every Playwright worker from one place.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export const OIDC_STACK =
  process.env.STIGMER_E2E_OIDC === "1" ||
  process.env.STIGMER_E2E_OIDC === "true";

/**
 * The first-hour journey's own boot of the OIDC stack
 * (STIGMER_E2E_FIRST_HOUR, `make test-e2e-first-hour`): its runner starts
 * signed in, as a self-hosted server's does (the key the server stores as
 * its `runner` service account's at boot), so listing a tool server's tools
 * works as it does there. The console-login job's boot leaves it out: the
 * In your app tab counts that account as the backend's
 * (stigmer/stigmer#3478), which its spec would meet.
 */
export const FIRST_HOUR_STACK =
  process.env.STIGMER_E2E_FIRST_HOUR === "1" ||
  process.env.STIGMER_E2E_FIRST_HOUR === "true";

/** The issuer's pinned port: the config must know the URL before the browser starts. */
export const OIDC_ISSUER_PORT = Number(
  process.env.STIGMER_E2E_OIDC_PORT ?? "7299",
);
export const OIDC_ISSUER = `http://127.0.0.1:${OIDC_ISSUER_PORT}`;
/** Any value the server is told to expect; a fixture constant, not a contract. */
export const OIDC_AUDIENCE = "https://e2e.stigmer.test/api";
/** The console's public PKCE client, as an operator would register it. */
export const OIDC_CONSOLE_CLIENT_ID = "stigmer-console";
/**
 * The client for installed apps the server announces (getServerInfo), so
 * `stigmer auth login` signs in on this stack as it does against any
 * self-hosted server (the first-hour journey's CLI).
 */
export const OIDC_NATIVE_CLIENT_ID = "stigmer-cli";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ISSUER_MAIN = path.join(
  REPO_ROOT,
  "test/support/src/local-oidc-issuer-main.ts",
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

/**
 * The help link the OIDC stack's operator sets (STIGMER_HELP_URL and
 * STIGMER_HELP_LABEL): a self-hosted server that names its own desk. The
 * trusted-local stacks set none, so their consoles show no help link.
 */
export const OIDC_HELP = {
  url: "https://support.e2e.stigmer.test/stigmer",
  label: "Ask IT on Slack",
} as const;
