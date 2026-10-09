// A programmable mock OAuth 2.0 authorization server for the sign-in and
// Connect link conformance suites and the e2e OAuth posture.
// Domain: test support (identity fixtures).
//
// A sign-in at an address makes these server-side HTTP calls, and this
// fixture is the counterparty for all of them:
//   0. RFC 9728 protected-resource metadata — GET
//      /.well-known/oauth-protected-resource<path> for an address on this
//      fixture's own origin (`${origin()}/mcp/...`), naming this fixture as
//      the login server; its `resource` is the address the document
//      describes, unless a suite overrides it (the discard arm).
//   1. RFC 8414 metadata discovery — GET /.well-known/oauth-authorization-server
//      at the issuer's origin (domain/vault/sign-in/discovery.ts).
//   2. RFC 7591 Dynamic Client Registration — POST to the advertised
//      registration_endpoint (sign-in/dcr.ts), counted, so a suite proves a
//      client is registered once per login server.
//   3. The authorize pre-flight probe — a redirectless GET of the full
//      authorization URL, where ONLY HTTP 400 counts as a rejection and
//      everything else fails open (sign-in/preflight.ts,
//      stigmer/stigmer#235). A client the fixture has been told to forget
//      is refused here with 400, as a real login server refuses a client it
//      no longer knows.
//   4. Token exchange and refresh — form-encoded POSTs to the token endpoint
//      (sign-in/token.ts), where the client secret must arrive over exactly
//      one channel: Basic header or form body, never both (RFC 6749 §2.3). A
//      forgotten client is answered 401 `invalid_client`.
//   5. The account read — GET /userinfo with the issued bearer, answering
//      `login` when a suite sets one (the saved login's description).
//
// Every authorize probe and token request records the `resource` parameter
// (RFC 8707) it carried, the observation point for the rule that a sign-in
// through a discovered login server names the address it is for and one
// through a login app does not.
//
// Like the sibling fixtures (mock-llm.ts, mcp-server.ts) it is TS-pure,
// long-lived within a suite file, programmable at runtime through public
// levers, and request-capturing — the captures are the wire-level observation
// point for what the Go server actually sent (PKCE verifier, DCR body shape,
// secret channel). Suites call reset() in afterEach so levers and captures
// never leak across tests.
//
// The fixture is suite-owned, not target-owned: the server under test reaches
// it only through addresses and URLs a test names (a sign-in's address on
// this origin, an OAuthApp's token_url), never through boot-time wiring — so
// no target class needs to know it exists.
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
  // The RFC 8707 resource parameter, when one was sent.
  resource?: string;
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
  // Advertised scopes_supported in the login server's own metadata — the
  // fallback when the address's document lists none.
  scopesSupported: string[] = [];
  // scopes_supported in the protected-resource document of an address on
  // this origin; asked for ahead of the login server's.
  resourceScopesSupported: string[] = [];
  // Advertise client_id_metadata_document_supported.
  clientIdMetadataDocumentSupported = false;
  // Serve protected-resource documents for addresses on this origin.
  // Off, the walk finds none and falls back to the origin as the issuer.
  serveProtectedResource = true;
  // The login server(s) a protected-resource document names; default this
  // fixture's own origin.
  protectedResourceIssuers: string[] | undefined;
  // The `resource` a protected-resource document names; default the
  // address it describes. Set to another resource for the discard arm.
  protectedResourceName: string | undefined;
  // The login an account read answers; undefined serves 404.
  userinfoLogin: string | undefined;
  // HTTP status for the authorize endpoint. The pre-flight contract: 400 is a
  // definite rejection, anything else (200 login page, 403 bot wall) fails open.
  authorizeStatus = 200;
  // Consent by redirect: with this on, a 200 authorize answers as a user who
  // approved would, a 302 to the request's redirect_uri carrying a fresh code
  // and the request's state, so a browser-driven sign-in (the Playwright
  // journey) completes against this mock. Off, the static login page stands,
  // which is what the server's pre-flight probe expects.
  authorizeRedirect = false;
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
  private protectedResourcePaths: string[] = [];
  private forgotten = new Set<string>();
  // The issuer's tenant path, advanced by reset(): the server under test
  // keeps the client it registered per login server for its whole life, so
  // each test meets a login server it has never registered with.
  private tenant = 1;
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

  capturedProtectedResourcePaths(): readonly string[] {
    return this.protectedResourcePaths;
  }

  // Forget a client: from now on the authorize endpoint refuses it with 400
  // and the token endpoint with 401 invalid_client, as a login server that
  // dropped a registration does.
  forgetClient(clientId: string): void {
    this.forgotten.add(clientId);
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
    this.resourceScopesSupported = [];
    this.clientIdMetadataDocumentSupported = false;
    this.serveProtectedResource = true;
    this.protectedResourceIssuers = undefined;
    this.protectedResourceName = undefined;
    this.userinfoLogin = undefined;
    this.forgotten = new Set<string>();
    this.protectedResourcePaths = [];
    this.tenant += 1;
    this.authorizeRedirect = false;
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

  // The fixture's origin (scheme://host:port): the issuer, and the origin of
  // every address whose protected-resource document this fixture serves.
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

  // The issuer this test's login server names: the origin with a tenant
  // path, fresh after every reset(). Its RFC 8414 document is served with
  // the path inserted (and at the origin, for a walk that falls back there).
  issuer(): string {
    return `${this.origin()}/t${this.tenant}`;
  }

  // An address on this fixture's origin whose protected-resource document
  // names this fixture as its login server: `${origin}/mcp/<name>`.
  resourceAddress(name: string): string {
    return `${this.origin()}/mcp/${name}`;
  }

  userinfoEndpoint(): string {
    return `${this.origin()}/userinfo`;
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

    const protectedResourcePrefix = "/.well-known/oauth-protected-resource";
    if (
      req.method === "GET" &&
      (requestUrl.pathname === protectedResourcePrefix || requestUrl.pathname.startsWith(`${protectedResourcePrefix}/`))
    ) {
      this.protectedResourcePaths.push(requestUrl.pathname);
      const path = requestUrl.pathname.slice(protectedResourcePrefix.length);
      if (!this.serveProtectedResource) {
        respondJson(res, 404, { error: "not found" });
        return;
      }
      respondJson(res, 200, {
        resource: this.protectedResourceName ?? `${this.origin()}${path}`,
        authorization_servers: this.protectedResourceIssuers ?? [this.issuer()],
        ...(this.resourceScopesSupported.length > 0 ? { scopes_supported: this.resourceScopesSupported } : {}),
      });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/userinfo") {
      if (this.userinfoLogin === undefined || !/^Bearer\s+\S+/i.test(String(req.headers.authorization ?? ""))) {
        respondJson(res, 404, { error: "not found" });
        return;
      }
      respondJson(res, 200, { login: this.userinfoLogin });
      return;
    }
    if (
      req.method === "GET" &&
      (requestUrl.pathname === "/.well-known/oauth-authorization-server" ||
        requestUrl.pathname === `/.well-known/oauth-authorization-server/t${this.tenant}`)
    ) {
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
      this.serveAuthorize(res, requestUrl.searchParams);
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
      issuer: this.issuer(),
      authorization_endpoint: this.authorizationEndpoint(),
      token_endpoint: this.tokenEndpoint(),
      ...(this.omitRegistrationEndpoint ? {} : { registration_endpoint: `${this.origin()}/register` }),
      ...(this.scopesSupported.length > 0 ? { scopes_supported: this.scopesSupported } : {}),
      ...(this.clientIdMetadataDocumentSupported ? { client_id_metadata_document_supported: true } : {}),
      code_challenge_methods_supported: ["S256"],
    });
  }

  private serveAuthorize(res: ServerResponse, params: URLSearchParams): void {
    if (this.forgotten.has(params.get("client_id") ?? "")) {
      respondJson(res, 400, { error: "invalid_client", error_description: "unknown client" });
      return;
    }
    if (this.authorizeStatus === 200 && this.authorizeRedirect) {
      const redirectUri = params.get("redirect_uri");
      if (redirectUri === null) {
        respondJson(res, 400, { error: "invalid_request", error_description: "redirect_uri is required" });
        return;
      }
      this.tokenSerial += 1;
      const location = new URL(redirectUri);
      location.searchParams.set("code", `mock-authorization-code-${this.tokenSerial}`);
      const state = params.get("state");
      if (state !== null) location.searchParams.set("state", state);
      res.writeHead(302, { location: location.toString() });
      res.end();
      return;
    }
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
      resource: form.get("resource") ?? undefined,
      secretChannel,
      clientSecret,
    });

    if (this.forgotten.has(form.get("client_id") ?? "")) {
      respondJson(res, 401, { error: "invalid_client", error_description: "unknown client" });
      return;
    }
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
