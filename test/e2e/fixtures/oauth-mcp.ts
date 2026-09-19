/**
 * The OAuth MCP stack shape: a hosted MCP server that answers the OAuth
 * challenge and a login server that consents by redirect, both as one
 * PROCESS from the conformance harness (`oauth-mcp-fixture-main.ts`; the
 * e2e package never imports across test packages), and the control plane
 * booted with the console's callback as its OAuth redirect. The shape lets
 * the plugin journey drive a real sign-in through the browser: install a
 * URL-only server, watch the save complete its OAuth, press Sign in on the
 * plugin's page, consent, and read "Signed in".
 *
 * On by STIGMER_E2E_OAUTH_MCP=1 (`make test-e2e-oauth-mcp`). A running
 * backend cannot be reused: it was not booted with the redirect URI the web
 * dev server's origin needs, and the fixture's URLs are per run.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const OAUTH_MCP_STACK =
  process.env.STIGMER_E2E_OAUTH_MCP === "1" ||
  process.env.STIGMER_E2E_OAUTH_MCP === "true";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_MAIN = path.join(
  REPO_ROOT,
  "test/conformance/src/harness/oauth-mcp-fixture-main.ts",
);
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");
const STATE_FILE = path.join(__dirname, "..", ".e2e-server-state.json");

/** What the fixture process prints once both servers listen. */
export interface OAuthMcpReady {
  /** The MCP server's URL: the one a plugin's `mcp.json` names, nothing else. */
  readonly mcpUrl: string;
  /** The login server's origin, for the record; Sign in finds it through the MCP server's metadata. */
  readonly authorizationServer: string;
}

/** Spawn the fixture; resolves once it has printed its ready line. */
export function startOAuthMcpFixture(): Promise<{
  child: ChildProcess;
  ready: OAuthMcpReady;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [FIXTURE_MAIN], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffered = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error("[e2e] the OAuth MCP fixture did not report ready within 20s"),
      );
    }, 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      const ready = JSON.parse(buffered.slice(0, newline)) as OAuthMcpReady;
      resolve({ child, ready });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[e2e:oauth-mcp] ${chunk.toString("utf8")}`);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `[e2e] the OAuth MCP fixture exited before it was ready (code ${String(code)})`,
        ),
      );
    });
  });
}

/**
 * The fixture's URLs as the global setup recorded them, or `null` on a stack
 * booted without the shape; a spec skips on `null` with the command that
 * boots it.
 */
export function getOAuthMcpFixture(): OAuthMcpReady | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as {
      oauthMcp?: OAuthMcpReady;
    };
    return state.oauthMcp ?? null;
  } catch {
    return null;
  }
}
