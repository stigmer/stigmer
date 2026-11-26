// The interactive sign-in `connect plugin` runs for a server that takes one.
//
// The login is saved in the caller's My vault at the server's address, by
// the vault's own sign-in: `startSignIn` answers the login page, the browser
// signs in there, and the console's callback page hands the login page's
// answer to Stigmer (`handBackSignIn`, public). The CLI collects it as the
// person who started the sign-in, by asking `completeSignIn` with the
// sign-in's state and no code every 2 seconds: the server answers pending
// until the answer is there, then saves the login in that same ask. The
// server's ten-minute life of a sign-in governs the wait, not a clock here.
// The CLI prints whose login was saved ("GitHub @ana", or the host), so a
// login that is not the person's shows itself.
//
// The ask that finds the answer takes the sign-in, so a failure there (a
// token exchange the login server refused answers UNAVAILABLE) is the
// sign-in's outcome: a transient failure is asked again, and a refusal
// with the reason SIGN_IN_ENDED right after one means that ask took it, so
// its failure is the one reported.
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
  CompleteSignInInputSchema,
  GetMyVaultInputSchema,
  SignInReturn,
  StartSignInInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { getErrorReason, isTransientStreamError, type Stigmer, StigmerError } from "@stigmer/client";
import { UsageError } from "../../errors/index.js";

const ASK_INTERVAL_MS = 2000;
/** The longest pause between asks while the server keeps failing on the way. */
const MAX_RETRY_DELAY_MS = 10_000;
const CONSOLE_PROBE_TIMEOUT_MS = 2000;

/**
 * The reason `completeSignIn` refuses a sign-in that is unknown, expired or
 * already finished with (its google.rpc.ErrorInfo, domain "stigmer.ai").
 */
const SIGN_IN_ENDED = "SIGN_IN_ENDED";

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
  /** Sleep helper. Injectable so tests don't wait real seconds. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Human-facing log sink (stderr by default, so stdout stays machine-clean). */
  readonly log?: (line: string) => void;
}

/**
 * Start the sign-in, open its login page, and wait until it is finished
 * ({@link waitForSignIn}). Throws a {@link UsageError} when the local
 * console is unreachable or the sign-in ended unfinished.
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

  await waitForSignIn(deps, started.state);
}

/**
 * Ask the server every 2s to finish the sign-in (`completeSignIn` with no
 * code) until it is saved, then print whose login it is. A transient
 * failure is asked again after a growing pause; the login page's refusal
 * ends the wait in its words; a sign-in that ended (expired after its ten
 * minutes, or already used) ends it with a {@link UsageError}, unless an
 * ask just failed, which is then the failure reported.
 */
export async function waitForSignIn(deps: SignInDeps, state: string): Promise<void> {
  const log = deps.log ?? stderrLog;
  const sleep = deps.sleep ?? defaultSleep;
  let failedInARow = 0;
  let lastFailure: unknown;

  log("Waiting for the sign-in... (press Ctrl+C to cancel)");
  for (;;) {
    await sleep(failedInARow === 0 ? ASK_INTERVAL_MS : Math.min(ASK_INTERVAL_MS * 2 ** failedInARow, MAX_RETRY_DELAY_MS));
    try {
      const answer = await deps.client.vault.completeSignIn(create(CompleteSignInInputSchema, { state }));
      if (answer.pending) {
        failedInARow = 0;
        lastFailure = undefined;
        continue;
      }
      log(`Signed in: ${answer.description || answer.address}\n`);
      return;
    } catch (err) {
      if (getErrorReason(err)?.reason === SIGN_IN_ENDED) {
        if (lastFailure !== undefined) throw lastFailure;
        throw new UsageError(
          `the sign-in to '${deps.serverName}' expired or was already used; run ${deps.rerun} to try again`,
        );
      }
      if (!isTransientStreamError(err)) throw err;
      failedInARow += 1;
      lastFailure = err;
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
