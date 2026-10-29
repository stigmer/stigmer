/**
 * Runner self-bootstrap for embedded runners.
 *
 * A cloud embedder's contract should be one endpoint plus one token. From that
 * the runner needs what it should not have to know or hold ahead of time: the
 * Temporal frontend coordinates to poll for work, (on cloud) a minted
 * iss=stigmer access token for its proxy traffic, and the MCP bridge its
 * built-in Stigmer tools connect to when the server has one (stigmer#1374:
 * without it, a desktop runner spawns a local `stigmer mcp-server` its machine
 * may not have). This module resolves them at boot from a single control-plane
 * call, before anything consumes the runner's configuration, the agent host
 * included:
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
 * later in a far more confusing way. The runner token and the bridge are
 * best-effort: a response that omits them is normal (OSS, no signing key, no
 * bridge) and never throws — the runner keeps its existing token and serves its
 * built-in tools locally. A bridge the runner's own STIGMER_MCP_BRIDGE_ENDPOINT
 * names wins over a discovered one; the composition roots apply that rule.
 */

// StigmerClient is loaded dynamically, not statically imported here: it
// transitively pulls in @connectrpc/connect-node, and this module is
// statically imported by runner.ts / runner-manager.ts, whose boot path
// loads the client only when discovery needs it.
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
 * keep @connectrpc/connect-node out of the module graph of a boot that never
 * discovers (see the note on the omitted static import at the top of this
 * file).
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
    // Server-managed payload-encryption keys ride the same best-effort lane:
    // absent on OSS (env-configured keys) and on cloud servers predating key
    // management. Note the explicit-address and localhost branches above return
    // none by construction — key management only exists where discovery does.
    payloadEncryption: discovered.payloadEncryption,
    // Best-effort as well: absent wherever the server offers no bridge.
    mcpBridgeEndpoint: discovered.mcpBridgeEndpoint?.trim() || undefined,
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
