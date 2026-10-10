/**
 * Pins the plugin-eval hooks: the list asks `listByPlugin` for the plugin
 * and skips an empty id, and lists again while any eval it holds is
 * pending or running, no more once all have finished; one eval is read again while it runs and no more
 * once it has finished, nor once a read answers NotFound or
 * PermissionDenied, while a transient failure keeps the polling; start and cancel call the client and keep a
 * refusal as their error, which clearError or the next call resets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCancelPluginEval } from "../useCancelPluginEval";
import { PLUGIN_EVAL_POLL_MS, usePluginEval } from "../usePluginEval";
import { usePluginEvals } from "../usePluginEvals";
import { useStartPluginEval } from "../useStartPluginEval";
import { evalWith } from "./eval-fixture";

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

describe("usePluginEvals", () => {
  it("lists the plugin's evals, and asks nothing for an empty id", async () => {
    const listByPlugin = vi.fn(async () => ({
      totalCount: 1,
      items: [evalWith([])],
    }));
    const { result } = renderHook(() => usePluginEvals("plg_1"), {
      wrapper: wrap({ plugineval: { listByPlugin } }),
    });
    await waitFor(() => expect(result.current.evals).toHaveLength(1));
    expect(listByPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "plg_1" }),
    );
    listByPlugin.mockClear();
    renderHook(() => usePluginEvals(""), {
      wrapper: wrap({ plugineval: { listByPlugin } }),
    });
    expect(listByPlugin).not.toHaveBeenCalled();
  });

  it("lists again while any listed eval is pending or running, and stops once all have finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([], undefined, "pev_2");
    running.status!.phase = PluginEvalPhase.running;
    const listByPlugin = vi
      .fn()
      .mockResolvedValueOnce({ totalCount: 2, items: [running, evalWith([])] })
      .mockResolvedValue({ totalCount: 2, items: [evalWith([], undefined, "pev_2"), evalWith([])] });
    const { result } = renderHook(() => usePluginEvals("plg_1"), {
      wrapper: wrap({ plugineval: { listByPlugin } }),
    });
    await waitFor(() => expect(result.current.evals[0]?.status?.phase).toBe(PluginEvalPhase.running));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS + 10);
    });
    await waitFor(() => expect(result.current.evals[0]?.status?.phase).toBe(PluginEvalPhase.completed));
    const calls = listByPlugin.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS * 3);
    });
    expect(listByPlugin.mock.calls.length, "no list once all finished").toBe(calls);
  });
});

describe("usePluginEval", () => {
  it("reads a running eval again until it has finished, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = PluginEvalPhase.running;
    const done = evalWith([]);
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValue(done);
    const { result } = renderHook(() => usePluginEval("pev_1"), {
      wrapper: wrap({ plugineval: { get } }),
    });
    await waitFor(() =>
      expect(result.current.pluginEval?.status?.phase).toBe(
        PluginEvalPhase.running,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS + 10);
    });
    await waitFor(() =>
      expect(result.current.pluginEval?.status?.phase).toBe(
        PluginEvalPhase.completed,
      ),
    );
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once finished").toBe(calls);
  });

  it.each([
    ["NotFound", new StigmerError("not-found", "plugin eval not found", Code.NotFound)],
    ["PermissionDenied", new StigmerError("permission-denied", "not permitted", Code.PermissionDenied)],
  ])("stops reading a running eval once a read answers %s", async (_, refusal) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = PluginEvalPhase.running;
    const get = vi.fn().mockResolvedValueOnce(running).mockRejectedValue(refusal);
    const { result } = renderHook(() => usePluginEval("pev_1"), {
      wrapper: wrap({ plugineval: { get } }),
    });
    await waitFor(() => expect(result.current.pluginEval).not.toBeNull());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS + 10);
    });
    await waitFor(() => expect(result.current.error).toBe(refusal));
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once refused").toBe(calls);
  });

  it("keeps reading a running eval through a transient failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = PluginEvalPhase.running;
    const get = vi
      .fn()
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new StigmerError("unavailable", "the server is unavailable", Code.Unavailable))
      .mockResolvedValue(running);
    const { result } = renderHook(() => usePluginEval("pev_1"), {
      wrapper: wrap({ plugineval: { get } }),
    });
    await waitFor(() => expect(result.current.pluginEval).not.toBeNull());
    for (let poll = 0; poll < 2; poll++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLUGIN_EVAL_POLL_MS + 10);
      });
    }
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });
});

describe("useStartPluginEval and useCancelPluginEval", () => {
  it("start creates the eval, and a refusal is kept as the error", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(evalWith([]))
      .mockRejectedValueOnce(new Error("the plugin has no evals/ cases"));
    const { result } = renderHook(() => useStartPluginEval(), {
      wrapper: wrap({ plugineval: { create } }),
    });
    const input = {
      name: "",
      org: "acme",
      pluginId: "plg_1",
      maxCostUsd: 5,
    };
    await act(async () => {
      await result.current.start(input);
    });
    expect(create).toHaveBeenCalledWith(input);
    await act(async () => {
      await expect(result.current.start(input)).rejects.toThrow(
        "no evals/ cases",
      );
    });
    expect(result.current.error?.message).toBe(
      "the plugin has no evals/ cases",
    );
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("cancel cancels by id", async () => {
    const cancel = vi.fn(async () => evalWith([]));
    const { result } = renderHook(() => useCancelPluginEval(), {
      wrapper: wrap({ plugineval: { cancel } }),
    });
    await act(async () => {
      await result.current.cancel("pev_1");
    });
    expect(cancel).toHaveBeenCalledWith("pev_1");
    expect(result.current.error).toBeNull();
  });

  it("cancel keeps a refusal as the error, and the next cancel clears it", async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("only the plugin's editors may cancel"))
      .mockResolvedValueOnce(evalWith([]));
    const { result } = renderHook(() => useCancelPluginEval(), {
      wrapper: wrap({ plugineval: { cancel } }),
    });
    await act(async () => {
      await expect(result.current.cancel("pev_1")).rejects.toThrow(
        "only the plugin's editors may cancel",
      );
    });
    expect(result.current.error?.message).toBe(
      "only the plugin's editors may cancel",
    );
    expect(result.current.isCancelling).toBe(false);
    await act(async () => {
      await result.current.cancel("pev_1");
    });
    expect(result.current.error).toBeNull();
  });
});
