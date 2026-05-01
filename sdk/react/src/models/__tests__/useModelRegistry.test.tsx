import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useModelRegistry } from "../useModelRegistry";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
} from "../registry";

describe("useModelRegistry", () => {
  describe("unified mode (no harness)", () => {
    it("excludes DISABLED_PROVIDERS from models", () => {
      const { result } = renderHook(() => useModelRegistry());
      for (const model of result.current.models) {
        expect(DISABLED_PROVIDERS.has(model.provider)).toBe(false);
      }
    });

    it("includes models from both native and cursor harnesses", () => {
      const { result } = renderHook(() => useModelRegistry());
      const harnesses = new Set(result.current.models.map((m) => m.harness));
      expect(harnesses.has("native")).toBe(true);
      expect(harnesses.has("cursor")).toBe(true);
    });

    it("includes all non-disabled models from MODEL_REGISTRY", () => {
      const { result } = renderHook(() => useModelRegistry());
      const expected = MODEL_REGISTRY.filter(
        (m) => !DISABLED_PROVIDERS.has(m.provider),
      );
      expect(result.current.models).toHaveLength(expected.length);
    });

    it("resolves defaultModel to DEFAULT_MODEL_ID", () => {
      const { result } = renderHook(() => useModelRegistry());
      expect(result.current.defaultModel.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("groups models by provider in byProvider map", () => {
      const { result } = renderHook(() => useModelRegistry());
      for (const [provider, models] of result.current.byProvider) {
        for (const m of models) {
          expect(m.provider).toBe(provider);
        }
      }
    });

    it("returns providers matching byProvider keys in order", () => {
      const { result } = renderHook(() => useModelRegistry());
      const fromMap = Array.from(result.current.byProvider.keys());
      expect(result.current.providers).toEqual(fromMap);
    });

    it("looks up enabled models by getModel", () => {
      const { result } = renderHook(() => useModelRegistry());
      const model = result.current.getModel(DEFAULT_MODEL_ID);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("returns undefined for disabled provider models via getModel", () => {
      const { result } = renderHook(() => useModelRegistry());
      const disabledModel = MODEL_REGISTRY.find((m) =>
        DISABLED_PROVIDERS.has(m.provider),
      );
      if (disabledModel) {
        expect(result.current.getModel(disabledModel.modelId)).toBeUndefined();
      }
    });

    it("returns undefined for unknown model IDs via getModel", () => {
      const { result } = renderHook(() => useModelRegistry());
      expect(result.current.getModel("nonexistent-model")).toBeUndefined();
    });

    it("returns featured models subset", () => {
      const { result } = renderHook(() => useModelRegistry());
      expect(result.current.featured.length).toBeGreaterThan(0);
      for (const model of result.current.featured) {
        expect(model.featured).toBe(true);
      }
    });

    it("featured models are a subset of all models", () => {
      const { result } = renderHook(() => useModelRegistry());
      const allKeys = new Set(
        result.current.models.map((m) => modelKey(m.harness, m.modelId)),
      );
      for (const model of result.current.featured) {
        expect(allKeys.has(modelKey(model.harness, model.modelId))).toBe(true);
      }
    });

    it("resolves models by compound key via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry());
      const key = modelKey("native", DEFAULT_MODEL_ID);
      const model = result.current.getByKey(key);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_MODEL_ID);
      expect(model!.harness).toBe("native");
    });

    it("resolves cursor models by compound key via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry());
      const key = modelKey("cursor", DEFAULT_CURSOR_MODEL_ID);
      const model = result.current.getByKey(key);
      expect(model).toBeDefined();
      expect(model!.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);
      expect(model!.harness).toBe("cursor");
    });

    it("returns undefined for unknown compound keys via getByKey", () => {
      const { result } = renderHook(() => useModelRegistry());
      expect(result.current.getByKey("native/nonexistent")).toBeUndefined();
    });
  });

  describe("native harness (explicit)", () => {
    it("shows only native-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      );
      for (const model of result.current.models) {
        expect(model.harness).toBe("native");
      }
    });

    it("excludes cursor-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      );
      const cursorModels = result.current.models.filter(
        (m) => m.harness === "cursor",
      );
      expect(cursorModels).toHaveLength(0);
    });

    it("resolves defaultModel to DEFAULT_MODEL_ID", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      );
      expect(result.current.defaultModel.modelId).toBe(DEFAULT_MODEL_ID);
    });
  });

  describe("cursor harness", () => {
    it("shows only cursor-harness models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      for (const model of result.current.models) {
        expect(model.harness).toBe("cursor");
      }
    });

    it("includes cursor-harness models from multiple providers", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      const providers = new Set(result.current.models.map((m) => m.provider));
      expect(providers.size).toBeGreaterThan(1);
    });

    it("includes all cursor-harness models from MODEL_REGISTRY", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      const cursorModels = MODEL_REGISTRY.filter(
        (m) => m.harness === "cursor",
      );
      expect(result.current.models).toHaveLength(cursorModels.length);
    });

    it("resolves defaultModel to DEFAULT_CURSOR_MODEL_ID", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      expect(result.current.defaultModel.modelId).toBe(
        DEFAULT_CURSOR_MODEL_ID,
      );
    });

    it("looks up cursor models via getModel", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      expect(
        result.current.getModel(DEFAULT_CURSOR_MODEL_ID),
      ).toBeDefined();
    });

    it("cannot look up native-only models via getModel", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      expect(result.current.getModel(DEFAULT_MODEL_ID)).toBeUndefined();
    });
  });

  describe("defaultModel fallback", () => {
    it("falls back to the first enabled model when default ID is missing", () => {
      const { result } = renderHook(() => useModelRegistry());
      expect(result.current.defaultModel).toBeDefined();
      expect(result.current.models).toContain(result.current.defaultModel);
    });
  });
});
