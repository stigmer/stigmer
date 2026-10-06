/**
 * Pins the workflow page's run surfaces: the Runs tab mounts the run
 * history for the workflow's id and the host's run handler, and the
 * Overview tab reads the workflow's latest run (one run, by workflow id)
 * and offers "View latest run", routed to `onViewLatestRun` when the host
 * gives one and to `onRunClick` otherwise.
 *
 * The shell renders its body; the data hooks and the run history are
 * stubbed, so the assertions are about what the view asks and hands on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkflowDetailView } from "../WorkflowDetailView";
import { useWorkflowRunList } from "../useWorkflowRunList";

const state = vi.hoisted(() => ({
  historyProps: null as Record<string, unknown> | null,
}));

vi.mock("../useWorkflow", () => ({
  useWorkflow: () => ({
    workflow: {
      metadata: { id: "wf_1", name: "Nightly triage", slug: "nightly-triage", org: "org_acme" },
      spec: { tasks: [] },
      status: {},
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("../useUpdateWorkflow", () => ({
  useUpdateWorkflow: () => ({ update: vi.fn(), isUpdating: false }),
}));
vi.mock("../useWorkflowVersions", () => ({
  useWorkflowVersions: () => ({ versions: [] }),
}));
vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: () => ({ allowed: false, isLoading: false, error: null }),
}));
vi.mock("../../access/useManageAccess", () => ({
  useManageAccess: () => ({ action: null, dialog: null, open: vi.fn(), isOpen: false }),
}));
vi.mock("../../resource-detail/ResourceDetailShell", () => ({
  ResourceDetailShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../useWorkflowDashboardSummary", () => ({
  useWorkflowDashboardSummary: () => ({
    summary: null,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("../useWorkflowRunList", () => ({
  useWorkflowRunList: vi.fn(() => ({ runs: [{ metadata: { id: "wfr_latest" } }] })),
}));
vi.mock("../run-history/WorkflowRunHistory", () => ({
  WorkflowRunHistory: (props: Record<string, unknown>) => {
    state.historyProps = props;
    return <div data-testid="run-history-stub" />;
  },
}));
vi.mock("../WorkflowExplainDialog", () => ({
  WorkflowExplainDialog: () => null,
}));

afterEach(() => {
  cleanup();
  state.historyProps = null;
});

describe("WorkflowDetailView run surfaces", () => {
  it("mounts the workflow's run history on the Runs tab with the host's run handler", () => {
    const onRunClick = vi.fn();
    render(
      <WorkflowDetailView
        org="org_acme"
        slug="nightly-triage"
        defaultTab="runs"
        onRunClick={onRunClick}
      />,
    );

    expect(screen.getByTestId("run-history-stub")).toBeTruthy();
    expect(state.historyProps).toMatchObject({
      org: "org_acme",
      workflowId: "wf_1",
      onRunClick,
    });
  });

  it("reads the latest run and routes View latest run to onRunClick when no latest-run handler is given", () => {
    const onRunClick = vi.fn();
    render(
      <WorkflowDetailView org="org_acme" slug="nightly-triage" onRunClick={onRunClick} />,
    );

    expect(vi.mocked(useWorkflowRunList)).toHaveBeenCalledWith({
      workflowId: "wf_1",
      pageSize: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: /View latest run/ }));
    expect(onRunClick).toHaveBeenCalledWith("wfr_latest");
  });

  it("prefers onViewLatestRun over onRunClick for the latest run", () => {
    const onRunClick = vi.fn();
    const onViewLatestRun = vi.fn();
    render(
      <WorkflowDetailView
        org="org_acme"
        slug="nightly-triage"
        onRunClick={onRunClick}
        onViewLatestRun={onViewLatestRun}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /View latest run/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onViewLatestRun).toHaveBeenCalledWith("wfr_latest");
    expect(onRunClick).not.toHaveBeenCalled();
  });
});
