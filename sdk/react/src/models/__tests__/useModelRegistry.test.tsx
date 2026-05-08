import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useModelRegistry } from "../useModelRegistry";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
  parseRegistryJson,
} from "../registry";
import { ModelRegistryContext } from "../ModelRegistryContext";
import type { ModelRegistryState } from "../ModelRegistryContext";
import type { ModelInfo } from "../registry";

/**
 * Minimal inline registry data for tests. Mirrors the shape of the
 * API response without depending on a static JSON file.
 */
const TEST_REGISTRY_JSON = {
  models: [
    {
      id: "claude-sonnet-4.6",
      displayName: "Claude Sonnet 4.6",
      shortDescription: "Balanced capability",
      speedTier: "fast",
      provider: "anthropic",
      harness: "native",
      costTier: "standard",
      featured: true,
      pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
    },
    {
      id: "claude-opus-4.6",
      displayName: "Claude Opus 4.6",
      shortDescription: "Complex reasoning",
      speedTier: "slow",
      provider: "anthropic",
      harness: "native",
      costTier: "premium",
      featured: true,
      pricing: { inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
    },
    {
      id: "gpt-4o",
      displayName: "GPT-4o",
      shortDescription: "Fast reasoning",
      speedTier: "fast",
      provider: "openai",
      harness: "native",
      costTier: "standard",
      featured: true,
      pricing: { inputPricePerMillion: 2.5, outputPricePerMillion: 10, cacheWritePricePerMillion: 2.5, cacheReadPricePerMillion: 1.25 },
    },
    {
      id: "default",
      displayName: "Cursor Auto",
      shortDescription: "Automatic model selection",
      speedTier: "fast",
      provider: "cursor",
      harness: "cursor",
      costTier: "standard",
      featured: true,
      pricing: { inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 },
    },
    {
      id: "claude-4.6-sonnet",
      displayName: "Claude 4.6 Sonnet",
      shortDescription: "Balanced Cursor model",
      speedTier: "fast",
      provider: "anthropic",
      harness: "cursor",
      costTier: "standard",
      featured: false,
      pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
    },
    {
      id: "ollama-local",
      displayName: "Ollama Local",
      shortDescription: "Local model",
      speedTier: "fast",
      provider: "ollama",
      harness: "native",
      costTier: "economy",
      featured: false,
      pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0 },
    },
  ],
};

const TEST_MODELS: readonly ModelInfo[] = parseRegistryJson(TEST_REGISTRY_JSON);

function createWrapper(models: readonly ModelInfo[] = TEST_MODELS) {
  const state: ModelRegistryState = { models, isLoading: false, error: null };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ModelRegistryContext.Provider value={state}>
        {children}
      </ModelRegistryContext.Provider>
    );
  };
}

describe("useModelRegistry", () => {
  describe("unified mode (no harness)", () => {
    it("excludes DISABLED_PROVIDERS from models", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      for (const model of result.current.models) {
        expect(DISABLED_PROVIDERS.has(model.provider)).toBe(false);
      }
    });

    it("includes models from both native and cursor harnesses", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const harnesses = new Set(result.current.models.map((m) => m.harness));
      expect(harnesses.has("native")).toBe(true);
      expect(harnesses.has("cursor")).toBe(true);
    });

    it("includes all non-disabled models", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const expected = TEST_MODELS.filter(
        (m) => !DISABLED_PROVIDERS.has(m.provider),
      );
      expect(result.current.models).toHaveLength(expected.length);
    });

    it("resolves defaultModel to DEFAULT_MODEL_ID", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      expect(result.current.defaultModel.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("groups models by provider in byProvider map", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      for (const [provider, models] of result.current.byProvider) {
        for (const m of models) {
          expect(m.provider).toBe(provider);
        }
      }
    });

    it("returns providers matching byProvider keys in order", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const fromMap = Array.from(result.current.byProvider.keys());
      expect(result.current.providers).toEqual(fromMap);
    });

    it("looks up enabled models by getModel", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const model = result.current.getModel(DEFAULT_MODEL_ID);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("returns undefined for disabled provider models via getModel", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const disabledModel = TEST_MODELS.find((m) =>
        DISABLED_PROVIDERS.has(m.provider),
      );
      if (disabledModel) {
        expect(result.current.getModel(disabledModel.modelId)).toBeUndefined();
      }
    });

    it("returns undefined for unknown model IDs via getModel", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      expect(result.current.getModel("nonexistent-model")).toBeUndefined();
    });

    it("returns featured models subset", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      expect(result.current.featured.length).toBeGreaterThan(0);
      for (const model of result.current.featured) {
        expect(model.featured).toBe(true);
      }
    });

    it("featured models are a subset of all models", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const allKeys = new Set(
        result.current.models.map((m) => modelKey(m.harness, m.modelId)),
      );
      for (const model of result.current.featured) {
        expect(allKeys.has(modelKey(model.harness, model.modelId))).toBe(true);
      }
    });

    it("resolves models by compound key via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const key = modelKey("native", DEFAULT_MODEL_ID);
      const model = result.current.getByKey(key);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_MODEL_ID);
      expect(model!.harness).toBe("native");
    });

    it("resolves cursor models by compound key via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      const key = modelKey("cursor", DEFAULT_CURSOR_MODEL_ID);
      const model = result.current.getByKey(key);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);
      expect(model!.harness).toBe("cursor");
    });

    it("returns undefined for unknown compound keys via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      expect(result.current.getByKey("native/nonexistent")).toBeUndefined();
    });
  });

  describe("native harness (explicit)", () => {
    it("shows only native-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      { wrapper: createWrapper() });
      for (const model of result.current.models) {
        expect(model.harness).toBe("native");
      }
    });

    it("excludes cursor-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      { wrapper: createWrapper() });
      const cursorModels = result.current.models.filter(
        (m) => m.harness === "cursor",
      );
      expect(cursorModels).toHaveLength(0);
    });

    it("resolves defaultModel to the first featured native model", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      { wrapper: createWrapper() });
      const featured = result.current.featured;
      expect(featured.length).toBeGreaterThan(0);
      expect(result.current.defaultModel.modelId).toBe(featured[0].modelId);
    });
  });

  describe("cursor harness", () => {
    it("shows only cursor-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      { wrapper: createWrapper() });
      for (const model of result.current.models) {
        expect(model.harness).toBe("cursor");
      }
    });

    it("includes cursor-harness models from multiple providers", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      { wrapper: createWrapper() });
      const providers = new Set(result.current.models.map((m) => m.provider));
      expect(providers.size).toBeGreaterThan(1);
    });

    it("resolves defaultModel to DEFAULT_CURSOR_MODEL_ID", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      { wrapper: createWrapper() });
      expect(result.current.defaultModel.modelId).toBe(
        DEFAULT_CURSOR_MODEL_ID,
      );
    });

    it("looks up cursor models via getModel", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      { wrapper: createWrapper() });
      expect(
        result.current.getModel(DEFAULT_CURSOR_MODEL_ID),
      ).toBeDefined();
    });

    it("cannot look up native-only models via getModel", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      { wrapper: createWrapper() });
      expect(result.current.getModel(DEFAULT_MODEL_ID)).toBeUndefined();
    });
  });

  describe("loading state", () => {
    it("exposes isLoading from context", () => {
      const loadingState: ModelRegistryState = { models: [], isLoading: true, error: null };
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ModelRegistryContext.Provider value={loadingState}>
          {children}
        </ModelRegistryContext.Provider>
      );
      const { result } = renderHook(() => useModelRegistry(), { wrapper });
      expect(result.current.isLoading).toBe(true);
      expect(result.current.models).toHaveLength(0);
    });

    it("exposes error from context", () => {
      const err = new Error("fetch failed");
      const errorState: ModelRegistryState = { models: [], isLoading: false, error: err };
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ModelRegistryContext.Provider value={errorState}>
          {children}
        </ModelRegistryContext.Provider>
      );
      const { result } = renderHook(() => useModelRegistry(), { wrapper });
      expect(result.current.error).toBe(err);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("defaultModel fallback", () => {
    it("falls back to the first enabled model when default ID is missing", () => {
      const { result } = renderHook(() => useModelRegistry(), { wrapper: createWrapper() });
      expect(result.current.defaultModel).toBeDefined();
      expect(result.current.models).toContain(result.current.defaultModel);
    });
  });
});
