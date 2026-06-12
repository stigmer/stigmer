// Per-request gRPC client construction for tool handlers.
//
// Parity contract (mirrors Go internal/domains/conn.go WithConnection + the
// auth/grpc layer): each tool call resolves its credential, opens a short-lived
// authenticated client to stigmer-server with a fixed RPC timeout, runs the
// call, and discards the client. This is intentionally simple — the MCP server
// handles a low volume of calls and transport setup is cheap. Pooling can be
// introduced later without touching call sites.
//
// Credential source mirrors Go precisely:
//   - stdio: the API key is captured once at startup (constant per process).
//   - http: every request carries its own Bearer token via authInfo, which the
//     transport injected from the Authorization header.

import { createClient, type Client, type CallOptions, type Transport } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";
import { createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";

/**
 * Per-call RPC timeout. Mirrors Go's DefaultRPCTimeout: generous for both
 * localhost (milliseconds) and remote endpoints (low seconds), while still
 * failing fast against a misconfigured or unreachable address.
 */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/**
 * The stigmer-server endpoint and startup credential captured at registration
 * time and shared by every tool handler. Mirrors the `serverAddress` closure +
 * startup API key that the Go handlers capture.
 */
export interface BackendTarget {
  readonly serverAddress: string;
  /** stdio startup API key; "" when targeting an unauthenticated backend. */
  readonly apiKey: string;
}

/** The subset of the MCP request `extra` this layer reads to resolve a token. */
export interface RequestAuth {
  readonly authInfo?: { readonly token?: string };
}

/**
 * Resolve the credential for an inbound tool call: the per-request Bearer token
 * (http) when present, otherwise the startup API key (stdio). Returns "" when
 * targeting an unauthenticated backend, in which case no credential is attached.
 */
export function resolveToken(extra: RequestAuth | undefined, fallback: string): string {
  const token = extra?.authInfo?.token;
  return token !== undefined && token !== "" ? token : fallback;
}

/**
 * Build an authenticated transport to stigmer-server for a single credential.
 * The address is normalized (scheme/TLS rules) before the transport is built;
 * an empty token attaches no Authorization header.
 */
export function transportForToken(serverAddress: string, token: string): Transport {
  return createNodeTransport({
    baseUrl: normalizeEndpoint(serverAddress),
    apiKey: token === "" ? undefined : token,
  });
}

/**
 * Open a short-lived raw controller client and invoke `fn` with it and the
 * standard call options (RPC timeout pre-applied). Mirrors Go's WithConnection:
 * the single place that owns transport construction and the timeout so call
 * sites stay a one-liner.
 */
export async function withClient<S extends DescService, T>(
  service: S,
  serverAddress: string,
  token: string,
  fn: (client: Client<S>, callOptions: CallOptions) => Promise<T>,
): Promise<T> {
  const client = createClient(service, transportForToken(serverAddress, token));
  return fn(client, { timeoutMs: DEFAULT_RPC_TIMEOUT_MS });
}
