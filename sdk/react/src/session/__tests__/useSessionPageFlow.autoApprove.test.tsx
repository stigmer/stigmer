import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// ---------------------------------------------------------------------------
// Mocks — useSessionPageFlow composes many hooks; we stub them to isolate the
// session-scoped auto-approve behavior (gate sets it, follow-ups carry it,
// "Turn off" reverts it).
// ---------------------------------------------------------------------------

const mockSubmitApproval = vi.fn<(t: string, a: ApprovalAction, c?: string) => Promise<void>>();
const mockSendFollowUp = vi.fn();

const mockConv = {
  session: { spec: {} },
  isLoading: false,
  completedExecutions: [] as unknown[],
  activeStreamExecution: null,
  workspaceEntries: [] as unknown[],
  submitApproval: mockSubmitApproval,
  sendFollowUp: mockSendFollowUp,
};
vi.mock("../useSessionConversation", () => ({
  useSessionConversation: () => mockConv,
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({ agent: { getByReference: vi.fn() } }),
}));

vi.mock("../../agent", () => ({
  useDefaultAgent: () => ({ agent: null, isLoading: false, error: null }),
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

vi.mock("../usePersistedModel", () => ({
  usePersistedModel: () => ["model-x", vi.fn()] as const,
}));

vi.mock("../useAgentRefFromSession", () => ({
  useAgentRefFromSession: () => ({ agentRef: null }),
}));

import type { ReactNode } from "react";
import { useSessionPageFlow } from "../useSessionPageFlow";
import { ApprovalDefaultsContext } from "../../approval-defaults-context";

const OPTS = { sessionId: "ses_1", org: "acme" };

/** Renders the hook under a provider-level host approval default (#302). */
function hostDefaultWrapper(autoApproveAll: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ApprovalDefaultsContext.Provider value={{ autoApproveAll }}>
        {children}
      </ApprovalDefaultsContext.Provider>
    );
  };
}

describe("useSessionPageFlow — gate-driven auto-approve", () => {
  beforeEach(() => {
    mockSubmitApproval.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults autoApproveAll to false", () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.autoApproveAll).toBe(false);
  });

  it("flips autoApproveAll when the gate decision is APPROVE_ALL", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.submitApproval("tc1", ApprovalAction.APPROVE_ALL);
    });

    expect(result.current.autoApproveAll).toBe(true);
    // Still delegates to the underlying conversation submit.
    expect(mockSubmitApproval).toHaveBeenCalledWith("tc1", ApprovalAction.APPROVE_ALL, undefined);
  });

  it("does NOT flip autoApproveAll for a plain APPROVE", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.submitApproval("tc1", ApprovalAction.APPROVE);
    });

    expect(result.current.autoApproveAll).toBe(false);
  });

  it("carries autoApproveAll into follow-up submissions once enabled", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.submitApproval("tc1", ApprovalAction.APPROVE_ALL);
    });
    await act(async () => {
      await result.current.handleSubmit("next message");
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    const followUpOpts = mockSendFollowUp.mock.calls[0][1];
    expect(followUpOpts.autoApproveAll).toBe(true);
  });

  it("does not carry autoApproveAll before any APPROVE_ALL decision", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.handleSubmit("first message");
    });

    const followUpOpts = mockSendFollowUp.mock.calls[0][1];
    expect(followUpOpts.autoApproveAll).toBeUndefined();
  });

  it("reverts via setAutoApproveAll(false) so follow-ups stop carrying it", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.submitApproval("tc1", ApprovalAction.APPROVE_ALL);
    });
    expect(result.current.autoApproveAll).toBe(true);

    act(() => {
      result.current.setAutoApproveAll(false);
    });
    expect(result.current.autoApproveAll).toBe(false);

    await act(async () => {
      await result.current.handleSubmit("after turn off");
    });
    const followUpOpts = mockSendFollowUp.mock.calls.at(-1)?.[1];
    expect(followUpOpts.autoApproveAll).toBeUndefined();
  });
});

describe("useSessionPageFlow — host-set approval default (#302)", () => {
  beforeEach(() => {
    mockSubmitApproval.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("arms autoApproveAll from the provider default, before any gate", () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });
    expect(result.current.autoApproveAll).toBe(true);
  });

  it("carries the host default into the very first follow-up", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    await act(async () => {
      await result.current.handleSubmit("first message");
    });

    const followUpOpts = mockSendFollowUp.mock.calls[0][1];
    expect(followUpOpts.autoApproveAll).toBe(true);
  });

  it("the user's Turn off beats the host default for the rest of the session", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    act(() => {
      result.current.setAutoApproveAll(false);
    });
    expect(result.current.autoApproveAll).toBe(false);

    await act(async () => {
      await result.current.handleSubmit("after turn off");
    });
    const followUpOpts = mockSendFollowUp.mock.calls.at(-1)?.[1];
    expect(followUpOpts.autoApproveAll).toBeUndefined();
  });

  it("guests never inherit the host default", () => {
    const { result } = renderHook(
      () => useSessionPageFlow({ ...OPTS, audience: "guest" }),
      { wrapper: hostDefaultWrapper(true) },
    );
    expect(result.current.autoApproveAll).toBe(false);
  });

  it("an explicit false default changes nothing", () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(false),
    });
    expect(result.current.autoApproveAll).toBe(false);
  });
});
