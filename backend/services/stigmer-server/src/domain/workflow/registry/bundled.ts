/**
 * Bundled registry documents, pinned into the artifact at build time by the
 * JSON imports (tsc/esbuild). The committed files under ./data/ are generated,
 * never hand-edited: `make gen-task-registry` writes task-kind-registry.json
 * from the proto task metadata (`gen-task-registry-check` fails CI on drift);
 * `make sync-model-registry` refreshes model-registry.json from the public
 * cloud endpoint on demand. (Until the Go server retired in 2026-08 these were byte copies
 * of its go:embed set; the TS server is the only edition now.) One
 * non-observable delta: the JSON import re-serializes, so served bytes are
 * minified rather than the file's pretty-printed shape — identical content,
 * and every consumer parses.
 */
import modelRegistryBundle from "./data/model-registry.json" with { type: "json" };
import taskKindRegistryBundle from "./data/task-kind-registry.json" with { type: "json" };

export function bundledModelRegistryDocument(): string {
  return JSON.stringify(modelRegistryBundle);
}

export function bundledTaskKindRegistryDocument(): string {
  return JSON.stringify(taskKindRegistryBundle);
}
