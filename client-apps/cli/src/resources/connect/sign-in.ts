// The interactive sign-in `connect plugin` runs for a server that takes one.
//
// The login is saved in the caller's My vault at the server's address, by
// the vault's own sign-in: `startSignIn` answers the login page, the browser
// signs in there, and the console's callback page finishes the sign-in
// (`completeSignIn`) as the same person. The CLI only opens the page and
// waits until My vault holds a login at the address, reading connection
// names and never a token. The wait polls every 3 seconds for at most 10
// minutes, the life of a started sign-in.
//
// The callback page is the console's, so a local backend's console must be
// running; it is probed first, and when it is not, the user is pointed at
// the two other ways (a key saved in the vault for a server that accepts
// one, or Stigmer Cloud's hosted console).
//
// Every side effect (browser open, console probe, clock, sleep, log sink) is
// injectable so the wait and the guidance are unit-testable without a real
// browser, network or wall-clock delay.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import {
  GetMyVaultInputSchema,
  SignInReturn,
  StartSignInInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { type Stigmer, StigmerError } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { holdsLoginFor } from "./address.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const CONSOLE_PROBE_TIMEOUT_MS = 2000;

/** The vault reads and the sign-in start this flow needs. */
export type SignInClient = Pick<Stigmer, "vault">;

/** Injectable side effects and inputs for {@link runSignIn}. */
export interface SignInDeps {
  readonly client: SignInClient;
  /** The server's normalized address, where the login is saved. */
  readonly address: string;
  /** The server's name, for sentences. */
  readonly serverName: string;
  /** The command that runs this sign-in again, for guidance. */
  readonly rerun: string;
  readonly org: string;
  /** The web console origin (resolveConsoleURL over the caller's config). */
  readonly consoleURL: string;
  /** Probe the console before opening the browser (local daemon only). */
  readonly probeLocalConsole: boolean;
  /** The login key a pasted key may be saved under, when the server accepts one. */
  readonly loginKey?: string;
  /** Opens the page URL in the user's browser. Defaults to the OS opener. */
  readonly openBrowser?: (url: string) => Promise<void>;
  /** Probes whether the local web console is reachable. Defaults to a 2s GET. */
  readonly probeConsole?: (url: string) => Promise<boolean>;
  /** Current epoch ms. Injectable for deterministic timeout tests. */
  readonly now?: () => number;
  /** Sleep helper. Injectable so tests don't wait real seconds. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Human-facing log sink (stderr by default, so stdout stays machine-clean). */
  readonly log?: (line: string) => void;
}

/**
 * Start the sign-in, open its login page, and wait until My vault holds a
 * login at the address. Throws a {@link UsageError} when the local console
 * is unreachable or the wait times out.
 */
export async function runSignIn(deps: SignInDeps): Promise<void> {
  const log = deps.log ?? stderrLog;
  if (deps.probeLocalConsole) {
    const probe = deps.probeConsole ?? probeWebConsole;
    if (!(await probe(deps.consoleURL))) throw consoleUnavailableError(deps);
  }

  const started = await deps.client.vault.startSignIn(
    create(StartSignInInputSchema, {
      vault: { org: deps.org, vault: { case: "mine", value: true } },
      address: deps.address,
      returnTo: SignInReturn.web,
    }),
  );

  log(`Sign in to '${deps.serverName}' with ${started.providerName || "its login server"}.`);
  log("Opening the login page in your browser...");
  log(`\n  If the browser doesn't open automatically, visit:\n  ${started.authorizationUrl}\n`);
  const open = deps.openBrowser ?? openInBrowser;
  try {
    await open(started.authorizationUrl);
  } catch {
    log("  Could not open the browser automatically. Open the URL above in your browser.");
  }

  await waitForLogin(deps);
}

/**
 * Poll My vault every 3s until it holds a login at the address, or the
 * 10-minute life of a sign-in elapses. Throws a {@link UsageError} on
 * timeout.
 */
export async function waitForLogin(deps: SignInDeps): Promise<void> {
  const log = deps.log ?? stderrLog;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + POLL_TIMEOUT_MS;

  log("Waiting for the sign-in... (press Ctrl+C to cancel)");
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    if (now() >= deadline) {
      throw new UsageError(`timed out waiting for the sign-in to '${deps.serverName}'; run ${deps.rerun} to try again`);
    }
    const vault = await readMyVault(deps.client, deps.org);
    if (vault !== undefined && holdsLoginFor(vault.spec?.connections ?? {}, deps.address)) {
      log("Signed in.\n");
      return;
    }
  }
}

/** The caller's My vault in `org`, or undefined when they have none yet. */
export async function readMyVault(client: SignInClient, org: string): Promise<Vault | undefined> {
  try {
    return await client.vault.getMine(create(GetMyVaultInputSchema, { org }));
  } catch (err) {
    if (err instanceof StigmerError && err.connectCode === Code.NotFound) return undefined;
    throw err;
  }
}

// Probe the local web console with a short-timeout GET. Any HTTP response (even
// an error status) means it's serving; a network/timeout failure means it isn't.
async function probeWebConsole(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CONSOLE_PROBE_TIMEOUT_MS),
    });
    // Drain the body so the socket can close promptly.
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

// The sign-in returns to the console's callback page, which a local backend
// may not be serving. The two other ways: a key saved in the vault, for a
// server that accepts one, or Stigmer Cloud's hosted console.
function consoleUnavailableError(deps: SignInDeps): UsageError {
  const ways = [
    ...(deps.loginKey !== undefined && deps.loginKey !== ""
      ? [`  - Save a key in your vault: stigmer vault set-secret ${deps.loginKey} --mine, then run ${deps.rerun}`]
      : []),
    "  - Or use Stigmer Cloud's hosted console: stigmer config backend set cloud",
  ];
  return new UsageError(
    `Signing in to '${deps.serverName}' returns to the web console, which is not running for this local backend.\n\n` +
      `To connect it${ways.length > 1 ? ", either" : ""}:\n` +
      ways.join("\n"),
  );
}

// Open a URL in the user's default browser: a platform-specific launcher, no
// new dependency. Callers print the URL first so a launch failure still
// leaves the user a way forward.
function openInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const { spawn } = await import("node:child_process");
      const [command, args] = browserCommand(process.platform, url);
      if (command === undefined) {
        reject(new Error(`unsupported platform: ${process.platform}`));
        return;
      }
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("error", reject);
      child.unref();
      resolve();
    })().catch(reject);
  });
}

/** The OS-specific command + args to open a URL. Exported for tests. */
export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): [string | undefined, string[]] {
  switch (platform) {
    case "darwin":
      return ["open", [url]];
    case "win32":
      return ["rundll32", ["url.dll,FileProtocolHandler", url]];
    case "linux":
      return ["xdg-open", [url]];
    default:
      return [undefined, []];
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stderrLog(line: string): void {
  process.stderr.write(`${line}\n`);
}
