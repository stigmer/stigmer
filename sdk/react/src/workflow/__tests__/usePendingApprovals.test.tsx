/**
 * Pins usePendingApprovals: it asks the organization's pending approvals
 * with the page size (20 by default) and returns the entries and the
 * server's total; without an organization it asks nothing and returns the
 * empty initial state.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { usePendingApprovals } from "../usePendingApprovals";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("usePendingApprovals", () => {
  it("lists the organization's pending approvals with their total", async () => {
    const listPendingApprovals = vi.fn().mockResolvedValue({
      entries: [{ runId: "wfr_1", taskName: "review" }],
      totalCount: 7,
    });
    const { result } = renderHook(
      () => usePendingApprovals({ org: "org_acme", pageSize: 5, refetchInterval: false }),
      { wrapper: wrapper({ workflowRun: { listPendingApprovals } }) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listPendingApprovals.mock.calls[0]![0]).toMatchObject({ org: "org_acme", pageSize: 5 });
    expect(result.current.approvals.map((a) => a.runId)).toEqual(["wfr_1"]);
    expect(result.current.totalCount).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it("asks with a page of twenty by default", async () => {
    const listPendingApprovals = vi.fn().mockResolvedValue({ entries: [], totalCount: 0 });
    const { result } = renderHook(() => usePendingApprovals({ org: "org_acme" }), {
      wrapper: wrapper({ workflowRun: { listPendingApprovals } }),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listPendingApprovals.mock.calls[0]![0]).toMatchObject({ pageSize: 20 });
  });

  it("asks nothing without an organization", () => {
    const listPendingApprovals = vi.fn();
    const { result } = renderHook(() => usePendingApprovals({ org: null }), {
      wrapper: wrapper({ workflowRun: { listPendingApprovals } }),
    });
    expect(listPendingApprovals).not.toHaveBeenCalled();
    expect(result.current.approvals).toEqual([]);
    expect(result.current.totalCount).toBe(0);
  });
});
