// A programmable mock OAuth 2.0 authorization server for the McpServer
// connect/OAuth conformance suites (CW-1).
// Domain: conformance harness.
//
// The Go server's OAuth Connect flow makes four kinds of server-side HTTP
// calls, and this fixture is the counterparty for all of them:
//   1. RFC 8414 metadata discovery — GET /.well-known/oauth-authorization-server
//      at the ORIGIN of the McpServer's discovery/http URL (oauth/discovery.go).
//   2. RFC 7591 Dynamic Client Registration — POST to the advertised
//      registration_endpoint (oauth/dcr.go).
//   3. The authorize pre-flight probe — a redirectless GET of the full
//      authorization URL, where ONLY HTTP 400 counts as a rejection and
//      everything else fails open (oauth/preflight.go, stigmer/stigmer#235).
//   4. Token exchange and refresh — form-encoded POSTs to the token endpoint
//      (oauth/token.go), where the client secret must arrive over exactly one
//      channel: Basic header or form body, never both (RFC 6749 §2.3).
//
// Like the sibling fixtures (mock-llm.ts, mcp-server.ts) it is TS-pure,
// long-lived within a suite file, programmable at runtime through public
// levers, and request-capturing — the captures are the wire-level observation
// point for what the Go server actually sent (PKCE verifier, DCR body shape,
// secret channel). Suites call reset() in afterEach so levers and captures
// never leak across tests.
//
// The fixture is suite-owned, not target-owned: the server under test reaches
// it only through URLs carried in per-test resource specs (auth.discovery_url,
// OAuthApp token_url), never through boot-time wiring — so no target class
// needs to know it exists (sub-project DB-2).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// One token-endpoint request as the vendor saw it: the grant parameters plus
// which channel (if any) carried the client secret. This is the assertable
// record for the PKCE and single-secret-channel contracts.
export interface CapturedTokenRequest {
  grantType: string;
  code?: string;
  refreshToken?: string;
  codeVerifier?: string;
  clientId?: string;
  redirectUri?: string;
  // How the client secret arrived: "basic" (Authorization header), "post"
  // (client_secret form field), or "none" (public client — the DCR contract).
  secretChannel: "basic" | "post" | "none";
  clientSecret?: string;
}

// One DCR registration request body, parsed. RFC 7591 field names preserved so
// assertions read like the spec.
export interface CapturedDcrRequest {
  redirect_uris?: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

// One authorize pre-flight probe: the query parameters of the authorization
// URL the Go server built (response_type, client_id, code_challenge, ...).
export interface CapturedAuthorizeProbe {
  params: URLSearchParams;
}

export class MockOAuthAuthorizationServer {
  // --- behavior levers (reset() restores every default) ---

  // Drop registration_endpoint from the metadata document — the "provider
  // does not support DCR" arm.
  omitRegistrationEndpoint = false;
  // HTTP status for the metadata document; non-200 exercises the discovery
  // failure arm.
  discoveryStatus = 200;
  // Advertised scopes_supported — the fallback the Go server uses when the
  // McpServer declares no scope_hints.
  scopesSupported: string[] = [];
  // HTTP status for the authorize endpoint. The pre-flight contract: 400 is a
  // definite rejection, anything else (200 login page, 403 bot wall) fails open.
  authorizeStatus = 200;
  // Body served with a non-2xx authorize status. An RFC 6749-shaped JSON
  // object yields a vendor detail in the rejection message; a plain string
  // models an HTML error page (no extractable detail).
  authorizeErrorBody: { error?: string; error_description?: string } | string | undefined;
  // HTTP status for the token endpoint; non-200 exercises the exchange
  // failure arm (Unavailable on the wire).
  tokenStatus = 200;
  // expires_in for issued tokens. undefined omits the field entirely — the
  // "never expires" contract (grant health stays HEALTHY forever). Values at
  // or below the server's 60s refresh buffer make a fresh grant immediately
  // expired-but-refreshable.
  tokenExpiresIn: number | undefined = 3600;
  // Whether token responses include a refresh_token. Each issuance rotates the
  // value, matching providers that rotate on every refresh.
  issueRefreshToken = false;

  private server: Server | undefined;
  private tokenSerial = 0;
  private clientSerial = 0;
  private discoveryPaths: string[] = [];
  private dcrRequests: CapturedDcrRequest[] = [];
  private authorizeProbes: CapturedAuthorizeProbe[] = [];
  private tokenRequests: CapturedTokenRequest[] = [];

  // --- captures (oldest first; cleared by reset()) ---

  capturedDiscoveryPaths(): readonly string[] {
    return this.discoveryPaths;
  }

  capturedDcrRequests(): readonly CapturedDcrRequest[] {
    return this.dcrRequests;
  }

  capturedAuthorizeProbes(): readonly CapturedAuthorizeProbe[] {
    return this.authorizeProbes;
  }

  capturedTokenRequests(): readonly CapturedTokenRequest[] {
    return this.tokenRequests;
  }

  // Restore every lever to its default and drop all captures. Suites call
  // this in afterEach (the mock-llm.ts convention). The issuance serials
  // reset too, so within any single test the first registered client is
  // always "mock-dcr-client-1" and the first issued refresh token is always
  // "mock-refresh-token-1" — assertions stay order-independent no matter how
  // many earlier tests in the file ran handshakes.
  reset(): void {
    this.omitRegistrationEndpoint = false;
    this.discoveryStatus = 200;
    this.scopesSupported = [];
    this.authorizeStatus = 200;
    this.authorizeErrorBody = undefined;
    this.tokenStatus = 200;
    this.tokenExpiresIn = 3600;
    this.issueRefreshToken = false;
    this.tokenSerial = 0;
    this.clientSerial = 0;
    this.discoveryPaths = [];
    this.dcrRequests = [];
    this.authorizeProbes = [];
    this.tokenRequests = [];
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        } else if (!res.writableEnded) {
          res.destroy();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
  }

  // The fixture's origin (scheme://host:port). RFC 8414 discovery always
  // resolves against an origin, so this is what a McpServer's
  // auth.discovery_url (or an OAuthApp's endpoint URLs, path-suffixed) points
  // at.
  origin(): string {
    if (this.server === undefined) {
      throw new Error("MockOAuthAuthorizationServer.start() must be called before origin()");
    }
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  tokenEndpoint(): string {
    return `${this.origin()}/token`;
  }

  authorizationEndpoint(): string {
    return `${this.origin()}/authorize`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? "/", this.origin());

    if (req.method === "GET" && requestUrl.pathname === "/.well-known/oauth-authorization-server") {
      this.discoveryPaths.push(requestUrl.pathname);
      this.serveMetadata(res);
      return;
    }
    if (req.method === "POST" && requestUrl.pathname === "/register") {
      this.dcrRequests.push(JSON.parse(await readBody(req)) as CapturedDcrRequest);
      this.clientSerial += 1;
      respondJson(res, 201, { client_id: `mock-dcr-client-${this.clientSerial}` });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/authorize") {
      this.authorizeProbes.push({ params: requestUrl.searchParams });
      this.serveAuthorize(res);
      return;
    }
    if (req.method === "POST" && requestUrl.pathname === "/token") {
      await this.serveToken(req, res);
      return;
    }

    respondJson(res, 404, { error: "not found" });
  }

  private serveMetadata(res: ServerResponse): void {
    if (this.discoveryStatus !== 200) {
      respondJson(res, this.discoveryStatus, { error: "metadata unavailable" });
      return;
    }
    respondJson(res, 200, {
      issuer: this.origin(),
      authorization_endpoint: this.authorizationEndpoint(),
      token_endpoint: this.tokenEndpoint(),
      ...(this.omitRegistrationEndpoint ? {} : { registration_endpoint: `${this.origin()}/register` }),
      ...(this.scopesSupported.length > 0 ? { scopes_supported: this.scopesSupported } : {}),
      code_challenge_methods_supported: ["S256"],
    });
  }

  private serveAuthorize(res: ServerResponse): void {
    if (this.authorizeStatus === 200) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Sign in to ConformanceVendor</body></html>");
      return;
    }
    if (typeof this.authorizeErrorBody === "string") {
      res.writeHead(this.authorizeStatus, { "content-type": "text/html" });
      res.end(this.authorizeErrorBody);
      return;
    }
    respondJson(res, this.authorizeStatus, this.authorizeErrorBody ?? { error: "access_denied" });
  }

  private async serveToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));

    let secretChannel: CapturedTokenRequest["secretChannel"] = "none";
    let clientSecret: string | undefined;
    const authorization = req.headers.authorization;
    if (authorization?.startsWith("Basic ") === true) {
      secretChannel = "basic";
      const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
      clientSecret = decoded.slice(decoded.indexOf(":") + 1);
    } else if (form.has("client_secret")) {
      secretChannel = "post";
      clientSecret = form.get("client_secret") ?? undefined;
    }

    this.tokenRequests.push({
      grantType: form.get("grant_type") ?? "",
      code: form.get("code") ?? undefined,
      refreshToken: form.get("refresh_token") ?? undefined,
      codeVerifier: form.get("code_verifier") ?? undefined,
      clientId: form.get("client_id") ?? undefined,
      redirectUri: form.get("redirect_uri") ?? undefined,
      secretChannel,
      clientSecret,
    });

    if (this.tokenStatus !== 200) {
      respondJson(res, this.tokenStatus, { error: "server_error" });
      return;
    }

    this.tokenSerial += 1;
    respondJson(res, 200, {
      access_token: `mock-access-token-${this.tokenSerial}`,
      token_type: "Bearer",
      ...(this.tokenExpiresIn !== undefined ? { expires_in: this.tokenExpiresIn } : {}),
      ...(this.issueRefreshToken ? { refresh_token: `mock-refresh-token-${this.tokenSerial}` } : {}),
    });
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
