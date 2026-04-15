import { createConnectTransport } from "@connectrpc/connect-node";
import type { Transport, Interceptor } from "@connectrpc/connect";
import { Stigmer, type TokenProvider } from "@stigmer/sdk";

/**
 * Options for creating a Node.js-compatible Stigmer client.
 *
 * This mirrors the essential fields from `StigmerConfig` but creates a
 * transport using `@connectrpc/connect-node` (native HTTP/2) instead
 * of the browser-oriented `@connectrpc/connect-web`.
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
 * Create a ConnectRPC transport for Node.js using native HTTP/2.
 *
 * Includes an auth interceptor that attaches `Authorization: Bearer <token>`
 * to every outgoing request when a token is available.
 */
export function createNodeTransport(config: NodeClientConfig): Transport {
  const tokenProvider: TokenProvider = config.apiKey
    ? () => config.apiKey!
    : config.getAccessToken ?? (() => null);

  const authInterceptor: Interceptor = (next) => async (request) => {
    const token = await tokenProvider();
    if (token) {
      request.header.set("Authorization", `Bearer ${token}`);
    }
    return next(request);
  };

  return createConnectTransport({
    baseUrl: config.baseUrl,
    httpVersion: "2",
    interceptors: [authInterceptor],
  });
}

/**
 * Create a Stigmer client configured for Node.js environments.
 *
 * Uses `@connectrpc/connect-node` for native HTTP/2 transport instead
 * of the browser-oriented transport that the default `Stigmer` constructor
 * uses. Suitable for CLI tools, server-side scripts, and Ink terminal apps.
 *
 * @example
 * ```typescript
 * import { createNodeClient } from "@stigmer/ink";
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
