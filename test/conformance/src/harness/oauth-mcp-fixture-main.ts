// A hosted OAuth MCP server and its login server as one PROCESS, for a
// browser-driven sign-in. Domain: conformance harness.
//
// The Playwright journey installs a plugin whose MCP server is nothing but
// a URL, watches the control plane complete its OAuth at save, and signs in
// from the plugin's page. That takes two counterparties the conformance
// suites already own as in-process classes: `McpToolFixture` answering the
// OAuth challenge and serving the RFC 9728 document that names its login
// server, and `MockOAuthAuthorizationServer` publishing its metadata,
// registering a client, consenting by redirect and issuing a token. The e2e
// package never imports across test packages (the OIDC issuer's precedent,
// `local-oidc-issuer-main.ts`), so it spawns this script and reads the two
// URLs from stdout.
//
//   npx tsx test/conformance/src/harness/oauth-mcp-fixture-main.ts
//
// With STIGMER_OAUTH_OPENER_POLICY set, the login server consents on a page
// carrying that Cross-Origin-Opener-Policy (`same-origin`, as Sentry's
// does), which a journey clicks through, so the sign-in window is cut off
// from the page that opened it.
//
// Reached through a tunnel (a deployed server reaches only public
// addresses), each server listens on the port it is given and names the
// tunnel's origin: STIGMER_OAUTH_MCP_PORT with STIGMER_OAUTH_MCP_ORIGIN for
// the MCP server, STIGMER_OAUTH_LOGIN_PORT with STIGMER_OAUTH_LOGIN_ORIGIN
// for the login server. Unset, both take an ephemeral loopback port.
//
// Prints one JSON line — `{ mcpUrl, authorizationServer }` — once both are
// listening, then serves until SIGTERM/SIGINT. A Bearer-carrying tool call
// reaches the fixture's `echo` surface, so a session on an agent that lists
// the server can call one tool once the sign-in has landed.
import { McpToolFixture } from "./mcp-server";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";

async function main(): Promise<void> {
  const authorizationServer = new MockOAuthAuthorizationServer();
  /* v8 ignore next -- @preserve: a process entry the e2e stacks spawn (test/e2e/fixtures/oauth-mcp.ts); no vitest config runs it, and the port and public origin it sets are tested in test/support */
  authorizationServer.publicOrigin = process.env.STIGMER_OAUTH_LOGIN_ORIGIN || undefined;
  /* v8 ignore next -- @preserve: a process entry the e2e stacks spawn (test/e2e/fixtures/oauth-mcp.ts); no vitest config runs it, and the port and public origin it sets are tested in test/support */
  await authorizationServer.start(Number(process.env.STIGMER_OAUTH_LOGIN_PORT ?? "0"));
  authorizationServer.authorizeRedirect = true;
  /* v8 ignore next -- @preserve: a process entry the e2e stacks spawn (test/e2e/fixtures/oauth-mcp.ts); no vitest config runs it, and the consent page it switches on is tested in test/support */
  authorizationServer.openerPolicy = process.env.STIGMER_OAUTH_OPENER_POLICY || undefined;

  const mcp = new McpToolFixture();
  /* v8 ignore next -- @preserve: a process entry the e2e stacks spawn (test/e2e/fixtures/oauth-mcp.ts); no vitest config runs it, and the port and public origin it sets are tested in the harness's mcp-server.test.ts */
  mcp.publicOrigin = process.env.STIGMER_OAUTH_MCP_ORIGIN || undefined;
  /* v8 ignore next -- @preserve: a process entry the e2e stacks spawn (test/e2e/fixtures/oauth-mcp.ts); no vitest config runs it, and the port and public origin it sets are tested in the harness's mcp-server.test.ts */
  await mcp.start(Number(process.env.STIGMER_OAUTH_MCP_PORT ?? "0"));
  mcp.requireOAuth({
    resourceMetadataUrl: `${new URL(mcp.url()).origin}/.well-known/oauth-protected-resource`,
    authorizationServerOrigin: authorizationServer.origin(),
  });

  process.stdout.write(JSON.stringify({ mcpUrl: mcp.url(), authorizationServer: authorizationServer.origin() }) + "\n");

  const stop = (): void => {
    void Promise.all([mcp.close(), authorizationServer.close()]).then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
