import { createGrpcWebTransport } from "@connectrpc/connect-node";
import type { Transport, Interceptor } from "@connectrpc/connect";
import { Stigmer, type TokenProvider } from "./index";
import {
  createAuthInterceptor,
  rpcMetadataInterceptor,
  errorStripInterceptor,
} from "./internal/interceptors";

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
