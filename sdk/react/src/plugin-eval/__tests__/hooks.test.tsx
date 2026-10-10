/**
 * Pins the plugin-eval hooks: the list asks `listByPlugin` for the plugin
 * and skips an empty id; one eval is read again while it runs and no more
 * once it has finished; start and cancel call the client and keep a
 * refusal as their error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
      name: "thermos evals",
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
});
