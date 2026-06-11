import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — useSessionPageFlow composes many hooks; we stub them to isolate the
// host runtime-env behavior (per-follow-up evaluation, host-wins merge, and
// fail-fast into submitError before any optimistic UI).
// ---------------------------------------------------------------------------

const mockSendFollowUp = vi.fn();

const mockConv = {
  session: { spec: {} },
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

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

describe("useSessionPageFlow — host runtime env (getRuntimeEnv)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges host env into follow-ups, host wins on collisions", async () => {
    const getRuntimeEnv = vi.fn().mockResolvedValue({
      PLATFORM_TOKEN: { value: "fresh-token", isSecret: true },
    });
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getRuntimeEnv }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up", undefined, {
        runtimeEnv: {
          PLATFORM_TOKEN: { value: "stale-token", isSecret: true },
          USER_VAR: { value: "kept" },
        },
      });
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    expect(mockSendFollowUp.mock.calls[0][1].runtimeEnv).toEqual({
      PLATFORM_TOKEN: { value: "fresh-token", isSecret: true },
      USER_VAR: { value: "kept" },
    });
  });

  it("evaluates the provider fresh on every follow-up", async () => {
    let mint = 0;
    const getRuntimeEnv = vi.fn(() => ({ TOKEN: { value: `token-${++mint}` } }));
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getRuntimeEnv }),
    );

    await act(async () => {
      await result.current.handleSubmit("first");
    });
    await act(async () => {
      await result.current.handleSubmit("second");
    });

    expect(getRuntimeEnv).toHaveBeenCalledTimes(2);
    expect(mockSendFollowUp.mock.calls[0][1].runtimeEnv).toEqual({
      TOKEN: { value: "token-1" },
    });
    expect(mockSendFollowUp.mock.calls[1][1].runtimeEnv).toEqual({
      TOKEN: { value: "token-2" },
    });
  });

  it("blocks the send and sets submitError when the provider throws", async () => {
    const getRuntimeEnv = vi.fn().mockRejectedValue(new Error("token mint failed"));
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getRuntimeEnv }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    // Nothing was sent: no optimistic message, no session-variable clear.
    expect(mockSendFollowUp).not.toHaveBeenCalled();
    expect(mockSessionVariables.clear).not.toHaveBeenCalled();
    expect(result.current.submitError).toBeInstanceOf(Error);
    expect(result.current.submitError?.message).toBe("token mint failed");
  });

  it("clears submitError at the start of the next submission", async () => {
    const getRuntimeEnv = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValue({ TOKEN: { value: "ok" } });
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getRuntimeEnv }),
    );

    await act(async () => {
      await result.current.handleSubmit("fails");
    });
    expect(result.current.submitError).not.toBeNull();

    await act(async () => {
      await result.current.handleSubmit("succeeds");
    });
    expect(result.current.submitError).toBeNull();
    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
  });

  it("passes composer env through untouched when no provider is configured", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.handleSubmit("follow up", undefined, {
        runtimeEnv: { USER_VAR: { value: "composer-only" } },
      });
    });

    expect(mockSendFollowUp.mock.calls[0][1].runtimeEnv).toEqual({
      USER_VAR: { value: "composer-only" },
    });
  });
});
