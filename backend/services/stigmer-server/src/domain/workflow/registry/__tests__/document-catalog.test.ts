/**
 * Document-catalog unit tests, pinning the exported seam the C1 cloud
 * composition builds its DB-resident provider on (20260827.04): the
 * loud-fail constructor contract, and — through the constructor, the way a
 * composition consumes it — the interpretation rules the extraction moved
 * out of ModelRegistryStore (sanity gate, api-id acceptance, tri-state
 * capabilities, sorted suggestion pools). The store's own suite keeps
 * pinning the same rules through the delegation path, so a divergence
 * between the two surfaces fails one of the two files.
 */
import { describe, expect, it } from "vitest";

import { newModelCatalogProviderFromDocument } from "../document-catalog.js";

const DOCUMENT = JSON.stringify({
  models: [
    {
      id: "anthropic/claude",
      harness: "native",
      apiModelId: "claude-x",
      pricingVariants: { fast: { input: 1 } },
      capabilities: { thinking: true },
    },
    { id: "openai/gpt", harness: "native" },
    { id: "anthropic/claude", harness: "cursor" },
    // A section divider: no id/harness, indexes nothing.
    { $comment: "---- cursor models ----" },
    // Tri-state rule: false and non-boolean values declare nothing.
    {
      id: "meta/llama",
      harness: "native",
      capabilities: { thinking: false, vision: "yes" },
    },
  ],
});

describe("newModelCatalogProviderFromDocument", () => {
  it("throws on an unparseable document", () => {
    expect(() => newModelCatalogProviderFromDocument("not json")).toThrow(
      "model-registry document is invalid or indexes no models",
    );
  });

  it("throws on a parseable document that indexes no models", () => {
    expect(() =>
      newModelCatalogProviderFromDocument(
        JSON.stringify({ models: [{ $comment: "dividers only" }] }),
      ),
    ).toThrow("model-registry document is invalid or indexes no models");
  });

  it("serves the exact document bytes it was built from", () => {
    const catalog = newModelCatalogProviderFromDocument(DOCUMENT);
    expect(catalog.document()).toBe(DOCUMENT);
  });

  it("validates canonical ids and provider api ids per harness", () => {
    const catalog = newModelCatalogProviderFromDocument(DOCUMENT);
    expect(catalog.isValidModel("native", "anthropic/claude")).toBe(true);
    expect(catalog.isValidModel("native", "claude-x")).toBe(true);
    expect(catalog.isValidModel("cursor", "claude-x")).toBe(false);
    expect(catalog.isValidModelOnAnyHarness("anthropic/claude")).toBe(true);
    expect(catalog.isValidModelOnAnyHarness("unknown/model")).toBe(false);
    expect(catalog.hasHarness("native")).toBe(true);
    expect(catalog.hasHarness("java")).toBe(false);
    expect(catalog.hasAnyModels()).toBe(true);
  });

  it("answers sorted canonical suggestion pools without api ids", () => {
    const catalog = newModelCatalogProviderFromDocument(DOCUMENT);
    expect(catalog.canonicalModels("native")).toEqual([
      "anthropic/claude",
      "meta/llama",
      "openai/gpt",
    ]);
    expect(catalog.canonicalModelsAcrossHarnesses()).toEqual([
      "anthropic/claude",
      "meta/llama",
      "openai/gpt",
    ]);
  });

  it("indexes pricing variants by key set, any-harness and per-harness", () => {
    const catalog = newModelCatalogProviderFromDocument(DOCUMENT);
    expect(catalog.hasPricingVariant("anthropic/claude", "fast")).toBe(true);
    expect(catalog.hasPricingVariant("openai/gpt", "fast")).toBe(false);
    expect(
      catalog.hasPricingVariantForHarness("native", "claude-x", "fast"),
    ).toBe(true);
    expect(
      catalog.hasPricingVariantForHarness("cursor", "anthropic/claude", "fast"),
    ).toBe(false);
    expect(catalog.canonicalModelsWithVariant("fast")).toEqual([
      "anthropic/claude",
    ]);
    expect(
      catalog.canonicalModelsWithVariantForHarness("native", "fast"),
    ).toEqual(["anthropic/claude"]);
  });

  it("declares capabilities only on literal true (tri-state rule)", () => {
    const catalog = newModelCatalogProviderFromDocument(DOCUMENT);
    expect(
      catalog.hasCapabilityForHarness("native", "anthropic/claude", "thinking"),
    ).toBe(true);
    expect(
      catalog.hasCapabilityForHarness("native", "meta/llama", "thinking"),
    ).toBe(false);
    expect(
      catalog.hasCapabilityForHarness("native", "meta/llama", "vision"),
    ).toBe(false);
    expect(
      catalog.canonicalModelsWithCapabilityForHarness("native", "thinking"),
    ).toEqual(["anthropic/claude"]);
  });
});
