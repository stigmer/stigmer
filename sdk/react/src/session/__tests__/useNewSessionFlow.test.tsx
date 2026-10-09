/**
 * The new-conversation flow: the engine and model a first message runs,
 * what is remembered on the device, the agent's run defaults, and the
 * one-call bootstrap create. Pins, among the rest: the person's engine
 * pick wins over the agent's engine; a model pick is forgotten when the
 * agent changes, when the person chooses the agent's default back, and
 * when the engine changes under it to one that does not list it, so a
 * model is never sent with an engine that does not run it. The new
 * conversation uses the vaults chosen for it: the person's pick in the
 * composer when they made one, else the host's, else My vault for a
 * signed-in person (the Console and an embedded chat) and nothing for a
 * share-link guest, who carries no vault pick of the composer either.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ReactNode } from "react";
import { DEFAULT_MODEL_ID, DEFAULT_CURSOR_MODEL_ID, parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import { ExecutionTargetContext } from "../../execution-target-context";
import { ApprovalDefaultsContext } from "../../approval-defaults-context";
import type { ApprovalDefaults } from "../../approval-defaults-context";
import { RunnerAdapterContext } from "../../runner-adapter";
import type { RunnerAdapter } from "../../runner-adapter";
const mockGetByReference = vi.fn();
// One client for every render, as the provider gives: a fresh object per
// call would change the agent read's inputs on each render.
vi.mock("../../hooks", () => {
  const stigmer = { agent: { getByReference: (...args: unknown[]) => mockGetByReference(...args) } };
  return { useStigmer: () => stigmer };
});

const mockCreateExecution = vi.fn();
vi.mock("../../run/useCreateRun", () => ({
  useCreateRun: () => ({
    create: mockCreateExecution,
    isCreating: false,
    error: null,
    clearError: vi.fn(),
  }),
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
  approvalDefaults?: ApprovalDefaults,
) {
  const state: ModelRegistryState = { models: TEST_MODELS, isLoading: false, error: null, refetch: () => {} };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ExecutionTargetContext.Provider value={executionTarget}>
        <ApprovalDefaultsContext.Provider value={approvalDefaults}>
          <RunnerAdapterContext.Provider value={adapter}>
            <ModelRegistryContext.Provider value={state}>
              {children}
            </ModelRegistryContext.Provider>
          </RunnerAdapterContext.Provider>
        </ApprovalDefaultsContext.Provider>
      </ExecutionTargetContext.Provider>
    );
  };
}

function createMockAdapter(): RunnerAdapter & {
  onSessionOpened: ReturnType<typeof vi.fn>;
  onSessionClosed: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
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
    mockCreateExecution.mockResolvedValue({
      executionId: "exec-new",
      sessionId: "sess-new",
    });
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

  describe("submit — owner-pinned runConfig (#664)", () => {
    it("stamps the pinned model and fast tier over the composer's selection and the restored preference", async () => {
      localStorage.setItem(STORAGE_KEY_MODEL_NATIVE, DEFAULT_MODEL_ID);
      const { result } = renderHook(
        () =>
          useNewSessionFlow({
            ...defaultOptions(),
            runConfig: { modelName: "pinned-model", serviceTier: "fast" },
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.submit("Hello", "user-picked-model");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.modelName).toBe("pinned-model");
      expect(execInput.serviceTier).toBe("fast");
    });

    it("a model-only pin suppresses a composer-armed fast tier (the pin owns the whole run config)", async () => {
      const { result } = renderHook(
        () =>
          useNewSessionFlow({
            ...defaultOptions(),
            runConfig: { modelName: "pinned-model" },
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.submit("Hello", undefined, { serviceTier: "fast" });
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.modelName).toBe("pinned-model");
      expect(execInput.serviceTier).toBeUndefined();
    });

    it("ignores the pin entirely for guests — the platform share policy owns guest config", async () => {
      const { result } = renderHook(
        () =>
          useNewSessionFlow({
            ...defaultOptions(),
            audience: "guest",
            runConfig: { modelName: "pinned-model", serviceTier: "fast" },
          }),
        { wrapper: createWrapper() },
      );

      // Guests submit against an explicitly pinned shared agent.
      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "shared-agent" });
        result.current.setResolution({ mode: "direct" });
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.modelName).toBeUndefined();
      expect(execInput.serviceTier).toBeUndefined();
    });

    it("throws at render for the statically-wrong pin (fast tier, no model)", () => {
      expect(() =>
        renderHook(
          () =>
            useNewSessionFlow({
              ...defaultOptions(),
              runConfig: { serviceTier: "fast" },
            }),
          { wrapper: createWrapper() },
        ),
      ).toThrowError(/serviceTier "fast" requires modelName/);
    });
  });

  describe("submit — one-call bootstrap", () => {
    it("creates the execution with an embedded sessionSpec in a single call", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.message).toBe("Hello");
      expect(execInput.sessionSpec).toBeDefined();
      // No agent picked: the built-in assistant, nothing to resolve or wait
      // for — the session spec names no agent.
      expect(execInput.sessionSpec.agentRef).toBeUndefined();
      expect(execInput.sessionId).toBeUndefined();
    });

    it("passes harness in the sessionSpec", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.harness).toBe("native");
    });

    it("omits autoApproveAll by default (fail-closed gates unchanged)", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBeUndefined();
    });

    it("forwards the host approval default into the bootstrap create (#302)", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper(undefined, null, { autoApproveAll: true }),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBe(true);
    });

    it("carries the user's pre-arm toggle into the bootstrap create (#816)", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.autoApproveAll).toBe(false);
      act(() => result.current.setAutoApproveAll(true));
      expect(result.current.autoApproveAll).toBe(true);

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBe(true);
    });

    it("the user's toggle-off beats the host approval default (#816)", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper(undefined, null, { autoApproveAll: true }),
      });

      expect(result.current.autoApproveAll).toBe(true);
      act(() => result.current.setAutoApproveAll(false));

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBeUndefined();
    });

    it("arms from the account's default_auto_approve preference", async () => {
      const opts = {
        ...defaultOptions(),
        accountDefaults: { autoApprove: true },
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.autoApproveAll).toBe(true);

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBe(true);
    });

    it("a LATE-arriving account preference still arms (derived, not initialized)", () => {
      // whoAmI resolves after mount — the seed must be part of the
      // derivation so it cannot be missed by a useState initializer.
      const initialProps: { accountDefaults?: { autoApprove?: boolean } } = {};
      const { result, rerender } = renderHook(
        ({ accountDefaults }: typeof initialProps) =>
          useNewSessionFlow({ ...defaultOptions(), accountDefaults }),
        { wrapper: createWrapper(), initialProps },
      );
      expect(result.current.autoApproveAll).toBe(false);

      rerender({ accountDefaults: { autoApprove: true } });
      expect(result.current.autoApproveAll).toBe(true);
    });

    it("a late arrival never overrides the user's explicit OFF", () => {
      const initialProps: { accountDefaults?: { autoApprove?: boolean } } = {};
      const { result, rerender } = renderHook(
        ({ accountDefaults }: typeof initialProps) =>
          useNewSessionFlow({ ...defaultOptions(), accountDefaults }),
        { wrapper: createWrapper(), initialProps },
      );
      act(() => result.current.setAutoApproveAll(false));

      rerender({ accountDefaults: { autoApprove: true } });
      expect(result.current.autoApproveAll).toBe(false);
    });

    it("guests never inherit the account auto-approve preference", () => {
      const opts = {
        ...defaultOptions(),
        audience: "guest" as const,
        accountDefaults: { autoApprove: true },
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.autoApproveAll).toBe(false);
    });

    it("passes cursor harness in the sessionSpec after switching", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => result.current.setHarness("cursor"));

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.harness).toBe("cursor");
    });

    it("forwards metadata and sessionContext verbatim in the sessionSpec", async () => {
      // The typed-wins merge onto the reserved key happens downstream in
      // useCreateRun (covered by its own tests); the flow's job
      // is faithful forwarding.
      const opts = {
        ...defaultOptions(),
        metadata: { "acme/tenant": "t-1" },
        sessionContext: "Role: platform admin",
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.metadata).toEqual({ "acme/tenant": "t-1" });
      expect(execInput.sessionSpec.sessionContext).toBe("Role: platform admin");
    });

    it("leaves metadata and sessionContext undefined when not provided", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.metadata).toBeUndefined();
      expect(execInput.sessionSpec.sessionContext).toBeUndefined();
    });

    it("calls onSessionCreated with the server-assigned session id", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(opts.onSessionCreated).toHaveBeenCalledWith("sess-new");
    });

    it("sets submitError and calls onError on failure", async () => {
      mockCreateExecution.mockRejectedValueOnce(new Error("RPC fail"));
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

  describe("submit — agent resolution strategies", () => {
    it.each([
      ["saved", { mode: "saved" } as const],
      ["direct", { mode: "direct" } as const],
    ])("starts the conversation on the agent itself for a %s resolution", async (_mode, resolution) => {
      mockGetByReference.mockResolvedValue({ metadata: { id: "agt_9", org: "acme", slug: "reviewer" }, spec: {} });
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      // The send waits for the agent's read (its engine decides the start).
      await act(async () => {
        result.current.setAgentRef({ org: "acme", slug: "reviewer" });
        result.current.setResolution(resolution);
      });
      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      // No version: the server pins the agent's current version.
      expect(execInput.sessionSpec.agentRef).toEqual({ org: "acme", slug: "reviewer" });
      expect(execInput.sessionId).toBeUndefined();
    });
  });

  describe("the selected agent's engine and run defaults", () => {
    const AGENT_ON_CURSOR = {
      metadata: { id: "agt_1", org: "acme", slug: "reviewer" },
      spec: {
        harness: Harness.CURSOR,
        runConfig: { modelName: "default", thinkingMode: ThinkingMode.UNSPECIFIED },
      },
    };

    async function renderWithAgent(agent: unknown) {
      mockGetByReference.mockResolvedValue(agent);
      const hook = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      await act(async () => {
        hook.result.current.setAgentRef({ org: "acme", slug: "reviewer" });
        hook.result.current.setResolution({ mode: "direct" });
      });
      await waitFor(() => expect(hook.result.current.harness).toBe(
        (agent as typeof AGENT_ON_CURSOR | null)?.spec.harness === Harness.CURSOR ? "cursor" : "native",
      ));
      return hook;
    }

    it("opens the engine picker on the agent's engine over a remembered one", async () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      expect(result.current.harness).toBe("cursor");
      expect(result.current.agentRunDefaults).toEqual({ modelName: "default" });
    });

    it("keeps the remembered engine where the agent names none", async () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "cursor");
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      mockGetByReference.mockResolvedValue({
        metadata: { id: "agt_2", org: "acme", slug: "plain" },
        spec: {},
      });
      await act(async () => {
        result.current.setAgentRef({ org: "acme", slug: "plain" });
      });
      await waitFor(() => expect(mockGetByReference).toHaveBeenCalled());
      expect(result.current.harness).toBe("cursor");
      expect(result.current.agentRunDefaults).toBeUndefined();
    });

    it("the person's engine pick wins over the agent's", async () => {
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      act(() => result.current.setHarness("native"));
      expect(result.current.harness).toBe("native");
      expect(result.current.agentRunDefaults).toBeUndefined();
    });

    it("sends no remembered model where the agent's default applies", async () => {
      localStorage.setItem(STORAGE_KEY_MODEL_CURSOR, DEFAULT_CURSOR_MODEL_ID);
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      expect(result.current.modelId).toBeUndefined();

      await act(async () => {
        await result.current.submit("Hello");
      });
      expect(mockCreateExecution.mock.calls[0][0].modelName).toBeUndefined();
    });

    it("sends a model the person picks over the agent's default", async () => {
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      act(() => result.current.setModelId(DEFAULT_CURSOR_MODEL_ID));
      expect(result.current.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);
    });

    it("forgets the picked model when the person chooses the agent's default back", async () => {
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      act(() => result.current.setModelId(DEFAULT_CURSOR_MODEL_ID));
      act(() => result.current.clearModelPick());
      expect(result.current.modelId).toBeUndefined();

      await act(async () => {
        await result.current.submit("Hello");
      });
      expect(mockCreateExecution.mock.calls[0][0].modelName).toBeUndefined();
    });

    it("forgets the picked model when the person picks another agent", async () => {
      const { result } = await renderWithAgent(AGENT_ON_CURSOR);
      act(() => result.current.setModelId(DEFAULT_CURSOR_MODEL_ID));
      expect(result.current.modelId).toBe(DEFAULT_CURSOR_MODEL_ID);

      mockGetByReference.mockResolvedValue({
        metadata: { id: "agt_3", org: "acme", slug: "writer" },
        spec: { harness: Harness.CURSOR, runConfig: { modelName: "default" } },
      });
      await act(async () => {
        result.current.setAgentRef({ org: "acme", slug: "writer" });
      });
      await waitFor(() => expect(mockGetByReference).toHaveBeenLastCalledWith(
        expect.objectContaining({ slug: "writer" }),
      ));
      // The new agent's own default applies: the pick made for the
      // previous agent is not sent on.
      expect(result.current.modelId).toBeUndefined();
    });

    it("holds a send until the agent is read, so it starts on the agent's engine", async () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      let resolveAgent: (agent: unknown) => void = () => {};
      mockGetByReference.mockReturnValue(new Promise((resolve) => { resolveAgent = resolve; }));
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      await act(async () => {
        result.current.setAgentRef({ org: "acme", slug: "reviewer" });
        result.current.setResolution({ mode: "direct" });
      });

      await act(async () => {
        await result.current.submit("Hello");
      });
      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(result.current.submitError).toMatch(/still loading/);

      await act(async () => {
        resolveAgent(AGENT_ON_CURSOR);
      });
      await waitFor(() => expect(result.current.harness).toBe("cursor"));
      await act(async () => {
        await result.current.submit("Hello");
      });
      expect(mockCreateExecution.mock.calls[0][0].sessionSpec.harness).toBe("cursor");
    });

    it("drops a model picked for the other engine when the agent's engine loads after the pick", async () => {
      let resolveAgent: (agent: unknown) => void = () => {};
      mockGetByReference.mockReturnValue(new Promise((resolve) => { resolveAgent = resolve; }));
      const { result } = renderHook(() => useNewSessionFlow(defaultOptions()), { wrapper: createWrapper() });
      await act(async () => {
        result.current.setAgentRef({ org: "acme", slug: "reviewer" });
        result.current.setResolution({ mode: "direct" });
      });
      // Picked on the native engine while the agent still loads...
      act(() => result.current.setModelId("claude-sonnet-4.6"));
      expect(result.current.harness).toBe("native");

      // ...then the agent names the cursor engine.
      await act(async () => {
        resolveAgent({
          metadata: { id: "agt_4", org: "acme", slug: "reviewer" },
          spec: { harness: Harness.CURSOR },
        });
      });
      await waitFor(() => expect(result.current.harness).toBe("cursor"));

      expect(result.current.modelId).toBeUndefined();
      // Never filed under the cursor engine's remembered model either.
      expect(localStorage.getItem(STORAGE_KEY_MODEL_CURSOR)).toBeNull();
      await act(async () => {
        await result.current.submit("Hello");
      });
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.modelName).toBeUndefined();
      expect(execInput.sessionSpec.harness).toBe("cursor");
    });
  });

  describe("submit with executionTarget", () => {
    it("passes executionTarget in the sessionSpec when provided", async () => {
      const opts = { ...defaultOptions(), executionTarget: "local" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.executionTarget).toBe("local");
    });

    it("does not include executionTarget when not provided", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.executionTarget).toBeUndefined();
    });

    it("uses context executionTarget when per-hook option is omitted", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper("local") });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.executionTarget).toBe("local");
    });

    it("per-hook executionTarget option overrides context", async () => {
      const opts = { ...defaultOptions(), executionTarget: "local" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper("cloud") });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.executionTarget).toBe("local");
    });
  });

  describe("submit — local runner worker (post-create attach)", () => {
    it("attaches the worker after the bootstrap create returns the session id", async () => {
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

      // The session ID only exists after the one-call create, so the attach
      // follows it. This is safe: the first activity waits on the session's
      // task queue for a worker (5-minute ScheduleToStart window).
      const openedOrder = adapter.onSessionOpened.mock.invocationCallOrder[0];
      const execOrder = mockCreateExecution.mock.invocationCallOrder[0];
      expect(execOrder).toBeLessThan(openedOrder);
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

    it("never attaches a worker when the bootstrap create fails (no leak)", async () => {
      const adapter = createMockAdapter();
      mockCreateExecution.mockRejectedValueOnce(new Error("execution boom"));
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper("local", adapter),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      // The create failed before a session existed, so there is no worker
      // to attach — and therefore nothing to compensate/detach.
      expect(adapter.onSessionOpened).not.toHaveBeenCalled();
      expect(adapter.onSessionClosed).not.toHaveBeenCalled();
      expect(result.current.submitError).not.toBeNull();
      expect(opts.onError).toHaveBeenCalled();
    });

    it("surfaces an attach failure without navigating", async () => {
      const adapter = createMockAdapter();
      adapter.onSessionOpened.mockRejectedValueOnce(new Error("runner down"));
      const opts = defaultOptions();
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper("local", adapter),
      });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.submitError).not.toBeNull();
      expect(opts.onError).toHaveBeenCalled();
      expect(opts.onSessionCreated).not.toHaveBeenCalled();
    });
  });

  describe("the vaults the new conversation uses", () => {
    it.each(["integrator", "endUser"] as const)("includes the sender's My vault for the %s audience by default", async (audience) => {
      const opts = { ...defaultOptions(), audience };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.includeMyVault).toBe(true);
      expect(execInput.sessionSpec.vaults).toBeUndefined();
      expect(execInput.sessionSpec).not.toHaveProperty("secrets");
      expect(execInput).not.toHaveProperty("runtimeEnv");
    });

    it("uses the host's vault choice when the person picked nothing", async () => {
      const vaults = [{ org: "acme", slug: "support-tools" }];
      const opts = { ...defaultOptions(), includeMyVault: false, vaults };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      const spec = mockCreateExecution.mock.calls[0][0].sessionSpec;
      expect(spec.includeMyVault).toBeUndefined();
      expect(spec.vaults).toEqual(vaults);
    });

    it("lets the person's pick in the composer win over the host's, both halves together", async () => {
      const opts = { ...defaultOptions(), includeMyVault: true, vaults: [{ org: "acme", slug: "host-vault" }] };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });
      const picked = [{ org: "acme", slug: "support-tools" }];

      await act(async () => {
        await result.current.submit("Hello", undefined, { includeMyVault: false, vaults: picked });
      });

      const spec = mockCreateExecution.mock.calls[0][0].sessionSpec;
      expect(spec.includeMyVault).toBeUndefined();
      expect(spec.vaults).toEqual(picked);
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

      expect(mockCreateExecution.mock.calls[0][0].sessionSpec.harness).toBe("cursor");
    });
  });

  describe("accountDefaults (the layered seed)", () => {
    // Two native models so "stored pick outranks account default" is
    // distinguishable; the shared TEST_MODELS carries one per harness.
    const SEED_MODELS = parseRegistryJson({
      models: [
        { id: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", shortDescription: "", speedTier: "fast", provider: "anthropic", harness: "native", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 } },
        { id: "gpt-5.3", displayName: "GPT 5.3", shortDescription: "", speedTier: "fast", provider: "openai", harness: "native", costTier: "standard", featured: false, pricing: { inputPricePerMillion: 2, outputPricePerMillion: 8, cacheWritePricePerMillion: 2, cacheReadPricePerMillion: 0.2 } },
        { id: "default", displayName: "Cursor Auto", shortDescription: "", speedTier: "fast", provider: "cursor", harness: "cursor", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 } },
        { id: "composer-2.5", displayName: "Composer 2.5", shortDescription: "", speedTier: "fast", provider: "cursor", harness: "cursor", costTier: "standard", featured: false, pricing: { inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 1, cacheReadPricePerMillion: 0.1 } },
      ],
    });

    function seedWrapper() {
      const state: ModelRegistryState = { models: SEED_MODELS, isLoading: false, error: null, refetch: () => {} };
      return function Wrapper({ children }: { children: ReactNode }) {
        return (
          <ModelRegistryContext.Provider value={state}>
            {children}
          </ModelRegistryContext.Provider>
        );
      };
    }

    it("seeds the harness when nothing is stored", () => {
      const opts = { ...defaultOptions(), accountDefaults: { harness: "cursor" as const } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.harness).toBe("cursor");
    });

    it("a stored harness choice outranks the account default", () => {
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      const opts = { ...defaultOptions(), accountDefaults: { harness: "cursor" as const } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.harness).toBe("native");
    });

    it("the account harness outranks the embedder defaultHarness", () => {
      const opts = {
        ...defaultOptions(),
        defaultHarness: "native" as const,
        accountDefaults: { harness: "cursor" as const },
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.harness).toBe("cursor");
    });

    it("never persists the seeded harness — only explicit choices", () => {
      const opts = { ...defaultOptions(), accountDefaults: { harness: "cursor" as const } };
      renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBeNull();
    });

    it("a late-arriving harness seed applies when the user has not picked (whoAmI resolves after mount)", () => {
      const base: Parameters<typeof useNewSessionFlow>[0] = defaultOptions();
      const { result, rerender } = renderHook(
        (opts: Parameters<typeof useNewSessionFlow>[0]) => useNewSessionFlow(opts),
        { wrapper: seedWrapper(), initialProps: base },
      );
      expect(result.current.harness).toBe("native");

      rerender({ ...base, accountDefaults: { harness: "cursor" as const } });

      expect(result.current.harness).toBe("cursor");
      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBeNull();
    });

    it("a late-arriving harness seed never overrides an explicit pick this mount", () => {
      const base: Parameters<typeof useNewSessionFlow>[0] = defaultOptions();
      const { result, rerender } = renderHook(
        (opts: Parameters<typeof useNewSessionFlow>[0]) => useNewSessionFlow(opts),
        { wrapper: seedWrapper(), initialProps: base },
      );
      act(() => result.current.setHarness("native"));

      rerender({ ...base, accountDefaults: { harness: "cursor" as const } });

      expect(result.current.harness).toBe("native");
    });

    it("seeds the model for the active harness when nothing is stored", () => {
      const opts = { ...defaultOptions(), accountDefaults: { nativeModel: "gpt-5.3" } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.modelId).toBe("gpt-5.3");
    });

    it("a stored model pick outranks the account default", async () => {
      localStorage.setItem(STORAGE_KEY_MODEL_NATIVE, "claude-sonnet-4.6");
      const opts = { ...defaultOptions(), accountDefaults: { nativeModel: "gpt-5.3" } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      // The stored restore lands in a passive effect once the registry is
      // ready; the account seed must not win the race before it.
      await act(async () => {});
      expect(result.current.modelId).toBe("claude-sonnet-4.6");
    });

    it("self-heals a stale account model to the platform default (undefined)", () => {
      const opts = { ...defaultOptions(), accountDefaults: { nativeModel: "retired-model" } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.modelId).toBeUndefined();
    });

    it("never persists the seeded model — only explicit choices", () => {
      const opts = { ...defaultOptions(), accountDefaults: { nativeModel: "gpt-5.3" } };
      renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(localStorage.getItem(STORAGE_KEY_MODEL_NATIVE)).toBeNull();
    });

    it("follows the active harness: cursorModel seeds cursor sessions", () => {
      const opts = {
        ...defaultOptions(),
        accountDefaults: { harness: "cursor" as const, nativeModel: "gpt-5.3", cursorModel: "composer-2.5" },
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      expect(result.current.harness).toBe("cursor");
      expect(result.current.modelId).toBe("composer-2.5");
    });

    it("submits the seeded model explicitly — the pill promise (#663): the preference seeds, the execution spec records", async () => {
      const opts = { ...defaultOptions(), accountDefaults: { nativeModel: "gpt-5.3" } };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution.mock.calls[0][0].modelName).toBe("gpt-5.3");
    });

    it("guest audience ignores accountDefaults entirely", () => {
      const opts = {
        ...defaultOptions(),
        audience: "guest" as const,
        accountDefaults: { harness: "native" as const, nativeModel: "gpt-5.3", cursorModel: "composer-2.5" },
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: seedWrapper() });

      // Platform share policy: cursor harness, no client model.
      expect(result.current.harness).toBe("cursor");
      expect(result.current.modelId).toBeUndefined();
    });
  });

  describe("guest audience", () => {
    it("creates the session against the pinned resolution", async () => {
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "support-bot", version: "v2" });
        result.current.setResolution({ mode: "direct" });
      });
      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).toHaveBeenCalledOnce();
      // The share's reference travels as pinned, version included.
      expect(mockCreateExecution.mock.calls[0][0].sessionSpec.agentRef).toEqual({
        org: "acme",
        slug: "support-bot",
        version: "v2",
      });
      expect(opts.onSessionCreated).toHaveBeenCalledWith("sess-new");
    });

    it("leaves My vault out of a guest's new conversation unless the host includes it", async () => {
      // A public visitor brings no keys: the share's vaults are what its
      // runs use. A member chatting through an organization-audience link
      // is a person on their own token, and the host includes My vault.
      for (const includeMyVault of [undefined, true] as const) {
        mockCreateExecution.mockClear();
        const opts = { ...defaultOptions(), audience: "guest" as const, includeMyVault };
        const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

        act(() => {
          result.current.setAgentRef({ org: "acme", slug: "support-bot" });
          result.current.setResolution({ mode: "direct" });
        });
        await act(async () => {
          await result.current.submit("Hello");
        });

        expect(mockCreateExecution).toHaveBeenCalledOnce();
        expect(mockCreateExecution.mock.calls[0][0].sessionSpec.includeMyVault).toBe(includeMyVault);
      }
    });

    it("never takes a guest's vault pick, only the host's", async () => {
      const opts = { ...defaultOptions(), audience: "guest" as const, includeMyVault: true };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "support-bot" });
        result.current.setResolution({ mode: "direct" });
      });
      await act(async () => {
        await result.current.submit("Hello", undefined, {
          includeMyVault: false,
          vaults: [{ org: "acme", slug: "support-tools" }],
        });
      });

      const spec = mockCreateExecution.mock.calls[0][0].sessionSpec;
      expect(spec.includeMyVault).toBe(true);
      expect(spec.vaults).toBeUndefined();
    });

    it("fails closed on submit without a resolution — never the built-in assistant", async () => {
      // An integrator with no agent picked gets the built-in assistant; a
      // guest on a shared page never does — only the pinned shared agent.
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(mockCreateExecution).not.toHaveBeenCalled();
      expect(result.current.submitError).toContain("still loading");
      expect(opts.onError).toHaveBeenCalled();
    });

    it("always uses the cursor harness, ignoring a stored Console choice", () => {
      // A browser previously used in the Console must not leak its stored
      // harness into a share/embed session.
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.harness).toBe("cursor");
    });

    it("never inherits the host approval default — guests get platform policy (#302)", async () => {
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), {
        wrapper: createWrapper(undefined, null, { autoApproveAll: true }),
      });

      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "support-bot" });
        result.current.setResolution({ mode: "direct" });
      });
      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.autoApproveAll).toBeUndefined();
    });

    it("ignores the embedder's defaultHarness — guests get platform policy", () => {
      const opts = {
        ...defaultOptions(),
        audience: "guest" as const,
        defaultHarness: "native" as const,
      };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.harness).toBe("cursor");
    });

    it("does not restore a stored model — modelId stays undefined", () => {
      localStorage.setItem(STORAGE_KEY_MODEL_CURSOR, DEFAULT_CURSOR_MODEL_ID);
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      expect(result.current.modelId).toBeUndefined();
    });

    it("never writes Console preference keys", () => {
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => result.current.setHarness("native"));
      act(() => result.current.setModelId(DEFAULT_CURSOR_MODEL_ID));

      expect(localStorage.getItem(STORAGE_KEY_HARNESS)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY_MODEL_NATIVE)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY_MODEL_CURSOR)).toBeNull();
    });

    it("submits with the cursor harness and NO model (server resolves Auto)", async () => {
      // Stored values simulate a Console-used browser: neither may leak.
      localStorage.setItem(STORAGE_KEY_HARNESS, "native");
      localStorage.setItem(STORAGE_KEY_MODEL_CURSOR, DEFAULT_CURSOR_MODEL_ID);
      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "support-bot" });
        result.current.setResolution({ mode: "direct" });
      });
      await act(async () => {
        await result.current.submit("Hello");
      });

      const execInput = mockCreateExecution.mock.calls[0][0];
      expect(execInput.sessionSpec.harness).toBe("cursor");
      // Omitted model = cursor's Auto ("default") in the runner. If this ever
      // carries a value, guest follow-ups would silently pin to it via
      // lastExecModelId in useSessionPageFlow.
      expect(execInput.modelName).toBeUndefined();
    });

    it("surfaces launch-gate refusal copy verbatim from the status description", async () => {
      // The backend resolves owner-customizable refusal copy server-side and
      // carries it in the gRPC status description — the flow must hand it to
      // onError untouched (no client-side mapping exists by design).
      const ownerCopy = "This agent is currently unavailable. Please check back later.";
      const { ConnectError, Code } = await import("@connectrpc/connect");
      mockCreateExecution.mockRejectedValueOnce(
        new ConnectError(ownerCopy, Code.FailedPrecondition),
      );

      const opts = { ...defaultOptions(), audience: "guest" as const };
      const { result } = renderHook(() => useNewSessionFlow(opts), { wrapper: createWrapper() });

      act(() => {
        result.current.setAgentRef({ org: "acme", slug: "support-bot" });
        result.current.setResolution({ mode: "direct" });
      });
      await act(async () => {
        await result.current.submit("Hello");
      });

      expect(result.current.submitError).toBe(ownerCopy);
      expect(opts.onError).toHaveBeenCalledWith(ownerCopy);
    });
  });
});
