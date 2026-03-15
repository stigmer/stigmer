import { createGrpcWebTransport } from "@connectrpc/connect-web";
import type { Transport, Interceptor } from "@connectrpc/connect";
import type { StigmerRpcConfig } from "./types";
import {
  createAuthInterceptor,
  createAuthRedirectInterceptor,
  errorStripInterceptor,
  rpcMetadataInterceptor,
} from "./interceptors";

/**
 * Create a Connect-RPC gRPC-Web transport configured for a Stigmer server.
 *
 * This is the imperative (non-React) API. It produces a standard Connect-RPC
 * `Transport` that can be used directly with `createClient(service, transport)`
 * in tests, scripts, or any context where React hooks are unavailable.
 *
 * For React component trees, prefer {@link StigmerTransportProvider} which
 * wraps this factory and distributes the transport via context.
 *
 * Built-in interceptors (applied in order):
 * 1. Auth interceptor — attaches `Authorization: Bearer <token>` header
 * 2. RPC metadata interceptor — annotates errors with method name and path
 * 3. Error-strip interceptor — removes gRPC status-code prefixes from messages
 * 4. Auth redirect interceptor — calls `onUnauthenticated` on code 16 (if configured)
 * 5. Any additional interceptors provided via `config.interceptors`
 */
export function createStigmerTransport(config: StigmerRpcConfig): Transport {
  const interceptors: Interceptor[] = [
    createAuthInterceptor(config.getAccessToken),
    rpcMetadataInterceptor,
    errorStripInterceptor,
  ];

  if (config.onUnauthenticated) {
    interceptors.push(
      createAuthRedirectInterceptor(config.onUnauthenticated),
    );
  }

  interceptors.push(...(config.interceptors ?? []));

  return createGrpcWebTransport({
    baseUrl: config.serverUrl,
    useBinaryFormat: true,
    interceptors,
  });
}
