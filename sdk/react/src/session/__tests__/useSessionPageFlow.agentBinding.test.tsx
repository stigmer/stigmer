import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The agent binding a follow-up carries, in three states.
//
// A session's agent is not immutable: the person may pick one, swap it, or
// drop it and return to the built-in assistant. The flow says exactly what
// changed through the follow-up's `agentRef`: `undefined` leaves the
// session's agent and its pinned version alone; a reference (no version, so
// the server pins the agent's current one) rebinds it; `null` clears it.
// Pinned here because the clear used to send nothing — the chip vanished and
// the server kept the agent.
// ---------------------------------------------------------------------------

const mockSendFollowUp = vi.fn();

const BOUND_SESSION = {
  spec: { agentRef: { org: "acme", slug: "bound-agent", version: "", kind: 40 } },
  status: { agentId: "agt_bound", agentVersionHash: "h1" },
};

const mockConv = {
  session: BOUND_SESSION as unknown,
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

vi.mock("../useSessionAgentVersion", () => ({
  useSessionAgentVersion: () => ({ isOutdated: false }),
}));

const BOUND_REF = { org: "acme", slug: "bound-agent", kind: 40 };

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

function lastFollowUpOptions() {
  return mockSendFollowUp.mock.calls[mockSendFollowUp.mock.calls.length - 1][1];
}

describe("useSessionPageFlow — the agent binding on a follow-up", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockConv.session = BOUND_SESSION;
  });

  it("seeds the selection from the session's agent and sends no override while it stands", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.agentRef).toEqual(BOUND_REF);

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toBeUndefined();
  });

  it("rebinds to a picked agent, naming no version", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.setAgentRef({ org: "acme", slug: "other" });
      result.current.setResolution({ mode: "saved" });
    });

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toEqual({ org: "acme", slug: "other" });
  });

  it("re-picking the session's own agent sends no override, so its pin stands", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.setAgentRef({ org: "acme", slug: "bound-agent" });
      result.current.setResolution({ mode: "direct" });
    });

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toBeUndefined();
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
    expect(lastFollowUpOptions().agentRef).toBeNull();
  });

  it("a null ref from the composer's picker clears the binding like clearAgent", async () => {
    // The composer's agent picker deselects through `setAgentRef(null)` and
    // `setResolution(null)`, never through `clearAgent`. Both surfaces name
    // one act, so both must send the same wire: no agent. Pinned because
    // the picker path once cleared the screen and left the server bound.
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.setAgentRef(null);
      result.current.setResolution(null);
    });
    expect(result.current.agentRef).toBeNull();

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toBeNull();
  });

  it("picking an agent after a clear rebinds rather than clearing", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    act(() => {
      result.current.clearAgent();
    });
    act(() => {
      result.current.setAgentRef({ org: "acme", slug: "other" });
      result.current.setResolution({ mode: "direct" });
    });

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toEqual({ org: "acme", slug: "other" });
  });

  it("a session running the built-in assistant sends no override and seeds no agent", async () => {
    mockConv.session = { spec: {}, status: {} };
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.agentRef).toBeNull();

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });
    expect(lastFollowUpOptions().agentRef).toBeUndefined();
  });
});
