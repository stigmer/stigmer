/**
 * Bundled registry documents — the TS twin of Go's go:embed in
 * pkg/domain/workflow/registry (registryFS). Both registries are bundled at
 * build time: the JSON imports are pinned into the artifact by tsc/esbuild.
 * The committed data files under ./data/ are copies of the Go server's
 * embeds; a co-located test asserts byte-equality with the Go source so the
 * two editions cannot drift silently. One non-observable delta: the JSON
 * import re-serializes, so served bytes are minified rather than the file's
 * pretty-printed shape — identical content, and every consumer parses.
 */
import modelRegistryBundle from "./data/model-registry.json" with { type: "json" };
import taskKindRegistryBundle from "./data/task-kind-registry.json" with { type: "json" };

export function bundledModelRegistryDocument(): string {
  return JSON.stringify(modelRegistryBundle);
}

export function bundledTaskKindRegistryDocument(): string {
  return JSON.stringify(taskKindRegistryBundle);
}
