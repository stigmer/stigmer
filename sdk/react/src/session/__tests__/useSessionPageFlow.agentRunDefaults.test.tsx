/**
 * The model a follow-up on an existing conversation starts from.
 *
 * The composer seeds from the last message's REQUESTED settings
 * (`spec.run_config`), never from what the server resolved
 * (`status.run_config`): reading the resolved settings would copy an
 * agent's default into every later message as if the person had picked
 * it. Where the agent the conversation runs names a model for the
 * conversation's engine, a model remembered on the device does not seed
 * either; the flow hands the composer the agent's defaults instead.
 *
 * Pins: the seed reads spec, not status; the remembered model applies
 * only where the agent names none; the agent's defaults apply only on
 * the agent's engine and only for the session's own agent at its pinned
 * version; choosing the agent's default back drops the last pick from the
 * seed until the person picks again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

const mockConv = {
  session: {
    spec: { agentRef: { org: "acme", slug: "reviewer" }, harness: Harness.NATIVE },
    status: { agentId: "agt_1", agentVersionHash: "a".repeat(64) },
  },
  isLoading: false,
  completedRuns: [] as unknown[],
  activeStreamRun: null,
  workspaceEntries: [] as unknown[],
  submitApproval: vi.fn(),
  sendFollowUp: vi.fn(),
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

vi.mock("../../run/useSessionVariables", () => ({
  useSessionVariables: () => ({ variables: [], isEmpty: true, clear: vi.fn() }),
}));

vi.mock("../usePersistedModel", () => ({
  usePersistedModel: () => ["remembered-model", vi.fn()] as const,
}));

vi.mock("../useSessionAgentVersion", () => ({
  useSessionAgentVersion: () => ({ isOutdated: false }),
}));

const runAgentSpecCalls: Array<{ ref: unknown; versionHash: unknown }> = [];
let mockAgentSpec: unknown = undefined;
vi.mock("../../agent/useRunAgentSpec", () => ({
  useRunAgentSpec: (ref: unknown, versionHash: unknown) => {
    runAgentSpecCalls.push({ ref, versionHash });
    return { agent: null, spec: mockAgentSpec };
  },
}));

import { useSessionPageFlow } from "../useSessionPageFlow";

const OPTS = { sessionId: "ses_1", org: "acme" };

const AGENT_ON_NATIVE = {
  harness: Harness.NATIVE,
  runConfig: { modelName: "claude-sonnet-4-6", thinkingMode: ThinkingMode.ENABLED },
};

afterEach(() => {
  mockAgentSpec = undefined;
  mockConv.completedRuns = [];
  runAgentSpecCalls.length = 0;
});

describe("useSessionPageFlow — the agent's run defaults and the model seed", () => {
  it("hands the composer the agent's defaults and seeds no remembered model", () => {
    mockAgentSpec = AGENT_ON_NATIVE;
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    expect(result.current.agentRunDefaults).toEqual({
      modelName: "claude-sonnet-4-6",
      thinkingMode: "enabled",
    });
    expect(result.current.model[0]).toBeUndefined();
  });

  it("seeds from the last message's requested model, never the resolved one", () => {
    mockAgentSpec = AGENT_ON_NATIVE;
    mockConv.completedRuns = [
      {
        spec: { runConfig: { modelName: "claude-haiku-4-5" } },
        status: { runConfig: { modelName: "claude-sonnet-4-6" } },
      },
    ];
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.model[0]).toBe("claude-haiku-4-5");
  });

  it("choosing the agent's default back drops the last pick until the next pick", () => {
    mockAgentSpec = AGENT_ON_NATIVE;
    mockConv.completedRuns = [
      { spec: { runConfig: { modelName: "claude-haiku-4-5" } }, status: {} },
    ];
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.model[0]).toBe("claude-haiku-4-5");

    act(() => result.current.clearModelPick());
    expect(result.current.model[0]).toBeUndefined();

    act(() => result.current.model[1]("claude-haiku-4-5"));
    expect(result.current.model[0]).toBe("claude-haiku-4-5");
  });

  it("never copies a resolved agent default into the seed", () => {
    mockAgentSpec = AGENT_ON_NATIVE;
    mockConv.completedRuns = [
      { spec: {}, status: { runConfig: { modelName: "claude-sonnet-4-6" } } },
    ];
    const { result } = renderHook(() => useSessionPageFlow(OPTS));
    expect(result.current.model[0]).toBeUndefined();
  });

  it("applies no agent default on another engine, and the remembered model seeds", () => {
    mockAgentSpec = { ...AGENT_ON_NATIVE, harness: Harness.CURSOR };
    const { result } = renderHook(() => useSessionPageFlow(OPTS));

    expect(result.current.agentRunDefaults).toBeUndefined();
    expect(result.current.model[0]).toBe("remembered-model");
  });

  it("reads the session's own agent at the version the session pins", () => {
    renderHook(() => useSessionPageFlow(OPTS));
    expect(runAgentSpecCalls.at(-1)).toEqual({
      ref: expect.objectContaining({ org: "acme", slug: "reviewer" }),
      versionHash: "a".repeat(64),
    });
  });

  it("reads nothing for a guest (a guest token cannot read the agent)", () => {
    renderHook(() => useSessionPageFlow({ ...OPTS, audience: "guest" }));
    expect(runAgentSpecCalls.at(-1)?.ref).toBeNull();
  });
});
