import { createGrpcWebTransport } from "@connectrpc/connect-web";
import type { Transport } from "@connectrpc/connect";
import type { StigmerRpcConfig } from "./types";
import { createAuthInterceptor, errorStripInterceptor } from "./interceptors";

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
 * 2. Error-strip interceptor — removes gRPC status-code prefixes from messages
 * 3. Any additional interceptors provided via `config.interceptors`
 */
export function createStigmerTransport(config: StigmerRpcConfig): Transport {
  return createGrpcWebTransport({
    baseUrl: config.serverUrl,
    useBinaryFormat: true,
    interceptors: [
      createAuthInterceptor(config.getAccessToken),
      errorStripInterceptor,
      ...(config.interceptors ?? []),
    ],
  });
}
