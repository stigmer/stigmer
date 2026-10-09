import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Guest-audience gating for useSessionPageFlow.
//
// A guest token cannot read the session's agent (`agent.get` is FGA-denied —
// sharing writes no tuples). The flow must turn the agent-version reads off,
// seed no agent selection, and send follow-ups without an agent override,
// continuing on the agent and version the session pinned.
// ---------------------------------------------------------------------------

const mockSendFollowUp = vi.fn();

const mockConv = {
  session: {
    spec: { agentRef: { org: "acme", slug: "support-bot", version: "v2", kind: 40 } },
    status: { agentId: "agt_1", agentVersionHash: "h2" },
  },
  isLoading: false,
  completedRuns: [] as unknown[],
  activeStreamRun: null,
  workspaceEntries: [] as unknown[],
  submitApproval: vi.fn(),
  sendFollowUp: mockSendFollowUp,
};
vi.mock("../useSessionConversation", () => ({
  useSessionConversation: () => mockConv,
}));

// One client for every render, as the provider gives: a fresh object per
// call would change the agent reads' inputs on each render.
vi.mock("../../hooks", () => {
  const stigmer = { agent: { getByReference: vi.fn().mockResolvedValue(null) } };
  return { useStigmer: () => stigmer };
});

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

// Honors `enabled` like the real hook: disabled → no persisted model. Guest
// isolation depends on this contract (usePersistedModel has its own tests).
const usePersistedModelSpy = vi.fn(
  (opts?: { harness?: string; enabled?: boolean }) =>
    (opts?.enabled === false
      ? ([undefined, vi.fn()] as const)
      : (["model-x", vi.fn()] as const)),
);
vi.mock("../usePersistedModel", () => ({
  usePersistedModel: (opts?: { harness?: string; enabled?: boolean }) =>
    usePersistedModelSpy(opts),
}));

const useSessionAgentVersionSpy = vi.fn(
  (_session: unknown, _opts: { enabled: boolean }) => ({ isOutdated: false }),
);
vi.mock("../useSessionAgentVersion", () => ({
  useSessionAgentVersion: (session: unknown, opts: { enabled: boolean }) =>
    useSessionAgentVersionSpy(session, opts),
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

describe("useSessionPageFlow — guest audience", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("turns the agent reads off and seeds no agent selection", () => {
    const { result } = renderHook(() => useSessionPageFlow({ ...OPTS, audience: "guest" }));

    expect(useSessionAgentVersionSpy).toHaveBeenCalledWith(
      mockConv.session,
      expect.objectContaining({ enabled: false }),
    );
    expect(result.current.agentRef).toBeNull();
  });

  it("keeps the agent reads on for other audiences", () => {
    renderHook(() => useSessionPageFlow(OPTS));

    expect(useSessionAgentVersionSpy).toHaveBeenCalledWith(
      mockConv.session,
      expect.objectContaining({ enabled: true }),
    );
  });

  it("sends follow-ups without an agent override", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest" }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    // No override: the run continues on the session's pinned agent.
    expect(mockSendFollowUp.mock.calls[0][1].agentRef).toBeUndefined();
  });

  it("never changes which vaults the conversation uses", async () => {
    // Which vaults a conversation uses is its creator's to write; the
    // share's vaults are what a guest's runs use.
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest" }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up", undefined, {
        includeMyVault: true,
        vaults: [{ org: "acme", slug: "support-tools" }],
      });
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    expect(mockSendFollowUp.mock.calls[0][1].includeMyVault).toBeUndefined();
    expect(mockSendFollowUp.mock.calls[0][1].vaults).toBeUndefined();
  });

  it("disables model persistence — a Console-stored model must not leak in", () => {
    renderHook(() => useSessionPageFlow({ ...OPTS, audience: "guest" }));

    expect(usePersistedModelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("keeps model persistence for other audiences", () => {
    renderHook(() => useSessionPageFlow(OPTS));

    expect(usePersistedModelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("sends follow-ups with NO model — the session's harness resolves it", async () => {
    // A guest's turn runs the share's saved settings, which the server
    // writes over whatever the visitor sent, so a guest never seeds a
    // follow-up from an earlier turn: even a turn that records a model
    // must not put one on the next message.
    mockConv.completedRuns = [
      { spec: { runConfig: { modelName: "claude-sonnet-4.6", maxCostUsd: 0.5 } } },
    ];
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest" }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    expect(mockSendFollowUp.mock.calls[0][1].modelName).toBeUndefined();
    mockConv.completedRuns = [];
  });
});
