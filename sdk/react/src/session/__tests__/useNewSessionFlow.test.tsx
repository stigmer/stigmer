import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { DEFAULT_MODEL_ID, DEFAULT_CURSOR_MODEL_ID, parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import { ExecutionTargetContext } from "../../execution-target-context";
import { RunnerAdapterContext } from "../../runner-adapter";
import type { RunnerAdapter } from "../../runner-adapter";
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
  error: null as Error | null,
  refetch: vi.fn(),
  waitForResolution: vi.fn<() => Promise<unknown>>(),
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

function createWrapper(
  executionTarget?: "local" | "cloud",
  adapter: RunnerAdapter | null = null,
) {
  const state: ModelRegistryState = { models: TEST_MODELS, isLoading: false, error: null, refetch: () => {} };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ExecutionTargetContext.Provider value={executionTarget}>
        <RunnerAdapterContext.Provider value={adapter}>
          <ModelRegistryContext.Provider value={state}>
            {children}
          </ModelRegistryContext.Provider>
        </RunnerAdapterContext.Provider>
      </ExecutionTargetContext.Provider>
    );
  };
}

function createMockAdapter(): RunnerAdapter & {
  onSessionOpened: ReturnType<typeof vi.fn>;
  onSessionClosed: ReturnType<typeof vi.fn>;
  onWorkflowExecutionCreated: ReturnType<typeof vi.fn>;
  onWorkflowExecutionTerminated: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
    onWorkflowExecutionCreated: vi.fn().mockResolvedValue(undefined),
    onWorkflowExecutionTerminated: vi.fn().mockResolvedValue(undefined),
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

  describe("model validation timing", () => {
    it("does not restore model while registry is loading", () => {
      localStorage.setItem(STORAGE_KEY_MODEL_NATIVE, DEFAULT_MODEL_ID);
      const loadingState: ModelRegistryState = { models: [], isLoading: true, error: null, refetch: () => {} };

      function LoadingWrapper({ children }: { children: ReactNode }) {
        return (
          <ModelRegistryContext.Provider value={loadingState}>
            {children}
          </ModelRegistryContext.Provider>
        );
      }

      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: LoadingWrapper });

      expect(result.current.modelId).toBeUndefined();
    });

    it("restores model once registry has loaded", () => {
      localStorage.setItem(STORAGE_KEY_MODEL_NATIVE, DEFAULT_MODEL_ID);

      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      expect(result.current.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("discards model that no longer exists in the registry", () => {
      localStorage.setItem(STORAGE_KEY_MODEL_NATIVE, "removed-model-xyz");

      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });

      expect(result.current.modelId).toBeUndefined();
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

  describe("submit with executionTarget", () => {
    it("passes executionTarget to createSession when provided", async () => {
      const opts = { ...defaultOptions(), executionTarget: "local" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.executionTarget).toBe("local");
    });

    it("does not include executionTarget when not provided", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.executionTarget).toBeUndefined();
    });

    it("uses context executionTarget when per-hook option is omitted", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper("local") });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.executionTarget).toBe("local");
    });

    it("per-hook executionTarget option overrides context", async () => {
      const opts = { ...defaultOptions(), executionTarget: "local" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper("cloud") });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const sessionInput = mockCreateSession.mock.calls[0][0];
      expect(sessionInput.executionTarget).toBe("local");
    });
  });

  describe("submit — local runner worker (eager attach)", () => {
    it("attaches the worker before creating the first execution", async () => {
      const adapter = createMockAdapter();
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper("local", adapter),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
      expect(adapter.onSessionOpened).toHaveBeenCalledWith("sess-new");
      expect(adapter.onSessionClosed).not.toHaveBeenCalled();

      // The worker must be polling before the first execution exists.
      const openedOrder = adapter.onSessionOpened.mock.invocationCallOrder[0];
      const execOrder = mockCreateExecution.mock.invocationCallOrder[0];
      expect(openedOrder).toBeLessThan(execOrder);
    });

    it("does not attach a worker when the target is cloud", async () => {
      const adapter = createMockAdapter();
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper("cloud", adapter),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(adapter.onSessionOpened).not.toHaveBeenCalled();
    });

    it("detaches the worker when the first execution fails (no leak)", async () => {
      const adapter = createMockAdapter();
      mockCreateExecution.mockRejectedValueOnce(new Error("execution boom"));
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper("local", adapter),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(adapter.onSessionOpened).toHaveBeenCalledWith("sess-new");
      expect(adapter.onSessionClosed).toHaveBeenCalledWith("sess-new");
      expect(result.current.submitError).not.toBeNull();
      expect(opts.onError).toHaveBeenCalled();
    });
  });

  describe("host runtime env (getRuntimeEnv)", () => {
    it("merges host env into the first execution, host wins on collisions", async () => {
      const getRuntimeEnv = vi.fn().mockResolvedValue({
        PLATFORM_TOKEN: { value: "fresh-token", isSecret: true },
      });
      const opts = { ...defaultOptions(), getRuntimeEnv };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello", undefined, {
          runtimeEnv: {
            PLATFORM_TOKEN: { value: "stale-token", isSecret: true },
            USER_VAR: { value: "kept" },
          },
        });
      });

      expect(getRuntimeEnv).toHaveBeenCalledTimes(1);
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.runtimeEnv).toEqual({
        PLATFORM_TOKEN: { value: "fresh-token", isSecret: true },
        USER_VAR: { value: "kept" },
      });
    });

    it("evaluates the provider fresh on every submission", async () => {
      let mint = 0;
      const getRuntimeEnv = vi.fn(() => ({
        TOKEN: { value: `token-${++mint}` },
      }));
      const opts = { ...defaultOptions(), getRuntimeEnv };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("First");
      });
      await act(async () => {
        await result.current.submit("Second");
      });

      expect(getRuntimeEnv).toHaveBeenCalledTimes(2);
      expect(mockCreateExecution.mock.calls[0][0].runtimeEnv).toEqual({
        TOKEN: { value: "token-1" },
      });
      expect(mockCreateExecution.mock.calls[1][0].runtimeEnv).toEqual({
        TOKEN: { value: "token-2" },
      });
    });

    it("aborts before session creation when the provider throws", async () => {
      const getRuntimeEnv = vi.fn().mockRejectedValue(new Error("token mint failed"));
      const opts = { ...defaultOptions(), getRuntimeEnv };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      // No orphan session, no execution — the failure is fully pre-flight.
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(result.current.submitError).toContain("token mint failed");
      expect(opts.onError).toHaveBeenCalled();
      expect(result.current.isSubmitting).toBe(false);
    });

    it("passes composer env through untouched when no provider is configured", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello", undefined, {
          runtimeEnv: { USER_VAR: { value: "composer-only" } },
        });
      });

      expect(mockCreateExecution.mock.calls[0][0].runtimeEnv).toEqual({
        USER_VAR: { value: "composer-only" },
      });
    });
  });

  describe("defaultHarness", () => {
    it("seeds the embedder default when no harness is stored", () => {
      const opts = { ...defaultOptions(), defaultHarness: "cursor" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.harness).toBe("cursor");
    });

    it("stored user choice outranks the embedder default", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      const opts = { ...defaultOptions(), defaultHarness: "cursor" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.harness).toBe("native");
    });

    it("does not persist the seeded default — only explicit choices", () => {
      const opts = { ...defaultOptions(), defaultHarness: "cursor" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      // Seeding must not masquerade as a user choice, otherwise the
      // embedder default would stop applying after the first visit.
      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBeNull();

      act(() => result.current.setHarness("native"));
      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBe("native");
    });

    it("submits sessions with the seeded default harness", async () => {
      const opts = { ...defaultOptions(), defaultHarness: "cursor" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateSession.mock.calls[0][0].harness).toBe("cursor");
    });
  });

  describe("submit while default agent is loading", () => {
    it("awaits default agent and creates session when fetch resolves", async () => {
      const resolvedAgent = { status: { defaultInstanceId: "awaited-inst" } };
      mockDefaultAgent.agent = null;
      mockDefaultAgent.isLoading = true;
      mockDefaultAgent.error = null;
      mockDefaultAgent.waitForResolution.mockResolvedValue(resolvedAgent);

      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockDefaultAgent.waitForResolution).toHaveBeenCalledOnce();
      expect(mockCreateSession).toHaveBeenCalledOnce();
      expect(mockCreateSession.mock.calls[0][0].agentInstanceId).toBe("awaited-inst");
      expect(opts.onSessionCreated).toHaveBeenCalledWith("sess-new");
      expect(result.current.submitError).toBeNull();
    });

    it("surfaces error when fetch fails during await", async () => {
      mockDefaultAgent.agent = null;
      mockDefaultAgent.isLoading = true;
      mockDefaultAgent.error = null;
      mockDefaultAgent.waitForResolution.mockRejectedValue(
        new Error("Network failure"),
      );

      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.submitError).toBeTruthy();
      expect(opts.onError).toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("surfaces timeout error when fetch never resolves", async () => {
      vi.useFakeTimers();

      mockDefaultAgent.agent = null;
      mockDefaultAgent.isLoading = true;
      mockDefaultAgent.error = null;
      mockDefaultAgent.waitForResolution.mockReturnValue(
        new Promise(() => {}),
      );

      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.submit("Hello") as unknown as Promise<void>;
      });

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      await act(async () => {
        await submitPromise;
      });

      expect(result.current.submitError).toContain("did not load in time");
      expect(opts.onError).toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("errors immediately when default agent has already failed", async () => {
      mockDefaultAgent.agent = null;
      mockDefaultAgent.isLoading = false;
      mockDefaultAgent.error = new Error("Already failed");

      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.submitError).toContain("Failed to load default agent");
      expect(opts.onError).toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockDefaultAgent.waitForResolution).not.toHaveBeenCalled();
    });
  });
});
