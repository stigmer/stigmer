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
// Prints one JSON line — `{ mcpUrl, authorizationServer }` — once both are
// listening, then serves until SIGTERM/SIGINT. A Bearer-carrying tool call
// reaches the fixture's `echo` surface, so a session on an agent that lists
// the server can call one tool once the sign-in has landed.
import { McpToolFixture } from "./mcp-server";
import { MockOAuthAuthorizationServer } from "./oauth-authorization-server";

async function main(): Promise<void> {
  const authorizationServer = new MockOAuthAuthorizationServer();
  await authorizationServer.start();
  authorizationServer.authorizeRedirect = true;

  const mcp = new McpToolFixture();
  await mcp.start();
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
