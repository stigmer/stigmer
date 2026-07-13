/**
 * Registry endpoint resolution — where the runner fetches the model registry.
 *
 * The model registry (canonical id → provider apiModelId, pricing, tiers) is
 * served at `/v1/proxy/model-registry` by whichever control plane the runner
 * talks to: the cloud API in proxy mode, or the local stigmer-server in
 * direct/local mode (stigmer/stigmer#240). Resolution is therefore
 * topology-based, not token-based:
 *
 *   1. STIGMER_CLOUD_API_URL — explicit override (tests, unusual topologies)
 *   2. STIGMER_PROXY_ENDPOINT — proxy mode: the origin that serves the rest of
 *      the runner's /v1/proxy surface (LLM proxy, checkpoints, artifacts) also
 *      serves the registry
 *   3. STIGMER_BACKEND_ENDPOINT — direct/local mode: the runner's own control
 *      plane, defaulting to the local stigmer-server address
 *
 * A hardcoded cloud URL is deliberately absent: every runner already knows a
 * control-plane origin that serves the registry, so falling back to the hosted
 * API would only mask misconfiguration (and breaks offline/local use).
 */

import { normalizeEndpoint } from "../config.js";

/** Default local stigmer-server origin — mirrors config.ts's local-mode default. */
const DEFAULT_LOCAL_BACKEND = "http://localhost:7234";

/**
 * Resolve the base URL (origin, no path) for model-registry and pricing
 * fetches. See module doc for the tier order.
 */
export function resolveRegistryBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STIGMER_CLOUD_API_URL;
  if (override) return normalizeEndpoint(override);

  const proxyEndpoint = env.STIGMER_PROXY_ENDPOINT;
  if (proxyEndpoint) return normalizeEndpoint(proxyEndpoint);

  return normalizeEndpoint(env.STIGMER_BACKEND_ENDPOINT ?? DEFAULT_LOCAL_BACKEND);
}

/**
 * Build request headers for registry fetches: bearer auth when a token is
 * present (cloud requires it; the local server ignores it).
 */
export function buildRegistryHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env.STIGMER_TOKEN ?? env.STIGMER_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Full URL of the model registry endpoint for the resolved control plane. */
export function resolveModelRegistryUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${resolveRegistryBaseUrl(env)}/v1/proxy/model-registry`;
}
