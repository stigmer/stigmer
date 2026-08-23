/**
 * Registry proxy lanes — the unified port's plain-HTTP JSON endpoints,
 * ported from pkg/domain/workflow/registry/{task_kind_registry,
 * model_registry}.go and wrapped in the registryCORS contract
 * (pkg/server/registry_cors.go, oss#571). The CW-10 conformance suite
 * (test/conformance/src/suites/registry-proxy.conformance.test.ts) is the
 * executable spec these lanes are built against.
 *
 * Both registries are BUNDLED at build time: Go's go:embed becomes a JSON
 * import that esbuild/tsc pin into the artifact. The committed data files
 * under ./data/ are copies of the Go server's embeds; a co-located test
 * asserts byte-equality with the Go source so the two editions cannot
 * drift silently. One non-observable delta: the JSON import re-serializes,
 * so the served bytes are minified rather than the file's pretty-printed
 * shape — identical content, and every consumer parses.
 *
 * Behavior per lane (Go task_kind_registry.go:33-51):
 *   OPTIONS → 204 + the fixed registryCORS allow-lists,
 *   GET     → 200, application/json, Cache-Control: public, max-age=3600,
 *             Access-Control-Allow-Origin: *,
 *   other   → 405 (with the allow-all header — the CORS wrap is
 *             unconditional in Go).
 */
import type { Logger } from "../../boot/logger.js";
import { applyRegistryCorsHeaders, handleRegistryPreflight } from "../cors.js";
import type { LaneHandler } from "../lanes.js";
import { ModelRegistryStore } from "./model-registry-store.js";
import modelRegistryBundle from "./data/model-registry.json" with { type: "json" };
import taskKindRegistryBundle from "./data/task-kind-registry.json" with { type: "json" };

/** Registries are static per release: cacheable for an hour (Go handlers). */
const REGISTRY_CACHE_CONTROL = "public, max-age=3600";

export interface RegistryLanes {
  taskKindRegistryLane: LaneHandler;
  modelRegistryLane: LaneHandler;
  /** Kicks the model-registry background refresh (no-op when disabled). */
  start(): void;
  /** Stops the refresh timer (shutdown). */
  stop(): void;
}

export interface RegistryLanesOptions {
  modelRegistryUpstream: string;
  modelRegistryRefreshEnabled: boolean;
  logger: Logger;
  /** Test seam forwarded to the store's upstream fetch. */
  fetchImpl?: typeof fetch;
}

export function createRegistryLanes(options: RegistryLanesOptions): RegistryLanes {
  const store = new ModelRegistryStore({
    bundledDocument: JSON.stringify(modelRegistryBundle),
    upstreamOrigin: options.modelRegistryUpstream,
    refreshEnabled: options.modelRegistryRefreshEnabled,
    logger: options.logger,
    fetchImpl: options.fetchImpl,
  });

  const taskKindDocument = JSON.stringify(taskKindRegistryBundle);

  return {
    taskKindRegistryLane: registryLane(() => taskKindDocument),
    modelRegistryLane: registryLane(() => store.document()),
    start: () => store.startRefresh(),
    stop: () => store.stopRefresh(),
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
