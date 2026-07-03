import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { Transport, Interceptor } from "@connectrpc/connect";
import type { StigmerConfig, TokenProvider } from "./config.js";
import {
  createAuthInterceptor,
  rpcMetadataInterceptor,
  errorStripInterceptor,
  createAuthRedirectInterceptor,
} from "./internal/interceptors.js";

/**
 * Create a Connect-RPC transport configured for the Stigmer API.
 *
 * Interceptor chain (applied in order):
 * 1. Auth — attaches `Authorization: Bearer <token>`
 * 2. RPC metadata — annotates errors with method name and service path
 * 3. Error-strip — removes gRPC status-code prefixes from messages
 * 4. Auth redirect — calls `onUnauthenticated` on code 16 (if configured)
 */
export function createStigmerTransport(config: StigmerConfig): Transport {
  const tokenProvider: TokenProvider = config.apiKey
    ? () => config.apiKey!
    : config.getAccessToken!;

  const interceptors: Interceptor[] = [
    createAuthInterceptor(tokenProvider),
    rpcMetadataInterceptor,
    errorStripInterceptor,
  ];

  if (config.onUnauthenticated) {
    interceptors.push(createAuthRedirectInterceptor(config.onUnauthenticated));
  }

  const transportFactory =
    config.transport === "connect"
      ? createConnectTransport
      : createGrpcWebTransport;

  return transportFactory({
    baseUrl: config.baseUrl,
    useBinaryFormat: true,
    interceptors,
    fetch: config.fetch,
  });
}
