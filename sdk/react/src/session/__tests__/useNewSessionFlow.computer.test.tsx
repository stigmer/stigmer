/**
 * The new-conversation flow on an agent without a computer
 * (`AgentSpec.computer` COMPUTER_NONE):
 * - `agentHasComputer` is false once the agent is read, and true for an
 *   agent saved before the setting;
 * - the harness is Stigmer whatever the person's remembered choice, the
 *   Environment entry is not offered, and the conversation is sent with no
 *   repositories and no Environment;
 * - the same flow on an agent with a computer keeps all three.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { ReactNode } from "react";
import { parseRegistryJson } from "@stigmer/react-core";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import { ExecutionTargetContext } from "@stigmer/react-core/internal";

const agent = vi.hoisted(() => ({ computer: 0 }));
const server = vi.hoisted(() => ({
  environments: undefined as { applies: boolean; limitedNetworking: boolean; packages: boolean } | undefined,
}));
const AGENT_DEFAULT = { org: "org_acme", slug: "data-science", id: "env_ds" };
const ORG_DEFAULT = { org: "org_acme", slug: "base-tools", id: "env_bt" };

const mockCreateExecution = vi.fn();
vi.mock("@stigmer/react-core", async (importOriginal) => {
  const stigmer = {
    agent: {
      getByReference: async () => ({
        metadata: { id: "agt_analyst", org: "org_acme", slug: "analyst" },
        spec: { computer: agent.computer, environmentRef: agent.computer === Computer.NONE ? undefined : AGENT_DEFAULT },
      }),
    },
    platform: { getServerInfo: async () => ({ environments: server.environments }) },
    organization: { get: async () => ({ spec: { preferences: { defaultEnvironmentRef: ORG_DEFAULT } } }) },
  };
  return {
    ...(await importOriginal<typeof import("@stigmer/react-core")>()),
    useCreateRun: () => ({ create: mockCreateExecution, isCreating: false, error: null, clearError: vi.fn() }),
    useStigmer: () => stigmer,
  };
});

vi.mock("../../workspace", () => ({
  useWorkspaceEntries: () => ({
    entries: [{ id: "e1", name: "acme/app", type: "git", gitUrl: "https://github.com/acme/app.git" }],
    hasEntries: true,
    toInput: () => [{ name: "acme/app", gitRepository: { url: "https://github.com/acme/app.git" } }],
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
  agent.computer = Computer.UNSPECIFIED;
  server.environments = undefined;
  mockCreateExecution.mockReset();
  mockCreateExecution.mockResolvedValue({ executionId: "run_new", sessionId: "ses_new" });
});

const STORAGE_KEY_HARNESS = "stigmer:session:harness";

describe("useNewSessionFlow — an agent without a computer", () => {
  it("runs on Stigmer alone, offers no Environment and sends no repositories", async () => {
    agent.computer = Computer.NONE;
    localStorage.setItem(STORAGE_KEY_HARNESS, "claude");
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    act(() => {
      result.current.setAgentRef({ org: "org_acme", slug: "analyst" });
    });
    await waitFor(() => expect(result.current.agentHasComputer).toBe(false));
    expect(result.current.harness).toBe("stigmer");
    expect(result.current.offersEnvironment).toBe(false);
    await act(async () => {
      await result.current.submit("Answer the ticket", undefined, { environmentRef: { org: "org_acme", slug: "gpu-box" } });
    });
    const spec = mockCreateExecution.mock.calls[0]![0].sessionSpec;
    expect(spec.resources).toBeUndefined();
    expect(spec.environmentRef).toBeUndefined();
    expect(spec.harness).toBe("stigmer");
  });

  it("keeps all three for an agent saved before the setting", async () => {
    localStorage.setItem(STORAGE_KEY_HARNESS, "claude");
    const { result } = renderHook(() => useNewSessionFlow(options()), { wrapper: wrapperWith() });
    act(() => {
      result.current.setAgentRef({ org: "org_acme", slug: "analyst" });
    });
    await waitFor(() => expect(result.current.environmentDefaults.agent?.slug).toBe("data-science"));
    expect(result.current.agentHasComputer).toBe(true);
    expect(result.current.harness).toBe("claude");
    expect(result.current.offersEnvironment).toBe(true);
    await act(async () => {
      await result.current.submit("Fix the build");
    });
    expect(mockCreateExecution.mock.calls[0]![0].sessionSpec.resources).toHaveLength(1);
  });
});
