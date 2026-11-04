// Per-request gRPC client construction for tool handlers.
//
// Each tool call resolves its credential, opens a short-lived
// authenticated client to stigmer-server with a fixed RPC timeout, runs the
// call, and discards the client. This is intentionally simple — the MCP server
// handles a low volume of calls and transport setup is cheap. Pooling can be
// introduced later without touching call sites.
//
// Credential source, in order:
//   - http: every request carries its own Bearer token via authInfo, which the
//     transport injected from the Authorization header.
//   - an embedder's token provider (BackendTarget.getAccessToken), asked on
//     every call, so a long-running stdio server follows a sign-in its host
//     refreshes (the CLI's `stigmer mcp-server` passes one for a cloud login).
//   - the API key captured once at startup (constant per process).

import { createClient, type Client, type CallOptions, type Transport } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";
import type { TokenProvider } from "@stigmer/client";
import { createNodeTransport, normalizeEndpoint } from "@stigmer/client/node";

/**
 * Per-call RPC timeout: generous for both
 * localhost (milliseconds) and remote endpoints (low seconds), while still
 * failing fast against a misconfigured or unreachable address.
 */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/**
 * The stigmer-server endpoint and startup credential captured at registration
 * time and shared by every tool handler.
 */
export interface BackendTarget {
  readonly serverAddress: string;
  /** stdio startup API key; "" when targeting an unauthenticated backend. */
  readonly apiKey: string;
  /**
   * A provider asked for the credential on every call that brings no bearer of
   * its own, named and typed as the SDK's `StigmerConfig.getAccessToken`. An
   * alternative to `apiKey`: when set, `apiKey` is not used. `null` means no
   * credential; a provider that throws fails that one call.
   */
  readonly getAccessToken?: TokenProvider;
}

/** The subset of the MCP request `extra` this layer reads to resolve a token. */
export interface RequestAuth {
  readonly authInfo?: { readonly token?: string };
}

/**
 * Resolve the credential for an inbound tool call: the per-request Bearer token
 * (http) when present, otherwise the target's token provider when it has one,
 * otherwise its startup API key (stdio). Returns "" when no credential applies,
 * in which case none is attached.
 */
export async function resolveToken(
  extra: RequestAuth | undefined,
  target: BackendTarget,
): Promise<string> {
  const token = extra?.authInfo?.token;
  if (token !== undefined && token !== "") return token;
  if (target.getAccessToken !== undefined) return (await target.getAccessToken()) ?? "";
  return target.apiKey;
}

/**
 * Build an authenticated transport to stigmer-server for a single credential.
 * The address is normalized (scheme/TLS rules) before the transport is built;
 * an empty token attaches no Authorization header.
 *
 * Speaks NATIVE gRPC, not gRPC-web. The bridge is a server-side, in-cluster
 * caller dialing stigmer-server directly, and the server serves native gRPC
 * on its listener (stigmer/stigmer#316: a gRPC-web call answered HTTP 415
 * reaches the model as an opaque "Content-Type error"). This matches the runner's own backend client — the other
 * in-cluster Node caller — which likewise uses native gRPC over HTTP/2.
 */
export function transportForToken(serverAddress: string, token: string): Transport {
  return createNodeTransport({
    baseUrl: normalizeEndpoint(serverAddress),
    apiKey: token === "" ? undefined : token,
    protocol: "grpc",
  });
}

/**
 * Open a short-lived authenticated transport and invoke `fn` with it and the
 * standard call options (RPC timeout pre-applied): the single place that owns transport construction and the timeout. Use this
 * when an operation needs more than one controller over the SAME connection —
 * e.g. the two-step deletes that resolve via the Query controller and delete via
 * the Command controller.
 */
export async function withTransport<T>(
  serverAddress: string,
  token: string,
  fn: (transport: Transport, callOptions: CallOptions) => Promise<T>,
): Promise<T> {
  return fn(transportForToken(serverAddress, token), { timeoutMs: DEFAULT_RPC_TIMEOUT_MS });
}

/**
 * Open a short-lived raw controller client and invoke `fn` with it and the
 * standard call options. The single-controller convenience over
 * {@link withTransport}; call sites that only touch one service stay a
 * one-liner.
 */
export async function withClient<S extends DescService, T>(
  service: S,
  serverAddress: string,
  token: string,
  fn: (client: Client<S>, callOptions: CallOptions) => Promise<T>,
): Promise<T> {
  return withTransport(serverAddress, token, (transport, callOptions) =>
    fn(createClient(service, transport), callOptions),
  );
}
