import { createGrpcWebTransport } from "@connectrpc/connect-node";
import type { Transport, Interceptor } from "@connectrpc/connect";
import { Stigmer, type TokenProvider } from "./index.js";
import {
  createAuthInterceptor,
  rpcMetadataInterceptor,
  errorStripInterceptor,
} from "./internal/interceptors.js";

export {
  createPlatformClientAuth,
  PlatformClientAuth,
  type PlatformClientAuthConfig,
  type MintUserTokenInput,
  type MintUserTokenResult,
} from "./platform-client-auth.js";

/**
 * Configuration for creating a Node.js-compatible Stigmer client.
 *
 * Uses `@connectrpc/connect-node` for native HTTP/2 transport instead
 * of the browser-oriented `@connectrpc/connect-web` that the default
 * `Stigmer` constructor uses.
 */
export interface NodeClientConfig {
  /** Stigmer API server URL (e.g., "https://api.stigmer.ai"). */
  readonly baseUrl: string;

  /** Static API key for authentication. */
  readonly apiKey?: string;

  /** Dynamic token provider for authentication. */
  readonly getAccessToken?: TokenProvider;
}

/**
 * Create a gRPC-web transport for Node.js using native HTTP/2.
 *
 * The interceptor chain matches the browser transport for consistent
 * behavior across runtimes:
 * 1. Auth — attaches `Authorization: Bearer <token>`
 * 2. RPC metadata — annotates errors with method name and service path
 * 3. Error strip — removes gRPC status-code prefixes from messages
 *
 * The browser-specific auth-redirect interceptor (`onUnauthenticated`)
 * is intentionally omitted — Node.js consumers handle auth failures
 * through error handling, not UI redirects.
 */
export function createNodeTransport(config: NodeClientConfig): Transport {
  const tokenProvider: TokenProvider = config.apiKey
    ? () => config.apiKey!
    : config.getAccessToken ?? (() => null);

  const interceptors: Interceptor[] = [
    createAuthInterceptor(tokenProvider),
    rpcMetadataInterceptor,
    errorStripInterceptor,
  ];

  return createGrpcWebTransport({
    baseUrl: config.baseUrl,
    httpVersion: "2",
    interceptors,
  });
}

/**
 * Create a Stigmer client configured for Node.js environments.
 *
 * Uses `@connectrpc/connect-node` for native HTTP/2 transport with the
 * full SDK interceptor chain (auth, RPC metadata, error stripping).
 * Suitable for CLI tools, server-side scripts, and Ink terminal apps.
 *
 * @example
 * ```typescript
 * import { createNodeClient } from "@stigmer/sdk/node";
 *
 * const stigmer = createNodeClient({
 *   baseUrl: "https://api.stigmer.ai",
 *   apiKey: "sk_live_abc123",
 * });
 *
 * const agent = await stigmer.agent.get("my-agent");
 * ```
 */
export function createNodeClient(config: NodeClientConfig): Stigmer {
  const transport = createNodeTransport(config);

  return new Stigmer({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    getAccessToken: config.getAccessToken,
    customTransport: transport,
  });
}

/**
 * Normalize a user-supplied gRPC endpoint into a `baseUrl` for
 * {@link createNodeTransport} / {@link createNodeClient}.
 *
 * Stigmer backends are configured with a bare `host:port` (e.g.
 * `localhost:7234`) or a full URL, but the Connect transport requires a URL
 * with a scheme. This helper mirrors the TLS decision of the Go server's
 * endpoint rule — loopback is plaintext, an explicit `:443` is TLS, any other
 * host without a port gets `:443` + TLS — and emits the resulting URL.
 *
 * It deliberately reproduces the Go rule's quirk of deriving TLS from the
 * *port*, not the input scheme (so `https://host:8080` resolves to `http://`),
 * so that the TS clients dial exactly where the Go MCP server and CLI do today.
 * The shape differs from Go's `(host:port, useTLS)` return because the TS
 * transport is URL-based, not dial-based.
 *
 * @example
 * normalizeEndpoint("localhost:7234")      // "http://localhost:7234"
 * normalizeEndpoint("api.stigmer.ai")      // "https://api.stigmer.ai:443"
 * normalizeEndpoint("api.stigmer.ai:443")  // "https://api.stigmer.ai:443"
 * normalizeEndpoint("http://internal:8080")// "http://internal:8080"
 * normalizeEndpoint("https://internal:80") // "http://internal:80" (TLS from port, not scheme)
 */
export function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim();
  if (endpoint === "") {
    throw new Error("normalizeEndpoint: endpoint must not be empty");
  }

  // gRPC targets are host:port; the scheme (if any) is informational and is
  // stripped so the TLS decision derives solely from the resolved port.
  endpoint = endpoint.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (endpoint === "") {
    throw new Error("normalizeEndpoint: endpoint has no host");
  }

  const { host, port } = splitHostPort(endpoint);

  if (port !== "") {
    return `${port === "443" ? "https" : "http"}://${endpoint}`;
  }

  // No explicit port: loopback stays plaintext as-is; everything else is
  // assumed to be a public TLS endpoint on :443.
  if (isLoopbackHost(host)) {
    return `http://${endpoint}`;
  }
  return `https://${endpoint}:443`;
}

/**
 * Split a `host:port` authority, tolerating bracketed IPv6 (`[::1]:443`) and
 * bare IPv6 (`::1`, treated as host-only). Mirrors the parsing intent of Go's
 * `net.SplitHostPort` for the cases the endpoint rule cares about.
 */
function splitHostPort(authority: string): { host: string; port: string } {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close === -1) return { host: authority, port: "" };
    const host = authority.slice(0, close + 1);
    const rest = authority.slice(close + 1);
    return rest.startsWith(":") ? { host, port: rest.slice(1) } : { host, port: "" };
  }

  const lastColon = authority.lastIndexOf(":");
  // No colon, or multiple colons without brackets (a bare IPv6 literal) → no port.
  if (lastColon === -1 || authority.indexOf(":") !== lastColon) {
    return { host: authority, port: "" };
  }
  return { host: authority.slice(0, lastColon), port: authority.slice(lastColon + 1) };
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
