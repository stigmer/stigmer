import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { usePersistedModel } from "../usePersistedModel";
import { DEFAULT_MODEL_ID, DEFAULT_CURSOR_MODEL_ID, parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";

const TEST_MODELS = parseRegistryJson({
  models: [
    { id: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", shortDescription: "", speedTier: "fast", provider: "anthropic", harness: "native", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 } },
    { id: "default", displayName: "Cursor Auto", shortDescription: "", speedTier: "fast", provider: "cursor", harness: "cursor", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 } },
  ],
});

function createWrapper() {
  const state: ModelRegistryState = { models: TEST_MODELS, isLoading: false, error: null, refetch: () => {} };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ModelRegistryContext.Provider value={state}>
        {children}
      </ModelRegistryContext.Provider>
    );
  };
}

const STORAGE_KEY_NATIVE = "stigmer:session:model";
const STORAGE_KEY_CURSOR = "stigmer:session:model:cursor";

describe("usePersistedModel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("basic persistence", () => {
    it("returns undefined when localStorage is empty", () => {
      const { result } = renderHook(() => usePersistedModel({ harness: "native" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBeUndefined();
    });

    it("restores a valid model from localStorage", () => {
      localStorage.setItem(STORAGE_KEY_NATIVE, DEFAULT_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "native" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("returns undefined for an invalid model in localStorage", () => {
      localStorage.setItem(STORAGE_KEY_NATIVE, "nonexistent-model-xyz");
      const { result } = renderHook(() => usePersistedModel({ harness: "native" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBeUndefined();
    });

    it("persists model on change", () => {
      const { result } = renderHook(() => usePersistedModel({ harness: "native" }), { wrapper: createWrapper() });

      act(() => result.current[1](DEFAULT_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_NATIVE)).toBe(DEFAULT_MODEL_ID);
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("uses cursor-specific key for cursor harness", () => {
      localStorage.setItem(STORAGE_KEY_CURSOR, DEFAULT_CURSOR_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "cursor" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_CURSOR_MODEL_ID);
    });
  });

  describe("compound key handling", () => {
    it("extracts plain modelId from compound key in localStorage", () => {
      localStorage.setItem(STORAGE_KEY_CURSOR, "cursor/default");
      const { result } = renderHook(() => usePersistedModel({ harness: "cursor" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_CURSOR_MODEL_ID);
    });

    it("extracts plain modelId from native compound key", () => {
      localStorage.setItem(STORAGE_KEY_NATIVE, `native/${DEFAULT_MODEL_ID}`);
      const { result } = renderHook(() => usePersistedModel({ harness: "native" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("handles non-compound values unchanged", () => {
      localStorage.setItem(STORAGE_KEY_CURSOR, DEFAULT_CURSOR_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "cursor" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_CURSOR_MODEL_ID);
    });
  });

  describe("harness transition (key change re-sync)", () => {
    it("re-reads from new localStorage key when harness changes", () => {
      localStorage.setItem(STORAGE_KEY_NATIVE, DEFAULT_MODEL_ID);
      localStorage.setItem(STORAGE_KEY_CURSOR, DEFAULT_CURSOR_MODEL_ID);

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "native" | "cursor" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "native" }, wrapper: createWrapper() },
      );

      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);

      rerender({ harness: "cursor" });

      expect(result.current[0]).toBe(DEFAULT_CURSOR_MODEL_ID);
    });

    it("returns undefined after harness change when new key has no stored value", () => {
      localStorage.setItem(STORAGE_KEY_NATIVE, DEFAULT_MODEL_ID);

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "native" | "cursor" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "native" }, wrapper: createWrapper() },
      );

      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);

      rerender({ harness: "cursor" });

      expect(result.current[0]).toBeUndefined();
    });

    it("handles compound key in new storage key after harness transition", () => {
      localStorage.setItem(STORAGE_KEY_CURSOR, "cursor/default");

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "native" | "cursor" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "native" }, wrapper: createWrapper() },
      );

      rerender({ harness: "cursor" });

      expect(result.current[0]).toBe(DEFAULT_CURSOR_MODEL_ID);
    });
  });
});
