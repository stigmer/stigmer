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

/** Loosely-typed conversation stub — individual tests mutate the arming and
 * gate fields, and restore them in their afterEach. */
const mockConv = {
  session: { spec: {} } as {
    spec: object;
    metadata?: { labels?: Record<string, string> };
  },
  isLoading: false,
  completedExecutions: [] as unknown[],
  activeStreamExecution: null as {
    spec?: { autoApproveAll?: boolean };
    status?: object;
  } | null,
  pendingApprovals: [] as { toolCallId: string }[],
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

describe("useSessionPageFlow — account preference seed (default_auto_approve)", () => {
  beforeEach(() => {
    mockSubmitApproval.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("arms autoApproveAll from the account preference", () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, accountDefaults: { autoApprove: true } }),
    );
    expect(result.current.autoApproveAll).toBe(true);
  });

  it("a LATE-arriving preference still applies (whoAmI resolves async)", () => {
    // The preference is part of the derivation, not a mount-time
    // initializer — a value arriving after mount must not be missed.
    const initialProps: { accountDefaults?: { autoApprove?: boolean } } = {};
    const { result, rerender } = renderHook(
      ({ accountDefaults }: typeof initialProps) =>
        useSessionPageFlow({ ...OPTS, accountDefaults }),
      { initialProps },
    );
    expect(result.current.autoApproveAll).toBe(false);

    rerender({ accountDefaults: { autoApprove: true } });
    expect(result.current.autoApproveAll).toBe(true);
  });

  it("a late arrival never overrides an explicit in-session OFF", () => {
    const initialProps: { accountDefaults?: { autoApprove?: boolean } } = {};
    const { result, rerender } = renderHook(
      ({ accountDefaults }: typeof initialProps) =>
        useSessionPageFlow({ ...OPTS, accountDefaults }),
      { initialProps },
    );
    act(() => {
      result.current.setAutoApproveAll(false);
    });

    rerender({ accountDefaults: { autoApprove: true } });
    expect(result.current.autoApproveAll).toBe(false);
  });

  it("the user's Turn off beats the preference for this session only", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, accountDefaults: { autoApprove: true } }),
    );

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

  it("carries the preference-armed state into follow-ups", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, accountDefaults: { autoApprove: true } }),
    );

    await act(async () => {
      await result.current.handleSubmit("first message");
    });

    const followUpOpts = mockSendFollowUp.mock.calls[0][1];
    expect(followUpOpts.autoApproveAll).toBe(true);
  });

  it("guests never inherit the account preference", () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({
        ...OPTS,
        audience: "guest",
        accountDefaults: { autoApprove: true },
      }),
    );
    expect(result.current.autoApproveAll).toBe(false);
  });
});

describe("useSessionPageFlow — arming derived from the in-flight run (#816)", () => {
  afterEach(() => {
    mockConv.activeStreamExecution = null;
    mockConv.completedExecutions = [];
    vi.clearAllMocks();
  });

  it("reflects an active execution armed at create (launcher handoff)", () => {
    mockConv.activeStreamExecution = { spec: { autoApproveAll: true }, status: {} };
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.autoApproveAll).toBe(true);
  });

  it("the user's explicit OFF beats the armed run for follow-up carry", async () => {
    mockConv.activeStreamExecution = { spec: { autoApproveAll: true }, status: {} };
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    act(() => {
      result.current.setAutoApproveAll(false);
    });
    expect(result.current.autoApproveAll).toBe(false);

    await act(async () => {
      await result.current.handleSubmit("after explicit off");
    });
    const followUpOpts = mockSendFollowUp.mock.calls.at(-1)?.[1];
    expect(followUpOpts.autoApproveAll).toBeUndefined();
  });

  it("never derives from PAST executions (the reset-on-reload consent contract)", () => {
    // A reloaded page whose history contains an armed run must come up at
    // the host default — deriving from history would make the consent
    // silently survive reloads.
    mockConv.completedExecutions = [{ spec: { autoApproveAll: true }, status: {} }];
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.autoApproveAll).toBe(false);
  });
});

describe("useSessionPageFlow — armed responder (#816, the walk-away scenario)", () => {
  beforeEach(() => {
    mockSubmitApproval.mockResolvedValue(undefined);
  });
  afterEach(() => {
    mockConv.pendingApprovals = [];
    mockConv.activeStreamExecution = null;
    mockConv.session = { spec: {} };
    vi.clearAllMocks();
  });

  it("releases a gate that appears while armed", async () => {
    const { rerender } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    await act(async () => rerender());

    expect(mockSubmitApproval).toHaveBeenCalledExactlyOnceWith(
      "tc1",
      ApprovalAction.APPROVE_ALL,
    );
  });

  it("releases a gate already waiting when the toggle flips ON", async () => {
    mockConv.pendingApprovals = [{ toolCallId: "tc9" }];
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(mockSubmitApproval).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setAutoApproveAll(true);
    });

    expect(mockSubmitApproval).toHaveBeenCalledExactlyOnceWith(
      "tc9",
      ApprovalAction.APPROVE_ALL,
    );
  });

  it("submits once per gate across re-renders", async () => {
    const { rerender } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    await act(async () => rerender());
    await act(async () => rerender());

    expect(mockSubmitApproval).toHaveBeenCalledTimes(1);
  });

  it("covers a LATER gate of a different class (lease scope contract)", async () => {
    // A gate-time APPROVE_ALL grants a class-scoped lease, so a second gate
    // of another class still parks — the responder must answer it too.
    const { rerender } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    mockConv.pendingApprovals = [{ toolCallId: "tc-shell" }];
    await act(async () => rerender());
    mockConv.pendingApprovals = [{ toolCallId: "tc-write" }];
    await act(async () => rerender());

    expect(mockSubmitApproval).toHaveBeenCalledTimes(2);
    expect(mockSubmitApproval).toHaveBeenLastCalledWith(
      "tc-write",
      ApprovalAction.APPROVE_ALL,
    );
  });

  it("does not retry a failed submission (the card stays for manual action)", async () => {
    mockSubmitApproval.mockRejectedValue(new Error("boom"));
    const { rerender } = renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    await act(async () => rerender());
    await act(async () => rerender());

    expect(mockSubmitApproval).toHaveBeenCalledTimes(1);
  });

  it("stays inert while OFF", async () => {
    const { rerender } = renderHook(() => useSessionPageFlow(OPTS));

    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    await act(async () => rerender());

    expect(mockSubmitApproval).not.toHaveBeenCalled();
  });

  it("never fires for a guest, even when the run itself is armed", async () => {
    mockConv.activeStreamExecution = { spec: { autoApproveAll: true }, status: {} };
    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    renderHook(() => useSessionPageFlow({ ...OPTS, audience: "guest" }), {
      wrapper: hostDefaultWrapper(true),
    });

    expect(mockSubmitApproval).not.toHaveBeenCalled();
  });

  it("never fires for an observer", async () => {
    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    renderHook(() => useSessionPageFlow({ ...OPTS, audience: "observer" }), {
      wrapper: hostDefaultWrapper(true),
    });

    expect(mockSubmitApproval).not.toHaveBeenCalled();
  });

  it("never fires for a channel-origin session (read-only by construction)", async () => {
    mockConv.session = {
      spec: {},
      metadata: { labels: { "stigmer.ai/channel-id": "ch_1" } },
    };
    mockConv.pendingApprovals = [{ toolCallId: "tc1" }];
    renderHook(() => useSessionPageFlow(OPTS), {
      wrapper: hostDefaultWrapper(true),
    });

    expect(mockSubmitApproval).not.toHaveBeenCalled();
  });
});
