/**
 * The bundled model registry document, pinned into the artifact at build time
 * by the JSON import (tsc/esbuild). The committed file under ./data/ is never
 * hand-edited: `make sync-model-registry` refreshes model-registry.json from
 * the public cloud endpoint on demand. (Until the Go server retired in 2026-08
 * it was a byte copy of its go:embed set; the TS server is the only edition
 * now.) One non-observable delta: the JSON import re-serializes, so served
 * bytes are minified rather than the file's pretty-printed shape — identical
 * content, and every consumer parses.
 */
import modelRegistryBundle from "./data/model-registry.json" with { type: "json" };

export function bundledModelRegistryDocument(): string {
  return JSON.stringify(modelRegistryBundle);
}
