/**
 * Pins useWorkflowExecutionList's branch and continuation: the org-scoped
 * `list()` without a workflow, `listByWorkflow()` with one, the first page
 * starting from the caller's `pageToken`, `loadMore` continuing from the
 * server's token (never the caller's again), and `totalPages` read from the
 * first page as the server sent it. The shared cursor machinery itself is
 * pinned in session/__tests__/useSessionList.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useWorkflowExecutionList } from "../useWorkflowExecutionList";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function page(ids: string[], nextPageToken = "") {
  return {
    entries: ids.map((id) => ({ metadata: { id } })),
    totalPages: nextPageToken === "" ? 1 : 0,
    nextPageToken,
  };
}

describe("useWorkflowExecutionList", () => {
  it("lists one organization's executions and continues from the server's token", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(["wex-3", "wex-2"], "t1"))
      .mockResolvedValueOnce(page(["wex-1"]));
    const listByWorkflow = vi.fn();
    const client = { workflowExecution: { list, listByWorkflow } };

    const { result } = renderHook(
      () => useWorkflowExecutionList({ org: "acme", pageSize: 2, pageToken: "start" }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    expect(result.current.totalPages).toBe(0);
    expect(list.mock.calls[0]![0]).toMatchObject({ org: "acme", pageSize: 2, pageToken: "start" });

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));

    expect(list.mock.calls[1]![0]).toMatchObject({ org: "acme", pageToken: "t1" });
    expect(result.current.executions.map((e) => e.metadata?.id)).toEqual(["wex-3", "wex-2", "wex-1"]);
    expect(listByWorkflow).not.toHaveBeenCalled();
  });

  it("lists a workflow's executions through listByWorkflow", async () => {
    const list = vi.fn();
    const listByWorkflow = vi.fn().mockResolvedValue(page(["wex-9"]));
    const client = { workflowExecution: { list, listByWorkflow } };

    const { result } = renderHook(() => useWorkflowExecutionList({ workflowId: "wfl_1" }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listByWorkflow.mock.calls[0]![0]).toMatchObject({ workflowId: "wfl_1", pageSize: 20 });
    expect(result.current.executions.map((e) => e.metadata?.id)).toEqual(["wex-9"]);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.hasMore).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
});
