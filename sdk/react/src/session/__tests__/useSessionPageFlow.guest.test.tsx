import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Guest-audience gating for useSessionPageFlow.
//
// A guest token cannot read the org default agent or derive the session's
// agent (`agentInstance.get` → `agent.get` are FGA-denied — sharing writes
// no tuples). The flow must put both lookups into their `null` no-op mode
// and send follow-ups without an agent override, continuing on the
// session's server-bound instance.
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

const useDefaultAgentSpy = vi.fn((_org: string | null) => ({
  agent: null,
  isLoading: false,
  error: null,
}));
vi.mock("../../agent", () => ({
  useDefaultAgent: (org: string | null) => useDefaultAgentSpy(org),
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
  isEmpty: true,
  clear: vi.fn(),
};
vi.mock("../../execution/useSessionVariables", () => ({
  useSessionVariables: () => mockSessionVariables,
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

const useAgentRefFromSessionSpy = vi.fn((_instanceId: string | null) => ({
  agentRef: null,
}));
vi.mock("../useAgentRefFromSession", () => ({
  useAgentRefFromSession: (instanceId: string | null) =>
    useAgentRefFromSessionSpy(instanceId),
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

describe("useSessionPageFlow — guest audience", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disables the session→agent derivation and default-agent lookup", () => {
    renderHook(() => useSessionPageFlow({ ...OPTS, audience: "guest" }));

    expect(useAgentRefFromSessionSpy).toHaveBeenCalledWith(null);
    expect(useDefaultAgentSpy).toHaveBeenCalledWith(null);
  });

  it("keeps both lookups active for other audiences", () => {
    renderHook(() => useSessionPageFlow(OPTS));

    expect(useAgentRefFromSessionSpy).toHaveBeenCalledWith("inst_bound");
    expect(useDefaultAgentSpy).toHaveBeenCalledWith("acme");
  });

  it("sends follow-ups without an agent override", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest" }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    // No override: the execution continues on the session's bound instance.
    expect(mockSendFollowUp.mock.calls[0][1].agentInstanceId).toBeUndefined();
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
    // Invariant this relies on: guest executions never carry a modelName
    // (the first message omits it and the server-side guest execution
    // profile owns spec.execution_config thereafter), so the composer's
    // lastExecModelId fallback stays undefined too. If this test starts
    // failing because a guest execution carries a model, fix the server
    // profile — do not special-case lastExecModelId.
    mockConv.completedExecutions = [
      { spec: { executionConfig: { maxCostUsd: 0.5 } } },
    ];
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest" }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    expect(mockSendFollowUp.mock.calls[0][1].modelName).toBeUndefined();
    mockConv.completedExecutions = [];
  });
});
