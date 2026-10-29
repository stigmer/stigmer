import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { modelStorageKey, usePersistedModel } from "../usePersistedModel";
import { DEFAULT_MODEL_ID, parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";

const TEST_MODELS = parseRegistryJson({
  models: [
    { id: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", shortDescription: "", speedTier: "fast", provider: "anthropic", harness: "stigmer", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 } },
    { id: "claude-haiku-4.5", displayName: "Claude Haiku 4.5", shortDescription: "", speedTier: "fastest", provider: "anthropic", harness: "claude", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.1 } },
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

const STORAGE_KEY_STIGMER = "stigmer:session:model";
const STORAGE_KEY_CLAUDE = "stigmer:session:model:claude";
const CLAUDE_MODEL_ID = "claude-haiku-4.5";

describe("usePersistedModel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("basic persistence", () => {
    it("returns undefined when localStorage is empty", () => {
      const { result } = renderHook(() => usePersistedModel({ harness: "stigmer" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBeUndefined();
    });

    it("restores a valid model from localStorage", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, DEFAULT_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "stigmer" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("returns undefined for an invalid model in localStorage", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, "nonexistent-model-xyz");
      const { result } = renderHook(() => usePersistedModel({ harness: "stigmer" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBeUndefined();
    });

    it("persists model on change", () => {
      const { result } = renderHook(() => usePersistedModel({ harness: "stigmer" }), { wrapper: createWrapper() });

      act(() => result.current[1](DEFAULT_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_STIGMER)).toBe(DEFAULT_MODEL_ID);
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("uses the claude-specific key for the claude harness", () => {
      localStorage.setItem(STORAGE_KEY_CLAUDE, CLAUDE_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "claude" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(CLAUDE_MODEL_ID);
    });
  });

  describe("disabled mode (guest isolation)", () => {
    it("returns undefined even when a valid model is stored", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, DEFAULT_MODEL_ID);
      const { result } = renderHook(
        () => usePersistedModel({ harness: "stigmer", enabled: false }),
        { wrapper: createWrapper() },
      );
      expect(result.current[0]).toBeUndefined();
    });

    it("never writes localStorage through the setter", () => {
      const { result } = renderHook(
        () => usePersistedModel({ harness: "stigmer", enabled: false }),
        { wrapper: createWrapper() },
      );

      act(() => result.current[1](DEFAULT_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_STIGMER)).toBeNull();
      expect(result.current[0]).toBeUndefined();
    });

    it("does not re-read storage on a harness transition", () => {
      localStorage.setItem(STORAGE_KEY_CLAUDE, CLAUDE_MODEL_ID);
      const { result, rerender } = renderHook(
        ({ harness }: { harness: "stigmer" | "claude" }) =>
          usePersistedModel({ harness, enabled: false }),
        { initialProps: { harness: "stigmer" as "stigmer" | "claude" }, wrapper: createWrapper() },
      );

      rerender({ harness: "claude" });

      expect(result.current[0]).toBeUndefined();
    });
  });

  describe("compound key handling", () => {
    it("extracts plain modelId from compound key in localStorage", () => {
      localStorage.setItem(STORAGE_KEY_CLAUDE, "claude/claude-haiku-4.5");
      const { result } = renderHook(() => usePersistedModel({ harness: "claude" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(CLAUDE_MODEL_ID);
    });

    it("extracts plain modelId from Stigmer compound key", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, `stigmer/${DEFAULT_MODEL_ID}`);
      const { result } = renderHook(() => usePersistedModel({ harness: "stigmer" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);
    });

    it("handles non-compound values unchanged", () => {
      localStorage.setItem(STORAGE_KEY_CLAUDE, CLAUDE_MODEL_ID);
      const { result } = renderHook(() => usePersistedModel({ harness: "claude" }), { wrapper: createWrapper() });
      expect(result.current[0]).toBe(CLAUDE_MODEL_ID);
    });
  });

  describe("harness transition (key change re-sync)", () => {
    it("re-reads from new localStorage key when harness changes", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, DEFAULT_MODEL_ID);
      localStorage.setItem(STORAGE_KEY_CLAUDE, CLAUDE_MODEL_ID);

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "stigmer" | "claude" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "stigmer" }, wrapper: createWrapper() },
      );

      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);

      rerender({ harness: "claude" });

      expect(result.current[0]).toBe(CLAUDE_MODEL_ID);
    });

    it("returns undefined after harness change when new key has no stored value", () => {
      localStorage.setItem(STORAGE_KEY_STIGMER, DEFAULT_MODEL_ID);

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "stigmer" | "claude" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "stigmer" }, wrapper: createWrapper() },
      );

      expect(result.current[0]).toBe(DEFAULT_MODEL_ID);

      rerender({ harness: "claude" });

      expect(result.current[0]).toBeUndefined();
    });

    it("handles compound key in new storage key after harness transition", () => {
      localStorage.setItem(STORAGE_KEY_CLAUDE, "claude/claude-haiku-4.5");

      const { result, rerender } = renderHook(
        ({ harness }: { harness: "stigmer" | "claude" }) => usePersistedModel({ harness }),
        { initialProps: { harness: "stigmer" }, wrapper: createWrapper() },
      );

      rerender({ harness: "claude" });

      expect(result.current[0]).toBe(CLAUDE_MODEL_ID);
    });
  });
});

describe("modelStorageKey", () => {
  it("keeps one key per engine, the Stigmer harness's key as it always was", () => {
    expect([modelStorageKey("stigmer"), modelStorageKey("claude")]).toEqual([
      "stigmer:session:model",
      "stigmer:session:model:claude",
    ]);
    expect(modelStorageKey()).toBe("stigmer:session:model");
  });
});
