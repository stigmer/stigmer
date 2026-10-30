/**
 * Pins the eval run hooks: the list asks `listByAgent` for an agent and
 * `listByPlugin` for a plugin and skips an empty id, and lists again while
 * an eval run on its first page is pending or running, no more once all
 * there have finished (an older page loaded with Load more, which a poll
 * does not refresh, starts none); one eval run is read again while it runs
 * and no more once it has finished, nor once a read answers NotFound or
 * PermissionDenied, while a transient failure keeps the polling; start and
 * cancel call the client and keep a refusal as their error, which
 * clearError or the next call resets; an organization's Evals are listed
 * through `eval.list`, page by page, and an empty organization asks
 * nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useCancelEvalRun } from "../useCancelEvalRun";
import { EVAL_RUN_POLL_MS, useEvalRun } from "../useEvalRun";
import { useEvalRuns } from "../useEvalRuns";
import { useEvals } from "../useEvals";
import { useStartEvalRun } from "../useStartEvalRun";
import { evalWith } from "./eval-fixture";
import { agentEvalRunWith } from "./eval-fixture.agent";

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

describe("useEvalRuns", () => {
  it("lists the eval runs about a plugin, and asks nothing for an empty id", async () => {
    const listByPlugin = vi.fn(async () => ({ entries: [evalWith([])], nextPageToken: "" }));
    const { result } = renderHook(() => useEvalRuns({ pluginId: "plg_1" }), {
      wrapper: wrap({ evalrun: { listByPlugin } }),
    });
    await waitFor(() => expect(result.current.evalRuns).toHaveLength(1));
    expect(listByPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "plg_1" }),
    );
    listByPlugin.mockClear();
    renderHook(() => useEvalRuns({ pluginId: "" }), {
      wrapper: wrap({ evalrun: { listByPlugin } }),
    });
    expect(listByPlugin).not.toHaveBeenCalled();
  });

  it("lists an agent's eval runs through listByAgent, and asks nothing for an empty id", async () => {
    const listByAgent = vi.fn(async () => ({ entries: [agentEvalRunWith([])], nextPageToken: "" }));
    const { result } = renderHook(() => useEvalRuns({ agentId: "agt_1" }), {
      wrapper: wrap({ evalrun: { listByAgent } }),
    });
    await waitFor(() => expect(result.current.evalRuns).toHaveLength(1));
    expect(listByAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agt_1" }));
    listByAgent.mockClear();
    renderHook(() => useEvalRuns({ agentId: "" }), {
      wrapper: wrap({ evalrun: { listByAgent } }),
    });
    expect(listByAgent).not.toHaveBeenCalled();
  });

  it("lists again while any listed eval is pending or running, and stops once all have finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([], undefined, "evr_2");
    running.status!.phase = EvalRunPhase.running;
    const listByPlugin = vi
      .fn()
      .mockResolvedValueOnce({ entries: [running, evalWith([])], nextPageToken: "" })
      .mockResolvedValue({ entries: [evalWith([], undefined, "evr_2"), evalWith([])], nextPageToken: "" });
    const { result } = renderHook(() => useEvalRuns({ pluginId: "plg_1" }), {
      wrapper: wrap({ evalrun: { listByPlugin } }),
    });
    await waitFor(() => expect(result.current.evalRuns[0]?.status?.phase).toBe(EvalRunPhase.running));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 10);
    });
    await waitFor(() => expect(result.current.evalRuns[0]?.status?.phase).toBe(EvalRunPhase.completed));
    const calls = listByPlugin.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 3);
    });
    expect(listByPlugin.mock.calls.length, "no list once all finished").toBe(calls);
  });

  it("polls only for the first page, which is all a poll refreshes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const older = evalWith([], undefined, "evr_old");
    older.status!.phase = EvalRunPhase.running;
    const listByPlugin = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [evalWith([], undefined, "evr_new")], nextPageToken: "page-2" }
        : { entries: [older], nextPageToken: "" },
    );
    const { result } = renderHook(() => useEvalRuns({ pluginId: "plg_1" }), {
      wrapper: wrap({ evalrun: { listByPlugin } }),
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.evalRuns).toHaveLength(2));
    const calls = listByPlugin.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 3);
    });
    expect(listByPlugin.mock.calls.length, "a poll would not refresh the older page").toBe(calls);
  });
});

describe("useEvals", () => {
  it("lists an organization's Evals through eval.list, page by page, and asks nothing for an empty organization", async () => {
    const list = vi.fn(async (input: { pageToken: string }) =>
      input.pageToken === ""
        ? { entries: [{ metadata: { id: "evs_1", slug: "support-evals" } }], nextPageToken: "p2" }
        : { entries: [{ metadata: { id: "evs_2", slug: "refunds" } }], nextPageToken: "" },
    );
    const { result } = renderHook(() => useEvals("org_acme"), {
      wrapper: wrap({ eval: { list } }),
    });
    await waitFor(() => expect(result.current.evals).toHaveLength(1));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ org: "org_acme", pageToken: "" }));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.evals).toHaveLength(2));
    expect(result.current.evals.map((row) => row.metadata?.slug)).toEqual(["support-evals", "refunds"]);
    expect(result.current.hasMore).toBe(false);
    list.mockClear();
    renderHook(() => useEvals(""), { wrapper: wrap({ eval: { list } }) });
    expect(list).not.toHaveBeenCalled();
  });
});

describe("useEvalRun", () => {
  it("reads a running eval again until it has finished, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = EvalRunPhase.running;
    const done = evalWith([]);
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValue(done);
    const { result } = renderHook(() => useEvalRun("evr_1"), {
      wrapper: wrap({ evalrun: { get } }),
    });
    await waitFor(() =>
      expect(result.current.evalRun?.status?.phase).toBe(
        EvalRunPhase.running,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 10);
    });
    await waitFor(() =>
      expect(result.current.evalRun?.status?.phase).toBe(
        EvalRunPhase.completed,
      ),
    );
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once finished").toBe(calls);
  });

  it.each([
    ["NotFound", new StigmerError("not-found", "eval run not found", Code.NotFound)],
    ["PermissionDenied", new StigmerError("permission-denied", "not permitted", Code.PermissionDenied)],
  ])("stops reading a running eval once a read answers %s", async (_, refusal) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = EvalRunPhase.running;
    const get = vi.fn().mockResolvedValueOnce(running).mockRejectedValue(refusal);
    const { result } = renderHook(() => useEvalRun("evr_1"), {
      wrapper: wrap({ evalrun: { get } }),
    });
    await waitFor(() => expect(result.current.evalRun).not.toBeNull());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 10);
    });
    await waitFor(() => expect(result.current.error).toBe(refusal));
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 3);
    });
    expect(get.mock.calls.length, "no read once refused").toBe(calls);
  });

  it("keeps reading a running eval through a transient failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalWith([]);
    running.status!.phase = EvalRunPhase.running;
    const get = vi
      .fn()
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new StigmerError("unavailable", "the server is unavailable", Code.Unavailable))
      .mockResolvedValue(running);
    const { result } = renderHook(() => useEvalRun("evr_1"), {
      wrapper: wrap({ evalrun: { get } }),
    });
    await waitFor(() => expect(result.current.evalRun).not.toBeNull());
    for (let poll = 0; poll < 2; poll++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 10);
      });
    }
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });
});

describe("useStartEvalRun and useCancelEvalRun", () => {
  it("start creates the eval, and a refusal is kept as the error", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(evalWith([]))
      .mockRejectedValueOnce(new Error("the plugin has no evals/ cases"));
    const { result } = renderHook(() => useStartEvalRun(), {
      wrapper: wrap({ evalrun: { create } }),
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
    const { result } = renderHook(() => useCancelEvalRun(), {
      wrapper: wrap({ evalrun: { cancel } }),
    });
    await act(async () => {
      await result.current.cancel("evr_1");
    });
    expect(cancel).toHaveBeenCalledWith("evr_1");
    expect(result.current.error).toBeNull();
  });

  it("cancel keeps a refusal as the error, and the next cancel clears it", async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("only the plugin's editors may cancel"))
      .mockResolvedValueOnce(evalWith([]));
    const { result } = renderHook(() => useCancelEvalRun(), {
      wrapper: wrap({ evalrun: { cancel } }),
    });
    await act(async () => {
      await expect(result.current.cancel("evr_1")).rejects.toThrow(
        "only the plugin's editors may cancel",
      );
    });
    expect(result.current.error?.message).toBe(
      "only the plugin's editors may cancel",
    );
    expect(result.current.isCancelling).toBe(false);
    await act(async () => {
      await result.current.cancel("evr_1");
    });
    expect(result.current.error).toBeNull();
  });
});
