/**
 * Pins the agent-eval hooks: the list asks `listByAgent` for the agent and
 * skips an empty id, and lists again while any eval it holds is pending or
 * running, no more once all have finished; one eval is read again while it
 * runs and no more once it has finished, nor once a read answers NotFound;
 * start and cancel call the client and keep a refusal as their error,
 * which clearError or the next call resets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCancelAgentEval } from "../useCancelAgentEval";
import { AGENT_EVAL_POLL_MS, useAgentEval } from "../useAgentEval";
import { useAgentEvals } from "../useAgentEvals";
import { useStartAgentEval } from "../useStartAgentEval";
import { agentEvalWith } from "./agent-eval-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useAgentEvals", () => {
  it("lists the agent's evals, and asks nothing for an empty id", async () => {
    const listByAgent = vi.fn(async () => ({ entries: [agentEvalWith([])], nextPageToken: "" }));
    const { result } = renderHook(() => useAgentEvals("agt_1"), {
      wrapper: wrap({ agenteval: { listByAgent } }),
    });
    await waitFor(() => expect(result.current.evals).toHaveLength(1));
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1" }),
    );
    listByAgent.mockClear();
    renderHook(() => useAgentEvals(""), {
      wrapper: wrap({ agenteval: { listByAgent } }),
    });
    expect(listByAgent).not.toHaveBeenCalled();
  });

  it("lists again while any listed eval is pending or running, and stops once all have finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = agentEvalWith([], { id: "aev_2", phase: PluginEvalPhase.running });
    const listByAgent = vi
      .fn()
      .mockResolvedValueOnce({ entries: [running, agentEvalWith([])], nextPageToken: "" })
      .mockResolvedValue({
        entries: [agentEvalWith([], { id: "aev_2" }), agentEvalWith([])],
        nextPageToken: "",
      });
    const { result } = renderHook(() => useAgentEvals("agt_1"), {
      wrapper: wrap({ agenteval: { listByAgent } }),
    });
    await waitFor(() =>
      expect(result.current.evals[0]?.status?.phase).toBe(PluginEvalPhase.running),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS + 10);
    });
    await waitFor(() =>
      expect(result.current.evals[0]?.status?.phase).toBe(PluginEvalPhase.completed),
    );
    const calls = listByAgent.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS * 3);
    });
    expect(listByAgent.mock.calls.length, "no list once all finished").toBe(calls);
  });
});

describe("useAgentEval", () => {
  it("reads a running eval again until it has finished, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = agentEvalWith([], { phase: PluginEvalPhase.running });
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValue(agentEvalWith([]));
    const { result } = renderHook(() => useAgentEval("aev_1"), {
      wrapper: wrap({ agenteval: { get } }),
    });
    await waitFor(() =>
      expect(result.current.agentEval?.status?.phase).toBe(PluginEvalPhase.running),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS + 10);
    });
    await waitFor(() =>
      expect(result.current.agentEval?.status?.phase).toBe(PluginEvalPhase.completed),
    );
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once finished").toBe(calls);
  });

  it("stops reading a running eval once a read answers NotFound, and asks nothing for an empty id", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refusal = new StigmerError("not-found", "agent eval not found", Code.NotFound);
    const get = vi
      .fn()
      .mockResolvedValueOnce(agentEvalWith([], { phase: PluginEvalPhase.running }))
      .mockRejectedValue(refusal);
    const { result } = renderHook(() => useAgentEval("aev_1"), {
      wrapper: wrap({ agenteval: { get } }),
    });
    await waitFor(() => expect(result.current.agentEval).not.toBeNull());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS + 10);
    });
    await waitFor(() => expect(result.current.error).toBe(refusal));
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_EVAL_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once refused").toBe(calls);

    get.mockClear();
    renderHook(() => useAgentEval(""), { wrapper: wrap({ agenteval: { get } }) });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useStartAgentEval and useCancelAgentEval", () => {
  it("start creates the eval, and a refusal is kept as the error", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(agentEvalWith([]))
      .mockRejectedValueOnce(new Error("the agent attaches no plugin with eval cases"));
    const { result } = renderHook(() => useStartAgentEval(), {
      wrapper: wrap({ agenteval: { create } }),
    });
    const input = { name: "", org: "org_acme", agentId: "agt_1", maxCostUsd: 5 };
    await act(async () => {
      await result.current.start(input);
    });
    expect(create).toHaveBeenCalledWith(input);
    await act(async () => {
      await expect(result.current.start(input)).rejects.toThrow("no plugin with eval cases");
    });
    expect(result.current.error?.message).toBe("the agent attaches no plugin with eval cases");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("cancel cancels by id, keeps a refusal as the error, and the next cancel clears it", async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("only the agent's editors may cancel"))
      .mockResolvedValueOnce(agentEvalWith([]));
    const { result } = renderHook(() => useCancelAgentEval(), {
      wrapper: wrap({ agenteval: { cancel } }),
    });
    await act(async () => {
      await expect(result.current.cancel("aev_1")).rejects.toThrow(
        "only the agent's editors may cancel",
      );
    });
    expect(result.current.error?.message).toBe("only the agent's editors may cancel");
    expect(result.current.isCancelling).toBe(false);
    await act(async () => {
      await result.current.cancel("aev_1");
    });
    expect(cancel).toHaveBeenLastCalledWith("aev_1");
    expect(result.current.error).toBeNull();
  });
});
