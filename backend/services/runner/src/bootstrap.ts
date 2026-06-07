/**
 * Temporal coordinate self-discovery for embedded runners.
 *
 * A cloud embedder's contract should be one endpoint plus one token. The runner
 * needs a Temporal frontend address and namespace to poll for work, but those
 * are infrastructure details an integrator should not have to know. This module
 * resolves them at boot:
 *
 *   1. Explicit address wins. If TEMPORAL_SERVICE_ADDRESS (or the equivalent
 *      option) is set, use it verbatim — preserves local dev and any caller that
 *      already passes coordinates.
 *   2. Otherwise discover. With only a token + backend endpoint, ask the control
 *      plane (getRunnerBootstrapConfig). The token presence is the trigger: a
 *      desktop runs MODE=local with a token + proxy, and must still discover the
 *      cloud Temporal it cannot be expected to hardcode.
 *   3. Otherwise localhost. A tokenless local runner (OSS, no auth) falls back
 *      to the standard local Temporal.
 *
 * Discovery failure throws — there is no silent localhost fallback once we have
 * committed to discovery, because in a cloud deployment a wrong address fails
 * later in a far more confusing way.
 */

import { StigmerClient } from "./client/stigmer-client.js";
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
 */
export type BootstrapClientFactory = (
  endpoint: string,
  token: string,
) => { getRunnerBootstrapConfig(): Promise<RunnerBootstrapConfig> };

const defaultClientFactory: BootstrapClientFactory = (endpoint, token) =>
  new StigmerClient({ endpoint, token });

export async function resolveTemporalCoordinates(
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
    discovered = await clientFactory(options.stigmerEndpoint, token).getRunnerBootstrapConfig();
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
  };
}
