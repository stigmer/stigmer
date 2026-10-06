/**
 * Pins useWorkflowDashboardSummary: the organization's run summary over
 * the last seven days by default, scoped to one workflow only when a
 * workflow id is given, over the window the caller names; without an
 * organization it asks nothing and the summary is null.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SummaryTimeWindow } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useWorkflowDashboardSummary } from "../useWorkflowDashboardSummary";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useWorkflowDashboardSummary", () => {
  it("summarizes the organization's runs over the last seven days by default", async () => {
    const summary = { activeCount: 3 };
    const getRunSummary = vi.fn().mockResolvedValue(summary);
    const { result } = renderHook(() => useWorkflowDashboardSummary({ org: "org_acme" }), {
      wrapper: wrapper({ workflowRun: { getRunSummary } }),
    });

    await waitFor(() => expect(result.current.summary).toBe(summary));
    const req = getRunSummary.mock.calls[0]![0];
    expect(req).toMatchObject({ org: "org_acme", timeWindow: SummaryTimeWindow.LAST_7D, workflowId: "" });
  });

  it("scopes the summary to one workflow over the named window", async () => {
    const getRunSummary = vi.fn().mockResolvedValue({ activeCount: 0 });
    const { result } = renderHook(
      () =>
        useWorkflowDashboardSummary({
          org: "org_acme",
          workflowId: "wfl_1",
          timeWindow: SummaryTimeWindow.LAST_30D,
        }),
      { wrapper: wrapper({ workflowRun: { getRunSummary } }) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getRunSummary.mock.calls[0]![0]).toMatchObject({
      org: "org_acme",
      workflowId: "wfl_1",
      timeWindow: SummaryTimeWindow.LAST_30D,
    });
  });

  it("asks nothing without an organization", () => {
    const getRunSummary = vi.fn();
    const { result } = renderHook(() => useWorkflowDashboardSummary({ org: "" }), {
      wrapper: wrapper({ workflowRun: { getRunSummary } }),
    });
    expect(getRunSummary).not.toHaveBeenCalled();
    expect(result.current.summary).toBeNull();
  });
});
