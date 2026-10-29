/**
 * Pins the live tests' one cross-package read (`real-model-registry.ts`):
 * the server's committed registry is where the helper looks, it parses to
 * the shape the live tests read, the Stigmer live model is there with a
 * provider id of its own, and `parseRealRegistry` refuses each malformed shape, naming the file.
 *
 * Runs in the ordinary suite, so the day the server moves or reshapes the
 * file this goes red on that pull request, not in the live lane after a
 * release.
 */
import { describe, expect, it } from "vitest";

import { stigmerRows, parseRealRegistry, providerModelId, realModelRegistry } from "../real-model-registry.js";

describe("realModelRegistry", () => {
  const document = realModelRegistry();

  it("reads the server's committed registry, Stigmer rows present", () => {
    expect(stigmerRows(document).length).toBeGreaterThan(0);
  });

  it("carries the Stigmer live model with a provider id that is not its registry id", () => {
    const haiku = stigmerRows(document).find((m) => m.id === "claude-haiku-4.5");
    expect(haiku, "the Stigmer live cases run on claude-haiku-4.5").toBeDefined();
    expect(providerModelId(haiku!)).not.toBe("claude-haiku-4.5");
  });
});

describe("parseRealRegistry", () => {
  const row = { id: "m", provider: "anthropic", harness: "stigmer" };

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
