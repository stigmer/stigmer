/**
 * Pins where a workflow's run visibility lives on the workflow page: it
 * rides into the Manage access dialog as the workflow's own section,
 * offered only when the viewer holds `can_manage_audience` on the workflow
 * (the server's bar on `updateExecutionVisibility`), and reads the level
 * from the workflow's spec. Also pins the page's tabs: no tab lists
 * per-workflow configuration objects any more.
 *
 * The shell, the dialog and the data hooks are stubbed; the assertions are
 * about what the view hands them.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { AccessExtraSection } from "../../access/types";
import type { TabItem } from "../../tabs/Tabs";
import { WorkflowDetailView } from "../WorkflowDetailView";

const state = vi.hoisted(() => ({
  canManageAudience: false,
  permissionAsks: [] as Array<{ resource: unknown; relation: string }>,
  extraSections: [] as Array<AccessExtraSection | undefined>,
  tabs: [] as readonly TabItem[],
  // WorkflowExecutionVisibility.private; the enum is not reachable from a hoisted block.
  executionVisibility: 1,
}));

vi.mock("../useWorkflow", () => ({
  useWorkflow: () => ({
    workflow: {
      metadata: { id: "wf_1", name: "Nightly triage", slug: "nightly-triage", org: "org_acme" },
      spec: { executionVisibility: state.executionVisibility, tasks: [] },
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
  useCheckPermission: (resource: unknown, relation: string) => {
    state.permissionAsks.push({ resource, relation });
    return { allowed: state.canManageAudience, isLoading: false, error: null };
  },
}));
vi.mock("../../access/useManageAccess", () => ({
  useManageAccess: (args: { extraSection?: AccessExtraSection }) => {
    state.extraSections.push(args.extraSection);
    return { action: null, dialog: null, open: vi.fn(), isOpen: false };
  },
}));
vi.mock("../../resource-detail/ResourceDetailShell", () => ({
  ResourceDetailShell: ({ tabs }: { tabs: readonly TabItem[]; children?: ReactNode }) => {
    state.tabs = tabs;
    return null;
  },
}));

afterEach(() => {
  cleanup();
  state.canManageAudience = false;
  state.permissionAsks = [];
  state.extraSections = [];
  state.tabs = [];
  state.executionVisibility = WorkflowExecutionVisibility.private;
});

function lastSection(): AccessExtraSection | undefined {
  return state.extraSections[state.extraSections.length - 1];
}

describe("WorkflowDetailView run visibility", () => {
  it("asks can_manage_audience on the workflow", () => {
    render(<WorkflowDetailView org="org_acme" slug="nightly-triage" />);

    expect(state.permissionAsks).toContainEqual({
      resource: { kind: "workflow", id: "wf_1" },
      relation: "can_manage_audience",
    });
  });

  it("offers the run visibility section to someone who may change the workflow's audience", () => {
    state.canManageAudience = true;
    state.executionVisibility = WorkflowExecutionVisibility.organization;
    render(<WorkflowDetailView org="org_acme" slug="nightly-triage" />);

    const section = lastSection();
    expect(section?.title).toBe("Run visibility");
    expect(section?.description).toContain("past runs included");
    const control = section?.content as { props: Record<string, unknown> };
    expect(control.props.workflowId).toBe("wf_1");
    expect(control.props.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
  });

  it("offers no run visibility section to anyone else", () => {
    state.canManageAudience = false;
    render(<WorkflowDetailView org="org_acme" slug="nightly-triage" />);

    expect(lastSection()).toBeUndefined();
  });

  it("shows the overview, executions and versions tabs only", () => {
    render(<WorkflowDetailView org="org_acme" slug="nightly-triage" />);

    expect(state.tabs.map((t) => t.id)).toEqual(["overview", "executions", "versions"]);
  });
});
