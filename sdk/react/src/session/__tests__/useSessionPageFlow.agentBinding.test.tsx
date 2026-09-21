import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The agent binding a follow-up carries, in three states.
//
// A session's agent is not immutable: the person may pick one, swap it, or
// drop it and return to the built-in assistant. The flow says exactly what
// changed through the follow-up's `agentInstanceId`: `undefined` leaves the
// session bound as it is; an instance id rebinds it; "" clears it (the
// server reads an empty id as no agent). Pinned here because the clear used
// to send nothing — the chip vanished and the server kept the agent.
// ---------------------------------------------------------------------------

const mockSendFollowUp = vi.fn();

const mockConv = {
  session: { spec: { agentInstanceId: "inst_bound" } },
  isLoading: false,
  completedExecutions: [] as unknown[],
  activeStreamExecution: null,
  workspaceEntries: [] as unknown[],
  submitApproval: vi.fn(),
  sendFollowUp: mockSendFollowUp,
};
vi.mock("../useSessionConversation", () => ({
  useSessionConversation: () => mockConv,
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({ agent: { getByReference: vi.fn() } }),
}));

vi.mock("../../workspace", () => ({
  useWorkspaceEntries: () => ({
    entries: [],
    hasEntries: false,
    toInput: vi.fn().mockReturnValue([]),
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    removeEntry: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("../../execution/useSessionVariables", () => ({
  useSessionVariables: () => ({ variables: [], isEmpty: true, clear: vi.fn() }),
}));

vi.mock("../usePersistedModel", () => ({
  usePersistedModel: () => [undefined, vi.fn()] as const,
}));

const BOUND_REF = { org: "acme", slug: "bound-agent" };
vi.mock("../useAgentRefFromSession", () => ({
  useAgentRefFromSession: (instanceId: string | null) => ({
    agentRef: instanceId ? BOUND_REF : null,
  }),
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

function lastFollowUpOptions() {
  return mockSendFollowUp.mock.calls[mockSendFollowUp.mock.calls.length - 1][1];
}

describe("useSessionPageFlow — the agent binding on a follow-up", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockConv.session = { spec: { agentInstanceId: "inst_bound" } };
  });

  it("seeds the selection from the session's agent and sends no override while it stands", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.agentRef).toEqual(BOUND_REF);

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentInstanceId).toBeUndefined();
  });

  it("rebinds to a picked instance", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.setAgentRef({ org: "acme", slug: "other" });
      result.current.setResolution({ mode: "saved", instanceId: "inst_other" });
    });

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentInstanceId).toBe("inst_other");
  });

  it("clears the binding to the built-in assistant when the agent is dropped", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.clearAgent();
    });
    expect(result.current.agentRef).toBeNull();

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentInstanceId).toBe("");
  });

  it("picking an agent after a clear rebinds rather than clearing", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.clearAgent();
    });
    act(() => {
      result.current.setAgentRef({ org: "acme", slug: "other" });
      result.current.setResolution({ mode: "saved", instanceId: "inst_other" });
    });

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentInstanceId).toBe("inst_other");
  });

  it("a session running the built-in assistant sends no override and seeds no agent", async () => {
    mockConv.session = { spec: { agentInstanceId: "" } };
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.agentRef).toBeNull();

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentInstanceId).toBeUndefined();
  });
});
