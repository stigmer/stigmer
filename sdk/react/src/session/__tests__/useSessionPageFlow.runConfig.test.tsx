import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Owner-pinned run config for useSessionPageFlow (stigmer/stigmer#664).
//
// A platform-billed embedder pins the model/tier once and every follow-up
// carries it — winning over the composer's selection, the persisted
// Console preference, and the last execution's model — including retries,
// which re-enter the same submit path. Guests never carry a pin: their
// execution config is owned by the server-side share policy.
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

vi.mock("../../execution/useSessionVariables", () => ({
  useSessionVariables: () => ({ variables: [], isEmpty: true, clear: vi.fn() }),
}));

// Honors `enabled` like the real hook (contract pinned by its own tests).
vi.mock("../usePersistedModel", () => ({
  usePersistedModel: (opts?: { enabled?: boolean }) =>
    (opts?.enabled === false
      ? ([undefined, vi.fn()] as const)
      : (["persisted-model", vi.fn()] as const)),
}));

vi.mock("../useAgentRefFromSession", () => ({
  useAgentRefFromSession: () => ({ agentRef: null }),
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };
const PIN = { modelName: "pinned-model", serviceTier: "fast" } as const;

describe("useSessionPageFlow — owner-pinned runConfig (#664)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stamps the pinned model and fast tier on a composer follow-up, over the composer's own selection", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, runConfig: PIN }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up", "user-picked-model", {
        serviceTier: undefined,
      });
    });

    const options = mockSendFollowUp.mock.calls[0][1];
    expect(options.modelName).toBe("pinned-model");
    expect(options.serviceTier).toBe("fast");
  });

  it("stamps the pin on a bare re-submit (the execution-retry path passes no composer args)", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, runConfig: PIN }),
    );

    await act(async () => {
      await result.current.handleSubmit("retry me");
    });

    const options = mockSendFollowUp.mock.calls[0][1];
    expect(options.modelName).toBe("pinned-model");
    expect(options.serviceTier).toBe("fast");
  });

  it("a model-only pin suppresses a composer-armed fast tier (the pin owns the whole run config)", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, runConfig: { modelName: "pinned-model" } }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up", undefined, {
        serviceTier: "fast",
      });
    });

    const options = mockSendFollowUp.mock.calls[0][1];
    expect(options.modelName).toBe("pinned-model");
    expect(options.serviceTier).toBeUndefined();
  });

  it("keeps the unpinned behavior byte-identical when no runConfig is given", async () => {
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    await act(async () => {
      await result.current.handleSubmit("follow up", "user-picked-model", {
        serviceTier: "fast",
      });
    });

    const options = mockSendFollowUp.mock.calls[0][1];
    expect(options.modelName).toBe("user-picked-model");
    expect(options.serviceTier).toBe("fast");
  });

  it("ignores the pin entirely for guests — their no-modelName invariant survives a misconfigured embed", async () => {
    const { result } = renderHook(() =>
      useSessionPageFlow({ ...OPTS, audience: "guest", runConfig: PIN }),
    );

    await act(async () => {
      await result.current.handleSubmit("follow up");
    });

    const options = mockSendFollowUp.mock.calls[0][1];
    expect(options.modelName).toBeUndefined();
    expect(options.serviceTier).toBeUndefined();
  });

  it("throws at render for the statically-wrong pin (fast tier, no model)", () => {
    expect(() =>
      renderHook(() =>
        useSessionPageFlow({ ...OPTS, runConfig: { serviceTier: "fast" } }),
      ),
    ).toThrowError(/serviceTier "fast" requires modelName/);
  });
});
