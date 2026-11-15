/**
 * The bundled model registry document, pinned into the artifact at build time
 * by the JSON import (tsc/esbuild). `make sync-model-registry` refreshes the
 * committed model-registry.json under ./data/ from the public cloud endpoint on
 * demand, and nothing else edits it, with one exception: a model the provider
 * retires may be removed by hand ahead of the public registry, and is then
 * named in `RETIRED` in `__tests__/bundled-registry.test.ts`, which fails a
 * refresh that brings it back. Its `claude` rows mirror the `stigmer`
 * Anthropic rows (the same id, api id, prices and capabilities: the same API
 * on the same key), and `__tests__/bundled-registry.test.ts` fails a refresh
 * from a registry that lacks them, or a row that drifted from its twin. One
 * non-observable delta: the JSON import re-serializes, so served
 * bytes are minified rather than the file's pretty-printed shape — identical
 * content, and every consumer parses.
 */
import modelRegistryBundle from "./data/model-registry.json" with { type: "json" };

export function bundledModelRegistryDocument(): string {
  return JSON.stringify(modelRegistryBundle);
}
