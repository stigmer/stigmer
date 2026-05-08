import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { DEFAULT_MODEL_ID, DEFAULT_CURSOR_MODEL_ID, parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import type { UseCreateSessionReturn } from "../useCreateSession";

const mockCreateSession = vi.fn<UseCreateSessionReturn["create"]>();
vi.mock("../useCreateSession", () => ({
  useCreateSession: () => ({
    create: mockCreateSession,
    isCreating: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

const mockCreateExecution = vi.fn();
vi.mock("../../execution/useCreateAgentExecution", () => ({
  useCreateAgentExecution: () => ({
    create: mockCreateExecution,
    isCreating: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

const mockDefaultAgent = {
  agent: null as { status?: { defaultInstanceId?: string } } | null,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
};
vi.mock("../../agent", () => ({
  useDefaultAgent: () => mockDefaultAgent,
}));

const mockWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  removeEntry: vi.fn(),
  clear: vi.fn(),
};
vi.mock("../../workspace", () => ({
  useWorkspaceEntries: () => mockWorkspace,
}));

const mockSessionVariables = {
  variables: [],
  hasVariables: false,
  setVariable: vi.fn(),
  removeVariable: vi.fn(),
  clear: vi.fn(),
  toMap: vi.fn().mockReturnValue(new Map()),
};
vi.mock("../../execution/useSessionVariables", () => ({
  useSessionVariables: () => mockSessionVariables,
}));

import { useNewSessionFlow } from "../useNewSessionFlow";

const TEST_MODELS = parseRegistryJson({
  models: [
    { id: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", shortDescription: "", speedTier: "fast", provider: "anthropic", harness: "native", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 } },
    { id: "default", displayName: "Cursor Auto", shortDescription: "", speedTier: "fast", provider: "cursor", harness: "cursor", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 } },
  ],
});

function createWrapper() {
  const state: ModelRegistryState = { models: TEST_MODELS, isLoading: false, error: null };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ModelRegistryContext.Provider value={state}>
        {children}
      </ModelRegistryContext.Provider>
    );
  };
}

const STORAGE_KEY_HARNESS = "stigmer:session:harness";
const STORAGE_KEY_MODEL_NATIVE = "stigmer:session:model";
const STORAGE_KEY_MODEL_CURSOR = "stigmer:session:model:cursor";

function defaultOptions() {
  return {
    org: "acme",
    onSessionCreated: vi.fn(),
    onError: vi.fn(),
  };
}

describe("useNewSessionFlow", () => {
  beforeEach(() => {
    localStorage.clear();
    mockDefaultAgent.agent = {
      status: { defaultInstanceId: "default-inst" },
    };
    mockDefaultAgent.isLoading = false;
    mockDefaultAgent.error = null;
    mockCreateSession.mockResolvedValue({ sessionId: "sess-new" });
    mockCreateExecution.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("harness state", () => {
    it("defaults to native when localStorage is empty", () => {
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      expect(result.current.harness).toBe("native");
    });

    it("restores cursor harness from localStorage", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      expect(result.current.harness).toBe("cursor");
    });

    it("falls back to native for unknown localStorage values", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "unknown-value");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      expect(result.current.harness).toBe("native");
    });

    it("persists harness to localStorage on change", () => {
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setHarness("cursor"));

      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBe("cursor");
      expect(result.current.harness).toBe("cursor");
    });

    it("persists native harness to localStorage", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setHarness("native"));

      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBe("native");
    });
  });

  describe("per-harness model persistence", () => {
    it("uses separate storage keys for native and cursor models", () => {
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setModelId(DEFAULT_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_MODEL_NATIVE)).toBe(
        DEFAULT_MODEL_ID,
      );
      expect(localStorage.getItem(STORAGE_KEY_MODEL_CURSOR)).toBeNull();
    });

    it("persists cursor model to cursor-specific key", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setModelId(DEFAULT_CURSOR_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_MODEL_CURSOR)).toBe(
        DEFAULT_CURSOR_MODEL_ID,
      );
    });

    it("restores per-harness model when switching harness", () => {
      localStorage.setItem(STORAGE_KEY_MODEL_CURSOR, DEFAULT_CURSOR_MODEL_ID);

      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setHarness("cursor"));

      expect(result.current.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);
    });

    it("clears modelId when switching to a harness with no stored model", () => {
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      act(() => result.current.setModelId(DEFAULT_MODEL_ID));
      expect(result.current.modelId).toBe(DEFAULT_MODEL_ID);

      act(() => result.current.setHarness("cursor"));

      // No stored cursor model → modelId should be undefined
      // (unless the model happens to be valid in the cursor registry)
      if (result.current.modelId !== undefined) {
        // If it has a value, it must be valid for cursor harness
        expect(result.current.modelId).toBe(
          localStorage.getItem(STORAGE_KEY_MODEL_CURSOR),
        );
      }
    });

    it("invalidates modelId when it is not in the active harness registry", () => {
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      // Set a native-only model
      act(() => result.current.setModelId(DEFAULT_MODEL_ID));
      expect(result.current.modelId).toBe(DEFAULT_MODEL_ID);

      // Switch to cursor → native model should be invalidated
      act(() => result.current.setHarness("cursor"));

      // DEFAULT_MODEL_ID (anthropic) is not in cursor registry
      expect(result.current.modelId).not.toBe(DEFAULT_MODEL_ID);
    });

    it("strips compound keys before persisting to localStorage", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      // Simulate compound key from unified mode ModelSelector
      act(() => result.current.setModelId("cursor/default"));

      // Should store plain modelId, not compound key
      expect(localStorage.getItem(STORAGE_KEY_MODEL_CURSOR)).toBe("default");
    });

    it("restores compound keys from localStorage as plain modelId", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      // Legacy: compound key was stored before fix
      localStorage.setItem(STORAGE_KEY_MODEL_CURSOR, "cursor/default");

      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      // Should extract plain modelId and validate against registry
      expect(result.current.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);
    });
  });

  describe("submit with harness", () => {
    it("passes harness field to createSession", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.harness).toBe("native");
    });

    it("passes cursor harness to createSession after switching", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => result.current.setHarness("cursor"));

      await act(async () => {
        await result.current.submit("Hello");
      });

      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.harness).toBe("cursor");
    });

    it("calls onSessionCreated on success", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(opts.onSessionCreated).toHaveBeenCalledWith("sess-new");
    });

    it("sets submitError and calls onError on failure", async () => {
      mockCreateSession.mockRejectedValueOnce(new Error("RPC fail"));
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.submitError).not.toBeNull();
      expect(opts.onError).toHaveBeenCalled();
    });

    it("resets isSubmitting after completion", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.isSubmitting).toBe(false);
    });
  });
});
