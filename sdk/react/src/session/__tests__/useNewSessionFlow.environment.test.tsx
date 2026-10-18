/**
 * The new conversation's Environment in the new-conversation flow:
 * - the composer's entry is offered (`offersEnvironment`) to a signed-in
 *   person on a server that has not said, or says Environments govern its
 *   conversations; never to a guest, never under the desktop's local
 *   target, never where the server says its conversations run in no
 *   sandbox it starts;
 * - what applies without a pick is the selected agent's default and the
 *   organization's (`environmentDefaults`), for the composer's preview;
 * - the person's pick rides the bootstrap as `sessionSpec.environmentRef`,
 *   no pick sends none (the server resolves the defaults), and a guest's or
 *   a not-offered pick is never sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { parseRegistryJson } from "../../models/registry";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import { ExecutionTargetContext } from "../../execution-target-context";

const server = vi.hoisted(() => ({
  environments: undefined as { applies: boolean; limitedNetworking: boolean; packages: boolean } | undefined,
}));
const AGENT_DEFAULT = { org: "org_acme", slug: "data-science", id: "env_ds" };
const ORG_DEFAULT = { org: "org_acme", slug: "base-tools", id: "env_bt" };

vi.mock("../../hooks", () => {
  const stigmer = {
    agent: {
      getByReference: async () => ({
        metadata: { id: "agt_analyst", org: "org_acme", slug: "analyst" },
        spec: { environmentRef: AGENT_DEFAULT },
      }),
    },
    platform: { getServerInfo: async () => ({ environments: server.environments }) },
    organization: { get: async () => ({ spec: { preferences: { defaultEnvironmentRef: ORG_DEFAULT } } }) },
  };
  return { useStigmer: () => stigmer };
});

const mockCreateExecution = vi.fn();
vi.mock("../../run/useCreateRun", () => ({
  useCreateRun: () => ({ create: mockCreateExecution, isCreating: false, error: null, clearError: vi.fn() }),
}));

vi.mock("../../workspace", () => ({
  useWorkspaceEntries: () => ({
    entries: [],
    hasEntries: false,
    toInput: () => [],
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    removeEntry: vi.fn(),
    clear: vi.fn(),
  }),
}));

import { useNewSessionFlow } from "../useNewSessionFlow";

const MODELS = parseRegistryJson({ models: [] });

function wrapperWith(executionTarget?: "local" | "cloud") {
  const state: ModelRegistryState = { models: MODELS, isLoading: false, error: null, refetch: () => {} };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ExecutionTargetContext.Provider value={executionTarget}>
        <ModelRegistryContext.Provider value={state}>{children}</ModelRegistryContext.Provider>
      </ExecutionTargetContext.Provider>
    );
  };
}

function options(audience?: "guest") {
  return { org: "org_acme", onSessionCreated: vi.fn(), onError: vi.fn(), ...(audience ? { audience } : {}) };
}

beforeEach(() => {
  localStorage.clear();
  server.environments = undefined;
  mockCreateExecution.mockReset();
  mockCreateExecution.mockResolvedValue({ executionId: "run_new", sessionId: "ses_new" });
});

describe("useNewSessionFlow — the conversation's Environment", () => {
  it("offers the entry on a server that has not said, with the agent's and the organization's defaults", async () => {
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    act(() => {
      result.current.setAgentRef({ org: "org_acme", slug: "analyst" });
    });
    expect(result.current.offersEnvironment).toBe(true);
    await waitFor(() => expect(result.current.environmentDefaults.agent?.slug).toBe("data-science"));
    await waitFor(() => expect(result.current.environmentDefaults.organization?.slug).toBe("base-tools"));
  });

  it("offers it where the server says Environments govern its conversations", async () => {
    server.environments = { applies: true, limitedNetworking: true, packages: true };
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.offersEnvironment).toBe(true));
  });

  it("never offers it where the server's conversations run in no sandbox it starts", async () => {
    server.environments = { applies: false, limitedNetworking: false, packages: false };
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    await waitFor(() => expect(result.current.offersEnvironment).toBe(false));
  });

  it("never offers it to a conversation on the person's own machine", () => {
    server.environments = { applies: true, limitedNetworking: true, packages: true };
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith("local") });
    expect(result.current.offersEnvironment).toBe(false);
  });

  it("never offers it to a guest", () => {
    const { result } = renderHook(() => useNewSessionFlow(options("guest")), { wrapper: wrapperWith() });
    expect(result.current.offersEnvironment).toBe(false);
  });

  it("sends the person's pick, and none when they picked none", async () => {
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    await act(async () => {
      await result.current.submit("Train it", undefined, { environmentRef: { org: "org_acme", slug: "gpu-box" } });
    });
    await act(async () => {
      await result.current.submit("Train it again");
    });
    expect(mockCreateExecution.mock.calls[0]![0].sessionSpec.environmentRef).toEqual({ org: "org_acme", slug: "gpu-box" });
    expect(mockCreateExecution.mock.calls[1]![0].sessionSpec.environmentRef).toBeUndefined();
  });

  it("never sends a pick where the entry is not offered", async () => {
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith("local") });
    await act(async () => {
      await result.current.submit("Train it", undefined, { environmentRef: { org: "org_acme", slug: "gpu-box" } });
    });
    expect(mockCreateExecution.mock.calls[0]![0].sessionSpec.environmentRef).toBeUndefined();
  });
});
