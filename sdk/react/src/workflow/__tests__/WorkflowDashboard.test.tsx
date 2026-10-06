/**
 * Pins WorkflowDashboard's wiring over a fake client: the summary widget
 * reads the organization's run summary, the approvals widget its pending
 * approvals, and the failures widget the organization's five most recent
 * failed runs (`workflowRun.list` with phase RUN_FAILED); each widget's
 * click hands the host the run's id. Without an organization nothing is
 * asked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { WorkflowDashboard } from "../WorkflowDashboard";

afterEach(cleanup);

function fakeClient() {
  return {
    workflowRun: {
      getRunSummary: vi.fn().mockResolvedValue({
        activeCount: 4,
        phaseCounts: { [RunPhase.RUN_FAILED]: 1 },
      }),
      listPendingApprovals: vi.fn().mockResolvedValue({
        entries: [{ runId: "wfr_wait", workflowName: "Article Pipeline", taskName: "reviewDraft" }],
        totalCount: 1,
      }),
      list: vi.fn().mockResolvedValue({
        entries: [{ metadata: { id: "wfr_bad", name: "nightly-report" }, status: { error: "boom" } }],
      }),
    },
  };
}

function Providers({ client, children }: { client: unknown; children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

describe("WorkflowDashboard", () => {
  it("shows the organization's summary, pending approvals and recent failed runs", async () => {
    const client = fakeClient();
    const onApprovalClick = vi.fn();
    const onFailedRunClick = vi.fn();
    render(
      <Providers client={client}>
        <WorkflowDashboard
          org="org_acme"
          onApprovalClick={onApprovalClick}
          onFailedRunClick={onFailedRunClick}
        />
      </Providers>,
    );

    expect(await screen.findByText("nightly-report")).toBeTruthy();
    expect(await screen.findByText("Article Pipeline")).toBeTruthy();
    expect(await screen.findByText("Failed: 1")).toBeTruthy();

    expect(client.workflowRun.list.mock.calls[0]![0]).toMatchObject({
      org: "org_acme",
      pageSize: 5,
      phase: RunPhase.RUN_FAILED,
    });
    expect(client.workflowRun.getRunSummary.mock.calls[0]![0]).toMatchObject({ org: "org_acme" });
    expect(client.workflowRun.listPendingApprovals.mock.calls[0]![0]).toMatchObject({ org: "org_acme" });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onFailedRunClick).toHaveBeenCalledWith("wfr_bad");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onApprovalClick).toHaveBeenCalledWith("wfr_wait");
  });

  it("asks nothing without an organization", () => {
    const client = fakeClient();
    render(
      <Providers client={client}>
        <WorkflowDashboard org={null} />
      </Providers>,
    );

    expect(screen.getByRole("region", { name: "Workflow dashboard" })).toBeTruthy();
    expect(screen.getByText("No recent failures")).toBeTruthy();
    expect(client.workflowRun.list).not.toHaveBeenCalled();
    expect(client.workflowRun.getRunSummary).not.toHaveBeenCalled();
    expect(client.workflowRun.listPendingApprovals).not.toHaveBeenCalled();
  });
});
