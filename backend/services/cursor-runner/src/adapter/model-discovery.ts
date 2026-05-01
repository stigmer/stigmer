/**
 * Dynamic model discovery via the Cursor API.
 *
 * Wraps Cursor.models.list() with in-memory caching. The runner calls
 * this to validate user-requested model IDs against the live catalog
 * before passing them to Agent.create().
 *
 * In proxy mode, the apiKey is "proxy-managed" — the SDK's internal
 * fetch() call is intercepted by fetch-interceptor.ts and routed through
 * the Stigmer proxy, which injects the real Cursor API key. This is the
 * same path Agent.create() and agent.send() already use.
 */

import { Cursor } from "@cursor/sdk";
import type { ModelListItem } from "@cursor/sdk";

const CACHE_TTL_MS = 15 * 60 * 1000;

let cachedModels: ModelListItem[] | null = null;
let cacheExpiry = 0;

/**
 * Discover available models from the Cursor API.
 *
 * Returns a cached result if within the TTL window. On failure, returns
 * the stale cache (if any) so executions aren't blocked by a transient
 * Cursor API outage.
 */
export async function discoverModels(apiKey: string): Promise<ModelListItem[]> {
  if (cachedModels && Date.now() < cacheExpiry) {
    return cachedModels;
  }

  try {
    const models = await Cursor.models.list({ apiKey });
    cachedModels = models;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    console.log(
      `Model discovery: fetched ${models.length} models from Cursor API`,
    );
    return models;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`Model discovery failed: ${detail}`);

    if (cachedModels) {
      console.warn("Model discovery: using stale cache as fallback");
      return cachedModels;
    }

    return [];
  }
}

/**
 * Check whether a model ID exists in the discovered catalog.
 */
export function isValidModelId(
  models: ModelListItem[],
  id: string,
): boolean {
  return models.some((m) => m.id === id);
}

/**
 * Validate a requested model ID against the discovered catalog.
 * Returns the validated model ID, falling back to "default" when:
 * - The model catalog is empty (discovery failed, no cache)
 * - The requested ID is not in the catalog
 */
export function resolveModelId(
  models: ModelListItem[],
  requestedModel: string,
): string {
  if (!requestedModel || requestedModel === "default") {
    return "default";
  }

  if (models.length === 0) {
    console.warn(
      `Model validation skipped (no catalog available), using requested model "${requestedModel}"`,
    );
    return requestedModel;
  }

  if (isValidModelId(models, requestedModel)) {
    return requestedModel;
  }

  console.warn(
    `Model "${requestedModel}" not found in Cursor catalog (${models.length} models available), falling back to "default"`,
  );
  return "default";
}

/** Reset internal cache. Exported for testing only. */
export function _resetCache(): void {
  cachedModels = null;
  cacheExpiry = 0;
}
