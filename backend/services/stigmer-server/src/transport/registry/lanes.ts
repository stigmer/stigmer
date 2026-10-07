/**
 * The registry proxy lane — the unified port's plain-HTTP JSON endpoint,
 * ported from the Go server's model_registry.go and wrapped in the
 * registryCORS contract (pkg/server/registry_cors.go, oss#571). The
 * conformance suite
 * (test/conformance/src/suites/registry-proxy.conformance.test.ts) is the
 * executable spec this lane is built against.
 *
 * The transport serves a document it does not own: the model registry
 * from the composed ModelCatalogProvider (src/modelcatalog). The
 * model-registry store's refresh lifecycle is the composition root's
 * concern, not a lane concern.
 *
 * Behavior (Go's registry handlers):
 *   OPTIONS → 204 + the fixed registryCORS allow-lists,
 *   GET     → 200, application/json, Cache-Control: public, max-age=3600,
 *             Access-Control-Allow-Origin: *,
 *   other   → 405 (with the allow-all header — the CORS wrap is
 *             unconditional in Go).
 */
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { applyRegistryCorsHeaders, handleRegistryPreflight } from "../cors.js";
import type { LaneHandler } from "../lanes.js";

/** Registries are static per release: cacheable for an hour (Go handlers). */
const REGISTRY_CACHE_CONTROL = "public, max-age=3600";

export interface RegistryLanes {
  modelRegistryLane: LaneHandler;
}

export interface RegistryLanesOptions {
  /** The composed model-catalog provider the lane serves from. */
  modelRegistryStore: ModelCatalogProvider;
}

export function createRegistryLanes(
  options: RegistryLanesOptions,
): RegistryLanes {
  return {
    modelRegistryLane: registryLane(() => options.modelRegistryStore.document()),
  };
}

function registryLane(document: () => string): LaneHandler {
  return (request, response) => {
    if (handleRegistryPreflight(request, response)) {
      return;
    }
    applyRegistryCorsHeaders(response);
    if (request.method !== "GET") {
      response.statusCode = 405;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", REGISTRY_CACHE_CONTROL);
    response.end(document());
  };
}
