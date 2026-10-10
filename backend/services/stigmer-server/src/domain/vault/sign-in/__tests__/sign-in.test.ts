/**
 * Pins the sign-in and Connect link lanes through the REAL stack: a
 * composed server on an ephemeral port, native gRPC clients, a live mock
 * login server on 127.0.0.1 (RFC 9728 protected-resource metadata, RFC 8414
 * discovery, RFC 7591 registration, the authorize pre-flight and the token
 * endpoint), and the real vault domain the login is saved into:
 *
 *   - a person's startSignIn and completeSignIn on VaultCommandController,
 *     from an address with no MCP server involved, save into their My vault
 *     at that address, and a second sign-in reuses the registered client;
 *   - a Connect link made with createConnectLink, for an address the
 *     organization's own login app lists, works through the public
 *     ConnectLinkController, saves into its shared vault, answers its return
 *     URL, and works once;
 *   - Stigmer's OAuth client document is served on the unified port when the
 *     server has a public https origin, listing every redirect a sign-in uses.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ConnectLinkController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";

import { loadConfig } from "../../../../boot/config.js";
import { composeServer } from "../../../../boot/compose.js";
import type { ComposedServer } from "../../../../boot/compose.js";
import { createLogger } from "../../../../boot/logger.js";
import { seedOrganizations } from "../../../organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";
const PUBLIC_ORIGIN = "https://stigmer.example";
const ORG = "acme";

/**
 * A minimal login server protecting `${base}/mcp`: its protected-resource
 * document, its metadata, registration, the authorize pre-flight and the
 * token endpoint, recording what it was asked.
 */
class MockLoginServer {
  private server: Server | undefined;
  base = "";
  registrations = 0;
  authorizeQueries: URLSearchParams[] = [];
  tokenRequests: URLSearchParams[] = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", this.base);
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        json(200, { resource: `${this.base}/mcp`, authorization_servers: [this.base] });
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        json(200, {
          issuer: this.base,
          authorization_endpoint: `${this.base}/authorize`,
          token_endpoint: `${this.base}/token`,
          registration_endpoint: `${this.base}/register`,
          scopes_supported: ["read", "write"],
          code_challenge_methods_supported: ["S256"],
        });
        return;
      }
      if (url.pathname === "/register" && req.method === "POST") {
        this.registrations += 1;
        json(201, { client_id: `client-${this.registrations}` });
        return;
      }
      if (url.pathname === "/authorize") {
        this.authorizeQueries.push(url.searchParams);
        res.writeHead(200);
        res.end("login page");
        return;
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          this.tokenRequests.push(new URLSearchParams(body));
          json(200, { access_token: `at-${this.tokenRequests.length}`, token_type: "bearer", expires_in: 3600, refresh_token: "rt" });
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server!.address();
    if (address === null || typeof address === "string") {
      throw new Error("mock login server failed to bind");
    }
    this.base = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

let server: ComposedServer;
let port: number;
let vaultCommand: Client<typeof VaultCommandController>;
let vaultQuery: Client<typeof VaultQueryController>;
let links: Client<typeof ConnectLinkController>;
let oauthApps: Client<typeof OAuthAppCommandController>;
let login: MockLoginServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "vault-sign-in-composed-"));
  login = new MockLoginServer();
  await login.start();
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine: 127.0.0.1:1 is deterministically closed (the composed
      // CRUD harness idiom).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
      STIGMER_OAUTH_REDIRECT_URI: REDIRECT_URI,
      SKILL_TRANSFER_BASE_URL: PUBLIC_ORIGIN,
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  await seedOrganizations(transport, [ORG]);
  vaultCommand = createClient(VaultCommandController, transport);
  vaultQuery = createClient(VaultQueryController, transport);
  links = createClient(ConnectLinkController, transport);
  oauthApps = createClient(OAuthAppCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  await login.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function expectCode(promise: Promise<unknown>, code: Code, fragment: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(code);
  expect((error as ConnectError).rawMessage).toContain(fragment);
}

describe("a person's sign-in at an address", () => {
  it("starts from the address alone and saves into My vault at that address", async () => {
    const address = `${login.base}/mcp`;
    const started = await vaultCommand.startSignIn({ vault: { org: ORG, vault: { case: "mine", value: true } }, address });
    const params = new URL(started.authorizationUrl).searchParams;
    expect([...params.keys()]).toEqual([
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "resource",
      "response_type",
      "scope",
      "state",
    ]);
    expect(params.get("resource")).toBe(address);
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(started.providerName).toBe(new URL(login.base).host);

    const done = await vaultCommand.completeSignIn({ state: started.state, code: "code" });
    expect(done).toMatchObject({ address, description: `Signed in at ${new URL(login.base).host}` });
    expect(login.tokenRequests.at(-1)?.get("resource")).toBe(address);
    const mine = await vaultQuery.getMine({ org: ORG });
    expect(mine.spec?.connections[address]?.token).toBe("");
    expect(mine.spec?.connections[address]?.description).toBe(done.description);

    // A second sign-in reuses the client registered for the first.
    await vaultCommand.startSignIn({ vault: { org: ORG, vault: { case: "mine", value: true } }, address });
    expect(login.registrations).toBe(1);
  });
});

describe("a Connect link over the wire", () => {
  it("is made for a shared vault, opened and completed through the public service, and works once", async () => {
    const app = await oauthApps.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "OAuthApp",
      metadata: { name: "Helpdesk app", org: ORG },
      spec: {
        provider: "Helpdesk",
        clientId: "helpdesk-client",
        clientSecret: "helpdesk-secret",
        authorizationUrl: `${login.base}/authorize`,
        tokenUrl: `${login.base}/token`,
        scopes: ["read"],
        addresses: [`${login.base}/mcp`],
      },
    });
    const vault = await vaultCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Vault",
      metadata: { name: "Customer 42", org: ORG },
    });
    const made = await vaultCommand.createConnectLink({
      org: ORG,
      vaultId: vault.metadata!.id,
      address: `${login.base}/mcp`,
      returnUrl: "https://helpdesk.example/done",
    });
    expect(made.url.startsWith("http://127.0.0.1:8234/connect/")).toBe(true);
    const token = made.url.slice(made.url.lastIndexOf("/") + 1);

    const info = await links.getConnectLink({ token });
    expect(info).toMatchObject({ address: `${login.base}/mcp`, organizationName: ORG });
    const started = await links.startConnectLink({ token });
    const done = await links.completeConnectLink({ token, state: started.state, code: "code" });
    expect(done.returnUrl).toBe("https://helpdesk.example/done?stigmer_connect=connected");
    const saved = await vaultQuery.get({ value: vault.metadata!.id });
    expect(Object.keys(saved.spec?.connections ?? {})).toEqual([`${login.base}/mcp`]);

    await expectCode(links.getConnectLink({ token }), Code.NotFound, "Connect link not found");
    await oauthApps.delete({ resourceId: app.metadata!.id });
  });

  it("refuses My vault at creation", async () => {
    const mine = await vaultQuery.getMine({ org: ORG });
    await expectCode(
      vaultCommand.createConnectLink({
        org: ORG,
        vaultId: mine.metadata!.id,
        address: `${login.base}/mcp`,
        returnUrl: "https://helpdesk.example/done",
      }),
      Code.FailedPrecondition,
      "a Connect link saves into a shared vault",
    );
  });
});

describe("Stigmer's OAuth client document", () => {
  it("is served on the unified port for a public https origin, naming every redirect a sign-in uses", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/oauth/client.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      client_id: `${PUBLIC_ORIGIN}/v1/oauth/client.json`,
      client_name: "Stigmer",
      redirect_uris: [REDIRECT_URI, `${REDIRECT_URI}?source=desktop`, "http://127.0.0.1/auth/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    const head = await fetch(`http://127.0.0.1:${port}/v1/oauth/client.json`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(`http://127.0.0.1:${port}/v1/oauth/client.json`, { method: "POST" })).status).toBe(405);
  });
});
