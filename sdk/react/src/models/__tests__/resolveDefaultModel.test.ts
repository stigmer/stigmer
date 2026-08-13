import { describe, it, expect } from "vitest";
import {
  DEFAULT_CURSOR_MODEL_ID,
  DEFAULT_MODEL_ID,
  resolveDefaultModelId,
  type ModelInfo,
} from "../registry";

/**
 * The harness-default arm is a contract, not a suggestion
 * (stigmer/stigmer#663): this resolution feeds the composer's pill, and
 * the submission adopts what the pill displays — so the default must be
 * what the platform actually runs for an unpinned execution:
 *
 * - cursor → the registry's Auto entry (the runner coerces an empty
 *   model_name to "default")
 * - native → the runner's getDefaultModel() rule (featured + standard
 *   cost, then any standard cost)
 */

function model(overrides: Partial<ModelInfo> & { modelId: string }): ModelInfo {
  return {
    provider: "anthropic",
    displayName: overrides.modelId,
    shortDescription: "",
    speedTier: "fast",
    costTier: "standard",
    harness: "native",
    featured: false,
    serviceTiers: [],
    ...overrides,
  };
}

describe("resolveDefaultModelId — cursor harness", () => {
  it("prefers the Auto entry over featured models listed before it (the production order that caused #663)", () => {
    // Mirrors the live registry: featured premium models precede Auto.
    const models = [
      model({ modelId: "claude-opus-4-8", harness: "cursor", featured: true, costTier: "premium" }),
      model({ modelId: DEFAULT_CURSOR_MODEL_ID, harness: "cursor", featured: true }),
    ];
    expect(resolveDefaultModelId("cursor", models)).toEqual({
      modelId: DEFAULT_CURSOR_MODEL_ID,
      source: "harness_default",
    });
  });

  it("falls back to the first featured cursor model when the registry has no Auto entry", () => {
    const models = [
      model({ modelId: "composer-2.5", harness: "cursor", featured: true }),
    ];
    expect(resolveDefaultModelId("cursor", models).modelId).toBe("composer-2.5");
  });

  it("falls back to the hardcoded cursor id on an empty registry", () => {
    expect(resolveDefaultModelId("cursor", [])).toEqual({
      modelId: DEFAULT_CURSOR_MODEL_ID,
      source: "platform_fallback",
    });
  });

  it("lets an explicit user preference win over Auto", () => {
    const models = [
      model({ modelId: DEFAULT_CURSOR_MODEL_ID, harness: "cursor", featured: true }),
      model({ modelId: "composer-2.5", harness: "cursor", featured: true }),
    ];
    expect(
      resolveDefaultModelId("cursor", models, { userPreference: "composer-2.5" }),
    ).toEqual({ modelId: "composer-2.5", source: "user_preference" });
  });
});

describe("resolveDefaultModelId — native harness", () => {
  it("skips a featured premium model for the featured standard-cost one (the runner's own rule)", () => {
    const models = [
      model({ modelId: "claude-opus-4.6", featured: true, costTier: "premium" }),
      model({ modelId: "claude-sonnet-4.6", featured: true, costTier: "standard" }),
    ];
    expect(resolveDefaultModelId("native", models)).toEqual({
      modelId: "claude-sonnet-4.6",
      source: "harness_default",
    });
  });

  it("falls back to any standard-cost model when no featured one is standard", () => {
    const models = [
      model({ modelId: "claude-opus-4.6", featured: true, costTier: "premium" }),
      model({ modelId: "gpt-4o", featured: false, costTier: "standard" }),
    ];
    expect(resolveDefaultModelId("native", models).modelId).toBe("gpt-4o");
  });

  it("falls back to the first featured model when the registry lists no standard-cost model at all", () => {
    const models = [
      model({ modelId: "claude-opus-4.6", featured: true, costTier: "premium" }),
      model({ modelId: "ollama-local", featured: false, costTier: "economy" }),
    ];
    expect(resolveDefaultModelId("native", models).modelId).toBe("claude-opus-4.6");
  });

  it("falls back to the hardcoded native id on an empty registry", () => {
    expect(resolveDefaultModelId("native", [])).toEqual({
      modelId: DEFAULT_MODEL_ID,
      source: "platform_fallback",
    });
  });

  it("never resolves across harnesses (a cursor Auto entry is invisible to native)", () => {
    const models = [
      model({ modelId: DEFAULT_CURSOR_MODEL_ID, harness: "cursor", featured: true }),
      model({ modelId: "claude-sonnet-4.6", featured: true, costTier: "standard" }),
    ];
    expect(resolveDefaultModelId("native", models).modelId).toBe("claude-sonnet-4.6");
  });
});
