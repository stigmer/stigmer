import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL_ID,
  resolveDefaultModelId,
  type ModelInfo,
} from "../registry";

/**
 * The harness-default arm is a contract, not a suggestion
 * (stigmer/stigmer#663): this resolution feeds the composer's pill, and
 * the submission adopts what the pill displays — so the default must be
 * what the platform actually runs for an unpinned run: the runner's
 * getDefaultModel() rule (featured + standard cost, then any standard
 * cost), in the engine's own rows.
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

  it("never resolves across harnesses (a Claude-harness row is invisible to native)", () => {
    const models = [
      model({ modelId: "claude-haiku-4.5", harness: "claude", featured: true, costTier: "standard" }),
      model({ modelId: "claude-sonnet-4.6", featured: true, costTier: "standard" }),
    ];
    expect(resolveDefaultModelId("native", models).modelId).toBe("claude-sonnet-4.6");
  });
});

describe("resolveDefaultModelId — claude harness", () => {
  it("applies the same standard-cost rule within the Claude harness's own rows", () => {
    const models = [
      model({ modelId: "claude-sonnet-4.6", featured: true, costTier: "standard" }),
      model({ modelId: "claude-opus-4.6", harness: "claude", featured: true, costTier: "premium" }),
      model({ modelId: "claude-haiku-4.5", harness: "claude", featured: true, costTier: "standard" }),
    ];
    expect(resolveDefaultModelId("claude", models)).toEqual({
      modelId: "claude-haiku-4.5",
      source: "harness_default",
    });
  });

  it("lets an explicit user preference win over the harness default", () => {
    const models = [
      model({ modelId: "claude-haiku-4.5", harness: "claude", featured: true, costTier: "standard" }),
      model({ modelId: "claude-opus-4.6", harness: "claude", featured: true, costTier: "premium" }),
    ];
    expect(
      resolveDefaultModelId("claude", models, { userPreference: "claude-opus-4.6" }),
    ).toEqual({ modelId: "claude-opus-4.6", source: "user_preference" });
  });

  it("falls back to the hardcoded Claude model on an empty registry", () => {
    expect(resolveDefaultModelId("claude", [])).toEqual({
      modelId: DEFAULT_MODEL_ID,
      source: "platform_fallback",
    });
  });
});
