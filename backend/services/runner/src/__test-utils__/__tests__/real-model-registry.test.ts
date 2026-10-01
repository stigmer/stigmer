/**
 * Pins the live tests' one cross-package read (`real-model-registry.ts`):
 * the server's committed registry is where the helper looks, it parses to
 * the shape the live tests read, the native live model is there with a
 * provider id of its own, the Cursor Auto pool is left out of the catalog
 * rows, and `parseRealRegistry` refuses each malformed shape, naming the file.
 *
 * Runs in the ordinary suite, so the day the server moves or reshapes the
 * file this goes red on that pull request, not in the live lane after a
 * release.
 */
import { describe, expect, it } from "vitest";

import { cursorCatalogRows, nativeRows, parseRealRegistry, providerModelId, realModelRegistry } from "../real-model-registry.js";

describe("realModelRegistry", () => {
  const document = realModelRegistry();

  it("reads the server's committed registry, native and Cursor rows both present", () => {
    expect(nativeRows(document).length).toBeGreaterThan(0);
    expect(cursorCatalogRows(document).length).toBeGreaterThan(0);
  });

  it("carries the native live model with a provider id that is not its registry id", () => {
    const haiku = nativeRows(document).find((m) => m.id === "claude-haiku-4.5");
    expect(haiku, "the native live cases run on claude-haiku-4.5").toBeDefined();
    expect(providerModelId(haiku!)).not.toBe("claude-haiku-4.5");
  });

  it("leaves the Cursor Auto pool out of the catalog rows", () => {
    expect(cursorCatalogRows(document).map((m) => m.id)).not.toContain("default");
  });
});

describe("parseRealRegistry", () => {
  const row = { id: "m", provider: "anthropic", harness: "native" };

  it("accepts a document of rows, a provider id optional", () => {
    expect(parseRealRegistry(JSON.stringify({ models: [row, { ...row, apiModelId: "m-1" }] }), "f.json").models).toHaveLength(2);
  });

  it.each([
    ["no models array", {}],
    ["models not an array", { models: {} }],
    ["a row missing its harness", { models: [{ id: "m", provider: "anthropic" }] }],
    ["a provider id that is not a string", { models: [{ ...row, apiModelId: 7 }] }],
    ["not an object at all", null],
  ])("refuses %s, naming the file", (_case, document) => {
    expect(() => parseRealRegistry(JSON.stringify(document), "data/model-registry.json")).toThrow(
      /data\/model-registry\.json is not a model registry document/,
    );
  });
});
