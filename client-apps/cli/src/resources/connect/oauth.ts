// Interactive OAuth browser flow for `connect mcp-server`. Mirrors Go's
// internal/cli/mcpserver/oauth.go: resolve the web console URL, (in local mode)
// probe that the console is reachable, open the org's MCP-server page so the
// user can grant access, then poll getOAuthGrantStatus until the grant lands or
// a 5-minute timeout elapses.
//
// Token acquisition and audit identity stay server-side by design; the CLI only
// shepherds the user to the console and waits for the backend to report success.
//
// Every side effect (browser open, console probe, clock, sleep, log sink) is
// injectable so the poll loop and URL resolution are unit-testable without a
// real browser, network, or wall-clock delay.

import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { GetOAuthGrantStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const CONSOLE_PROBE_TIMEOUT_MS = 2000;

/** Injectable side effects + inputs for {@link runOAuthFlow}. */
export interface OAuthFlowDeps {
  readonly client: Stigmer;
  readonly server: McpServer;
  readonly org: string;
  /** The web console origin (resolveConsoleURL over the caller's config). */
  readonly consoleURL: string;
  /** Probe the console before opening the browser (the local daemon's
   * console may simply not be running; remote consoles answer or 404). */
  readonly probeLocalConsole: boolean;
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
 * Run the full interactive OAuth flow: probe (local), open the console, and
 * wait for the grant. Throws a {@link UsageError} if the local console is
 * unreachable or the wait times out.
 */
export async function runOAuthFlow(deps: OAuthFlowDeps): Promise<void> {
  const log = deps.log ?? stderrLog;
  const consoleURL = deps.consoleURL;

  if (deps.probeLocalConsole) {
    const probe = deps.probeConsole ?? probeWebConsole;
    if (!(await probe(consoleURL)))
      throw consoleUnavailableError(deps.server.metadata?.slug ?? "<slug>");
  }

  const slug = deps.server.metadata?.slug ?? "";
  const name = deps.server.metadata?.name ?? slug;
  const pageURL = `${consoleURL}/${deps.org}/mcp-servers/${slug}`;

  log(`OAuth authentication required for '${name}'.`);
  log("Opening web console to complete authentication...");
  log(`\n  If the browser doesn't open automatically, visit:\n  ${pageURL}\n`);

  const open = deps.openBrowser ?? openInBrowser;
  try {
    await open(pageURL);
  } catch {
    log(
      "  Could not open browser automatically. Please open the URL above in your browser.",
    );
  }

  await waitForOAuthGrant(deps);
}

/**
 * Poll getOAuthGrantStatus every 3s until the grant is connected or the
 * 5-minute timeout elapses. Throws a {@link UsageError} on timeout.
 */
export async function waitForOAuthGrant(deps: OAuthFlowDeps): Promise<void> {
  const log = deps.log ?? stderrLog;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const serverId = deps.server.metadata?.id ?? "";
  const deadline = now() + POLL_TIMEOUT_MS;

  log("Waiting for OAuth connection... (press Ctrl+C to cancel)");

  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    if (now() >= deadline) {
      throw new UsageError(
        "timed out waiting for OAuth connection — please try again",
      );
    }
    if (await checkOAuthGrant(deps.client, serverId, deps.org)) {
      log("OAuth connection established.\n");
      return;
    }
  }
}

/** Query the backend for an existing/just-created OAuth grant. */
export async function checkOAuthGrant(
  client: Stigmer,
  mcpServerId: string,
  org: string,
): Promise<boolean> {
  const status = await client.mcpServer.getOAuthGrantStatus(
    create(GetOAuthGrantStatusInputSchema, { resourceId: mcpServerId, org }),
  );
  return status.connected;
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

// Interactive OAuth needs a web console to host the grant page. The TS CLI does
// not serve a local console, so for a local backend we steer the user to the two
// real alternatives — manual credentials, or Stigmer Cloud's hosted console —
// rather than telling them to enable a console that does not exist locally.
function consoleUnavailableError(slug: string): UsageError {
  return new UsageError(
    "Interactive OAuth via the web console isn't available for a local backend.\n\n" +
      "To connect this MCP server, either:\n" +
      `  - Provide credentials directly: stigmer connect mcp-server ${slug} --env TOKEN=...\n` +
      "  - Or use Stigmer Cloud's hosted console: stigmer config backend set cloud",
  );
}

// Open a URL in the user's default browser. Mirrors Go's browser.Open: a
// platform-specific launcher, no new dependency. Callers print the URL first so
// a launch failure still leaves the user a way forward.
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
