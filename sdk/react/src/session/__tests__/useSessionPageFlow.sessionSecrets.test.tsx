/**
 * A follow-up's own secrets: the host provider is evaluated per follow-up,
 * host values win on a name collision, the merged values reach
 * `sendFollowUp` as the conversation's `secrets` (written by a session
 * update, never on the run), and a provider failure lands in submitError
 * before any optimistic UI.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — useSessionPageFlow composes many hooks; we stub them to isolate the
// host secrets behavior (per-follow-up evaluation, host-wins merge, and
// fail-fast into submitError before any optimistic UI).
// ---------------------------------------------------------------------------

const mockSendFollowUp = vi.fn();

const mockConv = {
  session: { spec: {} },
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

const mockSessionVariables = {
  variables: [],
  isEmpty: true,
  clear: vi.fn(),
};
vi.mock("../../run/useSessionVariables", () => ({
  useSessionVariables: () => mockSessionVariables,
}));

vi.mock("../usePersistedModel", () => ({
  usePersistedModel: () => ["model-x", vi.fn()] as const,
}));

vi.mock("../useSessionAgentVersion", () => ({
  useSessionAgentVersion: () => ({ isOutdated: false }),
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

describe("useSessionPageFlow — host secrets (getSessionSecrets)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges host env into follow-ups, host wins on collisions", async () => {
    const getSessionSecrets = vi.fn().mockResolvedValue({
      PLATFORM_TOKEN: "fresh-token",
    });
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getSessionSecrets }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up", undefined, {
        secrets: {
          PLATFORM_TOKEN: "stale-token",
          USER_VAR: "kept",
        },
      });
    });

    expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
    expect(mockSendFollowUp.mock.calls[0][1].secrets).toEqual({
      PLATFORM_TOKEN: "fresh-token",
      USER_VAR: "kept",
    });
  });

  it("evaluates the provider fresh on every follow-up", async () => {
    let mint = 0;
    const getSessionSecrets = vi.fn(() => ({ TOKEN: `token-${++mint}` }));
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getSessionSecrets }),
    );

    await act(async () => {
      await result.current.handleSubmit("first");
    });
    await act(async () => {
      await result.current.handleSubmit("second");
    });

    expect(getSessionSecrets).toHaveBeenCalledTimes(2);
    expect(mockSendFollowUp.mock.calls[0][1].secrets).toEqual({
      TOKEN: "token-1",
    });
    expect(mockSendFollowUp.mock.calls[1][1].secrets).toEqual({
      TOKEN: "token-2",
    });
  });

  it("blocks the send and sets submitError when the provider throws", async () => {
    const getSessionSecrets = vi.fn().mockRejectedValue(new Error("token mint failed"));
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getSessionSecrets }),
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
    const getSessionSecrets = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValue({ TOKEN: "ok" });
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, getSessionSecrets }),
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
        secrets: { USER_VAR: "composer-only" },
      });
    });

    expect(mockSendFollowUp.mock.calls[0][1].secrets).toEqual({
      USER_VAR: "composer-only",
    });
  });
});
