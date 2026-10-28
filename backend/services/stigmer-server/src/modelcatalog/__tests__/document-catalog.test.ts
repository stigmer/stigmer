/**
 * Document-catalog unit tests, pinning the exported seam a composition
 * builds its own DB-resident provider on: the
 * loud-fail constructor contract, and — through the constructor, the way a
 * composition consumes it — the interpretation rules the extraction moved
 * out of ModelRegistryStore (sanity gate, api-id acceptance, tri-state
 * capabilities, sorted suggestion pools). The store's own suite keeps
 * pinning the same rules through the delegation path, so a divergence
 * between the two surfaces fails one of the two files.
 */
import { describe, expect, it } from "vitest";

import {
  explicitProvider,
  newModelCatalogProviderFromDocument,
} from "../document-catalog.js";

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
    { id: "anthropic/claude", harness: "claude" },
    // A section divider: no id/harness, indexes nothing.
    { $comment: "---- claude models ----" },
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
    expect(catalog.isValidModel("claude", "claude-x")).toBe(false);
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
      catalog.hasPricingVariantForHarness("claude", "anthropic/claude", "fast"),
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

describe("providerOf", () => {
  const catalog = newModelCatalogProviderFromDocument(
    JSON.stringify({
      models: [
        { id: "claude-a", apiModelId: "claude-a-1", provider: "anthropic", harness: "native" },
        { id: "gpt-a", provider: "openai", harness: "native" },
        { id: "qwen-a", provider: "ollama", harness: "native" },
        { id: "claude-a", provider: "bedrock", harness: "claude" },
      ],
    }),
  );

  it("answers a listed model's provider by canonical or api id, per harness", () => {
    expect(catalog.providerOf("native", "claude-a")).toBe("anthropic");
    expect(catalog.providerOf("native", "claude-a-1")).toBe("anthropic");
    expect(catalog.providerOf("native", "gpt-a")).toBe("openai");
    expect(catalog.providerOf("native", "qwen-a")).toBe("ollama");
    expect(catalog.providerOf("claude", "claude-a")).toBe("bedrock");
  });

  it("answers an explicit provider prefix for a model the catalog does not list", () => {
    expect(catalog.providerOf("native", "openai:llama-3.3-70b")).toBe("openai");
    expect(catalog.providerOf("native", "ANTHROPIC:house-claude")).toBe("anthropic");
  });

  it("answers undefined when neither the catalog nor a prefix names one", () => {
    expect(catalog.providerOf("native", "mystery")).toBeUndefined();
    expect(catalog.providerOf("native", "ollama:llama3")).toBeUndefined();
    expect(catalog.providerOf("native", "openai:")).toBeUndefined();
    expect(catalog.providerOf("native", ":gpt")).toBeUndefined();
  });
});

describe("explicitProvider", () => {
  it("reads only anthropic and openai prefixes with a non-empty name", () => {
    expect(explicitProvider("openai:x")).toBe("openai");
    expect(explicitProvider("Anthropic:x")).toBe("anthropic");
    expect(explicitProvider("openai/x")).toBeUndefined();
    expect(explicitProvider("x")).toBeUndefined();
  });
});

describe("defaultModel", () => {
  it("answers the first featured standard entry's provider-facing id, in document order", () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({
        models: [
          { id: "cheap", provider: "anthropic", harness: "native", costTier: "economy", featured: true },
          { id: "plain", provider: "openai", harness: "native", costTier: "standard" },
          { id: "star", apiModelId: "star-1", provider: "anthropic", harness: "native", costTier: "standard", featured: true },
          { id: "star-2", provider: "anthropic", harness: "native", costTier: "standard", featured: true },
        ],
      }),
    );
    expect(catalog.defaultModel("native")).toBe("star-1");
  });

  it("falls back to the first standard entry, reading a missing cost tier as standard", () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({
        models: [
          { id: "cheap", provider: "anthropic", harness: "native", costTier: "economy" },
          { id: "untiered", provider: "openai", harness: "native" },
        ],
      }),
    );
    expect(catalog.defaultModel("native")).toBe("untiered");
  });

  it("answers undefined for a harness with no standard entry", () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({
        models: [{ id: "cheap", provider: "anthropic", harness: "native", costTier: "economy" }],
      }),
    );
    expect(catalog.defaultModel("native")).toBeUndefined();
    expect(catalog.defaultModel("claude")).toBeUndefined();
  });
});
