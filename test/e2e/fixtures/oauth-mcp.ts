/**
 * The OAuth MCP fixture: a hosted MCP server that answers the OAuth
 * challenge and a login server that consents, both as one PROCESS from the
 * conformance harness (`oauth-mcp-fixture-main.ts`, which stays there
 * because it needs the MCP SDK). The OIDC stack starts it, its login page
 * carrying an opener policy, with the control plane booted with the
 * console's callback as its OAuth redirect, for the first-hour journey's
 * sign-ins (`tests/first-hour`): from the plugin's page, from an app on its
 * own address and from the CLI. A deployed target serves it through a
 * tunnel (`tunnelled`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { readStackState } from "./stack-state";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE_MAIN = path.join(
  REPO_ROOT,
  "test/conformance/src/harness/oauth-mcp-fixture-main.ts",
);
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");
/** What the fixture process prints once both servers listen. */
export interface OAuthMcpReady {
  /** The MCP server's URL: the one a plugin's `mcp.json` names, nothing else. */
  readonly mcpUrl: string;
  /** The login server's origin, for the record; Sign in finds it through the MCP server's metadata. */
  readonly authorizationServer: string;
}

/** How the fixture's login server consents. */
export interface OAuthMcpOptions {
  /**
   * The Cross-Origin-Opener-Policy its consent page carries (a page with an
   * Allow link the journey clicks); unset, it consents by redirect.
   */
  readonly openerPolicy?: string;
  /**
   * Where a tunnel serves each server, for a deployed target that reaches
   * only public addresses: the loopback port it listens on and the public
   * origin it names itself by. Unset, both servers take an ephemeral
   * loopback port and name it.
   */
  readonly tunnelled?: {
    readonly mcp: { readonly port: number; readonly origin: string };
    readonly login: { readonly port: number; readonly origin: string };
  };
}

/** Spawn the fixture; resolves once it has printed its ready line. */
export function startOAuthMcpFixture(options: OAuthMcpOptions = {}): Promise<{
  child: ChildProcess;
  ready: OAuthMcpReady;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [FIXTURE_MAIN], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(options.openerPolicy === undefined ? {} : { STIGMER_OAUTH_OPENER_POLICY: options.openerPolicy }),
        ...(options.tunnelled === undefined
          ? {}
          : {
              STIGMER_OAUTH_MCP_PORT: String(options.tunnelled.mcp.port),
              STIGMER_OAUTH_MCP_ORIGIN: options.tunnelled.mcp.origin,
              STIGMER_OAUTH_LOGIN_PORT: String(options.tunnelled.login.port),
              STIGMER_OAUTH_LOGIN_ORIGIN: options.tunnelled.login.origin,
            }),
      },
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
  return readStackState()?.oauthMcp ?? null;
}
