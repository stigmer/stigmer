// Transport reachability probes for the marketplace MCP catalog: live HTTP
// against every vendor endpoint declared in mcp-servers/*.yaml. This is the
// tier between static validation and the credentialed canaries: it answers
// "is the endpoint still there and speaking MCP?" without any credentials.
//
// Network is required, so this file lives under src/__tests__/transport/ and
// is reached only by vitest.transport.config.ts; the static config excludes
// the directory. Run via `make test-seedpack-transport` (root), which is what
// the nightly ci.seedpack-canary lane invokes.
//
// These are canaries against third parties. An environmental network
// condition (DNS failure, timeout, refused or reset connection) says nothing
// about the manifest under test, so a probe SKIPS on those rather than
// failing; a vendor answering 5xx, a non-JSON body to an MCP initialize, or a
// discovery document without authorization_endpoint is a real finding.
//
// Replaces `seedpack/transport_test.go` (the `transport` build tag).

import { describe, expect, it } from "vitest";
import { type CatalogEntry, loadMcpCatalog } from "../support/mcp-catalog.js";

const PROBE_TIMEOUT_MS = 10_000;
const BODY_LIMIT_BYTES = 1 << 20;

const httpEntries = loadMcpCatalog().filter(
  (e) => e.server.spec.serverType.case === "http",
);
const named = (entries: CatalogEntry[]): [string, CatalogEntry][] =>
  entries.map((e) => [e.slug, e]);
const urlOf = (e: CatalogEntry): string => {
  const t = e.server.spec.serverType;
  return t.case === "http" ? t.value.url : "";
};

// Node's fetch wraps transport failures in a TypeError("fetch failed") whose
// `cause` carries the undici or libc code; timeouts arrive as TimeoutError.
const TRANSIENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  const cause = (err as Error & { cause?: unknown }).cause;
  const code =
    typeof cause === "object" && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

async function readBody(res: Response): Promise<string> {
  const text = await res.text();
  return text.length > BODY_LIMIT_BYTES
    ? text.slice(0, BODY_LIMIT_BYTES)
    : text;
}

describe("catalog transport", () => {
  it("has HTTP endpoints to probe", () => {
    expect(httpEntries.length).toBeGreaterThan(0);
  });

  it.concurrent.for(named(httpEntries))(
    "%s: HEAD answers below 5xx",
    { timeout: PROBE_TIMEOUT_MS * 2 },
    async ([slug, e], { skip }) => {
      const url = urlOf(e);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } catch (err) {
        if (isTransientNetworkError(err))
          skip(
            `${slug}: transient network condition: ${(err as Error).message}`,
          );
        throw err;
      }
      expect(
        res.status,
        `HEAD ${url} -> ${res.status}; server may be down`,
      ).toBeLessThan(500);
    },
  );

  // RFC 8414 discovery for servers whose OAuth is a pre-registered vendor app
  // (auth.oauth_app_ref). DCR servers derive discovery from the endpoint
  // itself and are covered by the initialize probe's 401 challenge.
  const vendorOauth = httpEntries.filter(
    (e) => e.server.spec.auth?.oauthAppRef !== undefined,
  );

  it.concurrent.for(named(vendorOauth))(
    "%s: RFC 8414 discovery document is well-formed when the vendor serves one",
    { timeout: PROBE_TIMEOUT_MS * 2 },
    async ([slug, e], { skip }) => {
      const { protocol, host } = new URL(urlOf(e));
      const discoveryUrl = `${protocol}//${host}/.well-known/oauth-authorization-server`;
      let res: Response;
      try {
        res = await fetch(discoveryUrl, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } catch (err) {
        if (isTransientNetworkError(err))
          skip(
            `${slug}: transient network condition: ${(err as Error).message}`,
          );
        throw err;
      }
      // RFC 8414 is optional; a 404 means the vendor does not publish it.
      if (res.status === 404)
        skip(`${slug}: vendor does not publish RFC 8414 discovery`);
      const body = await readBody(res);
      expect(
        res.status,
        `GET ${discoveryUrl} -> ${res.status}: ${body.slice(0, 300)}`,
      ).toBe(200);
      let doc: unknown;
      expect(
        () => (doc = JSON.parse(body)),
        "discovery response must be JSON",
      ).not.toThrow();
      expect(
        doc,
        "discovery document must carry authorization_endpoint",
      ).toHaveProperty("authorization_endpoint");
    },
  );

  // An unauthenticated MCP `initialize`. Without credentials the acceptable
  // answers are: a JSON-RPC result or error (the server speaks MCP), an SSE
  // stream (streamable HTTP servers may answer a POST that way; the Accept
  // header below offers it, per the MCP transport spec), 401/403 (auth
  // required; the endpoint is confirmed reachable), 405 (SSE-only transport),
  // or an empty body. An HTML error page is the failure this probe exists to
  // catch: the URL no longer fronts an MCP server.
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stigmer-canary-test", version: "1.0.0" },
    },
  });

  it.concurrent.for(named(httpEntries))(
    "%s: POST initialize gets an MCP-shaped answer",
    { timeout: PROBE_TIMEOUT_MS * 2 },
    async ([slug, e], { skip }) => {
      const url = urlOf(e);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: initialize,
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } catch (err) {
        if (isTransientNetworkError(err))
          skip(
            `${slug}: transient network condition: ${(err as Error).message}`,
          );
        throw err;
      }
      if (res.status === 405 || res.status === 401 || res.status === 403)
        return;
      if (
        (res.headers.get("content-type") ?? "").startsWith("text/event-stream")
      )
        return;
      const body = await readBody(res);
      if (body.length === 0) return;
      expect(
        () => JSON.parse(body),
        `POST ${url} -> ${res.status}; response should be JSON, not an error page: ${body.slice(0, 300)}`,
      ).not.toThrow();
    },
  );
});
