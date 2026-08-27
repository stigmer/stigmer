/**
 * Registry proxy lanes — the unified port's plain-HTTP JSON endpoints,
 * ported from pkg/domain/workflow/registry/{task_kind_registry,
 * model_registry}.go and wrapped in the registryCORS contract
 * (pkg/server/registry_cors.go, oss#571). The CW-10 conformance suite
 * (test/conformance/src/suites/registry-proxy.conformance.test.ts) is the
 * executable spec these lanes are built against.
 *
 * The documents come from the workflow domain's registry module — the
 * domain owns the registry, the transport serves FROM it (Go's ownership,
 * restored by the workflow-family port's DD-A; the model-registry store's
 * refresh lifecycle is the composition root's concern now, not a lane
 * concern).
 *
 * Behavior per lane (Go task_kind_registry.go:33-51):
 *   OPTIONS → 204 + the fixed registryCORS allow-lists,
 *   GET     → 200, application/json, Cache-Control: public, max-age=3600,
 *             Access-Control-Allow-Origin: *,
 *   other   → 405 (with the allow-all header — the CORS wrap is
 *             unconditional in Go).
 */
import type { ModelCatalogProvider } from "../../domain/workflow/registry/model-catalog-provider.js";
import { applyRegistryCorsHeaders, handleRegistryPreflight } from "../cors.js";
import type { LaneHandler } from "../lanes.js";

/** Registries are static per release: cacheable for an hour (Go handlers). */
const REGISTRY_CACHE_CONTROL = "public, max-age=3600";

export interface RegistryLanes {
  taskKindRegistryLane: LaneHandler;
  modelRegistryLane: LaneHandler;
}

export interface RegistryLanesOptions {
  /** The task-kind registry document (static per release). */
  taskKindRegistryDocument: string;
  /** The composed model-catalog provider the lane serves from (DD-008). */
  modelRegistryStore: ModelCatalogProvider;
}

export function createRegistryLanes(
  options: RegistryLanesOptions,
): RegistryLanes {
  return {
    taskKindRegistryLane: registryLane(() => options.taskKindRegistryDocument),
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
