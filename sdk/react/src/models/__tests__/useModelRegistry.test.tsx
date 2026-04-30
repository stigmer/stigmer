import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useModelRegistry } from "../useModelRegistry";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
} from "../registry";

describe("useModelRegistry", () => {
  describe("native harness (default)", () => {
    it("excludes DISABLED_PROVIDERS from models", () => {
      const { result } = renderHook(() => useModelRegistry());
      for (const model of result.current.models) {
        expect(DISABLED_PROVIDERS.has(model.provider)).toBe(false);
      }
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
  });

  describe("native harness (explicit)", () => {
    it("produces the same result as omitting harness", () => {
      const { result: defaultResult } = renderHook(() => useModelRegistry());
      const { result: nativeResult } = renderHook(() =>
        useModelRegistry({ harness: "native" }),
      );
      expect(nativeResult.current.models).toEqual(defaultResult.current.models);
      expect(nativeResult.current.defaultModel.modelId).toBe(
        defaultResult.current.defaultModel.modelId,
      );
    });
  });

  describe("cursor harness", () => {
    it("shows only cursor-provider models", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      for (const model of result.current.models) {
        expect(model.provider).toBe("cursor");
      }
    });

    it("includes all cursor models from MODEL_REGISTRY", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      const cursorModels = MODEL_REGISTRY.filter(
        (m) => m.provider === "cursor",
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

    it("only lists cursor in providers", () => {
      const { result } = renderHook(() =>
        useModelRegistry({ harness: "cursor" }),
      );
      expect(result.current.providers).toEqual(["cursor"]);
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
