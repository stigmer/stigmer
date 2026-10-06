/**
 * The bundled task-kind registry document, pinned into the artifact at build
 * time by the JSON import (tsc/esbuild). The committed file under ./data/ is
 * generated, never hand-edited: `make gen-task-registry` writes
 * task-kind-registry.json from the proto task metadata
 * (`gen-task-registry-check` fails CI on drift). The model registry document
 * is bundled beside the model catalog (src/modelcatalog/bundled.ts). One
 * non-observable delta: the JSON import re-serializes, so served bytes are
 * minified rather than the file's pretty-printed shape — identical content,
 * and every consumer parses.
 */
import taskKindRegistryBundle from "./data/task-kind-registry.json" with { type: "json" };

export function bundledTaskKindRegistryDocument(): string {
  return JSON.stringify(taskKindRegistryBundle);
}
