// Backend client façade.
//
// Builds a single transport (via the SDK's createNodeTransport + the Go-parity
// normalizeEndpoint) and exposes:
//   - `stigmer`: the high-level typed client, used by read verbs.
//   - `transport` + `controller(service)`: the raw Connect layer, so write
//     flows (a later wave) can drive generated controllers directly for full
//     YAML->proto fidelity rather than the high-level client's lossy inputs.
//
// This module holds no business logic: backend selection, token precedence, and
// endpoint shape are delegated to the config layer; org resolution and verb
// dispatch live with the commands and the registry.

import type { DescService } from "@bufbuild/protobuf";
import { type Client, createClient, type Transport } from "@connectrpc/connect";
import { Stigmer, type TokenProvider } from "@stigmer/sdk";
import { createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";
import { type Config, load, resolveEndpoint, resolveToken } from "../config/index.js";
import { CliExitError, ExitCode } from "../errors/index.js";

/** The composed backend client returned by {@link createBackendClient}. */
export interface BackendClient {
  /** High-level typed client for reads (and high-level writes). */
  readonly stigmer: Stigmer;
  /** The shared underlying transport. */
  readonly transport: Transport;
  /** The config this client was built from (for org resolution by callers). */
  readonly config: Config;
  /** Create a raw Connect client for a generated service controller. */
  controller<Desc extends DescService>(service: Desc): Client<Desc>;
  /** Probe the server (unauthenticated) to fail fast on connectivity issues. */
  connect(timeoutMs?: number): Promise<void>;
}

export interface BackendClientOptions {
  /** Config to use; defaults to the on-disk config (or standalone default). */
  readonly config?: Config;
  /** Token-provider override (the auth module supplies a refreshing provider). */
  readonly getAccessToken?: TokenProvider;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export function createBackendClient(options: BackendClientOptions = {}): BackendClient {
  const config = options.config ?? load();
  const baseUrl = normalizeEndpoint(resolveEndpoint(config));

  // Dynamic provider: re-reads env/config on every request so a token refreshed
  // mid-session is picked up. STIGMER_API_KEY > config token precedence lives in
  // resolveToken; a caller-supplied provider (refresh-aware) takes over entirely.
  const tokenProvider: TokenProvider = options.getAccessToken ?? (() => resolveToken(config) || null);

  const transport = createNodeTransport({ baseUrl, getAccessToken: tokenProvider });
  const stigmer = new Stigmer({ baseUrl, getAccessToken: tokenProvider, customTransport: transport });

  return {
    stigmer,
    transport,
    config,
    controller(service) {
      return createClient(service, transport);
    },
    async connect(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
      await withTimeout(stigmer.platform.getServerInfo(), timeoutMs);
    },
  };
}

// Soft timeout: races the RPC against a timer. It cannot cancel the underlying
// request, but the CLI exits immediately after, so the dangling call is moot.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CliExitError("Timed out connecting to the Stigmer server", ExitCode.Connection)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
