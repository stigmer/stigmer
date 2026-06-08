/**
 * Runner self-bootstrap for embedded runners.
 *
 * A cloud embedder's contract should be one endpoint plus one token. From that
 * the runner needs two things it should not have to know or hold ahead of time:
 * the Temporal frontend coordinates to poll for work, and (on cloud) a minted
 * iss=stigmer access token for its Cursor-proxy traffic. This module resolves
 * both at boot from a single control-plane call:
 *
 *   1. Explicit address wins. If TEMPORAL_SERVICE_ADDRESS (or the equivalent
 *      option) is set, use it verbatim — preserves local dev and any caller that
 *      already passes coordinates. Note: this branch does NOT call the control
 *      plane, so no runner token is minted; pinning the address against cloud
 *      means the runner keeps using its existing proxy token. Production desktop
 *      does not pin the address, so this is a dev-only edge.
 *   2. Otherwise discover. With only a token + backend endpoint, ask the control
 *      plane (getRunnerBootstrapConfig). The token presence is the trigger: a
 *      desktop runs MODE=local with a token + proxy, and must still discover the
 *      cloud Temporal it cannot be expected to hardcode. The same response
 *      carries the minted runner token (when the server mints one).
 *   3. Otherwise localhost. A tokenless local runner (OSS, no auth) falls back
 *      to the standard local Temporal.
 *
 * Two distinct failure semantics: the Temporal coordinates are load-bearing, so
 * discovery failure throws — there is no silent localhost fallback once we have
 * committed to discovery, because in a cloud deployment a wrong address fails
 * later in a far more confusing way. The runner token is best-effort: a response
 * that omits it is normal (OSS, or no signing key) and never throws — the runner
 * just keeps its existing token.
 */

// StigmerClient is intentionally NOT statically imported here. It transitively
// pulls in @connectrpc/connect-node, which does `import * as http2 from
// "node:http2"` and snapshots the http2 ESM facade on first import. The Cursor
// SDK HTTP/2 auth interceptor (http2-interceptor.ts) patches `http2.connect`
// via require() and only propagates to that facade if it runs BEFORE the
// snapshot. A static import here would drag connect-node into the runner's
// pre-install module graph (this module is statically imported by runner.ts /
// runner-manager.ts), freezing the facade to the unpatched connect and silently
// breaking BiDi auth. Loading the client dynamically keeps connect-node out of
// the pre-install graph, consistent with the runner's dynamic-import-for-order
// convention. See assertHttp2ConnectPatched() for the boot-time guard.
import type { RunnerBootstrapConfig } from "./client/stigmer-client.js";

const LOCAL_TEMPORAL_ADDRESS = "localhost:7233";
const DEFAULT_TEMPORAL_NAMESPACE = "default";

export interface ResolveTemporalOptions {
  /** Explicit Temporal address from env/options. When non-empty it always wins. */
  readonly explicitAddress?: string | null;
  /** Explicit Temporal namespace, applied alongside an explicit/local address. */
  readonly explicitNamespace?: string | null;
  /** Auth token. Its presence (with no explicit address) triggers discovery. */
  readonly token?: string | null;
  /** Stigmer backend endpoint the runner authenticates against for discovery. */
  readonly stigmerEndpoint: string;
}

/**
 * A minimal discovery client seam, so the resolver can be unit-tested without a
 * live control plane. Defaults to a real {@link StigmerClient}.
 *
 * Async because the default factory loads StigmerClient via dynamic import to
 * keep @connectrpc/connect-node out of the pre-install module graph (see the
 * note on the omitted static import at the top of this file).
 */
export type BootstrapClientFactory = (
  endpoint: string,
  token: string,
) => Promise<{ getRunnerBootstrapConfig(): Promise<RunnerBootstrapConfig> }>;

const defaultClientFactory: BootstrapClientFactory = async (endpoint, token) => {
  const { StigmerClient } = await import("./client/stigmer-client.js");
  return new StigmerClient({ endpoint, token });
};

export async function resolveRunnerBootstrap(
  options: ResolveTemporalOptions,
  clientFactory: BootstrapClientFactory = defaultClientFactory,
): Promise<RunnerBootstrapConfig> {
  const explicit = options.explicitAddress?.trim();
  const namespace = options.explicitNamespace?.trim() || DEFAULT_TEMPORAL_NAMESPACE;

  if (explicit) {
    return { temporalAddress: explicit, temporalNamespace: namespace };
  }

  const token = options.token?.trim();
  if (!token) {
    return {
      temporalAddress: LOCAL_TEMPORAL_ADDRESS,
      temporalNamespace: namespace,
    };
  }

  let discovered: RunnerBootstrapConfig;
  try {
    const client = await clientFactory(options.stigmerEndpoint, token);
    discovered = await client.getRunnerBootstrapConfig();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to discover Temporal coordinates from ${options.stigmerEndpoint}: ${reason}. ` +
        "Set TEMPORAL_SERVICE_ADDRESS explicitly, or upgrade the Stigmer server to one that " +
        "supports runner bootstrap (getRunnerBootstrapConfig).",
    );
  }

  if (!discovered.temporalAddress?.trim()) {
    throw new Error(
      `Runner bootstrap from ${options.stigmerEndpoint} returned an empty Temporal address. ` +
        "Set TEMPORAL_SERVICE_ADDRESS explicitly or check the server's runner-bootstrap configuration.",
    );
  }

  return {
    temporalAddress: discovered.temporalAddress.trim(),
    temporalNamespace: discovered.temporalNamespace?.trim() || DEFAULT_TEMPORAL_NAMESPACE,
    // Best-effort: pass the minted token through when present. Absence is normal
    // (OSS / no signing key) and is handled by the runner, not treated as fatal.
    runnerAccessToken: discovered.runnerAccessToken,
    runnerAccessTokenExpiresInSeconds: discovered.runnerAccessTokenExpiresInSeconds,
  };
}

/** A freshly minted runner proxy token and its remaining lifetime. */
export interface RefreshedRunnerToken {
  token: string;
  expiresInSeconds?: number;
}

/**
 * Re-mint the runner's proxy token from the control plane (best-effort).
 *
 * A long-lived embedded runner holds a minted iss=stigmer token with a TTL and
 * must refresh it before expiry. Unlike {@link resolveRunnerBootstrap}, this:
 *
 *   - ignores the Temporal coordinates — they are resolved once at boot and do
 *     not change for the life of the runner;
 *   - never throws — a transient failure should trigger a retry, not crash a
 *     running runner;
 *   - authenticates with the caller's current control-plane token, which the
 *     host keeps fresh independently, so re-minting works even after the
 *     previous proxy token has fully expired (the chicken-and-egg a self-signed
 *     refresh would hit).
 *
 * Returns undefined when there is no token to authenticate with, the server
 * mints no token, or the call fails — the caller retries.
 */
export async function refreshRunnerAccessToken(
  options: { token: string | null; stigmerEndpoint: string },
  clientFactory: BootstrapClientFactory = defaultClientFactory,
): Promise<RefreshedRunnerToken | undefined> {
  const token = options.token?.trim();
  if (!token) {
    return undefined;
  }
  try {
    const client = await clientFactory(options.stigmerEndpoint, token);
    const config = await client.getRunnerBootstrapConfig();
    if (!config.runnerAccessToken) {
      return undefined;
    }
    return {
      token: config.runnerAccessToken,
      expiresInSeconds: config.runnerAccessTokenExpiresInSeconds,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[runner] Failed to refresh runner access token: ${reason}`);
    return undefined;
  }
}
