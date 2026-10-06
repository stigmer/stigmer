/**
 * Pins the desktop workflow-execution page's wiring: the viewer is keyed on
 * the run id, so switching runs remounts it and all
 * per-execution state resets; the header mounts the run's access
 * dialog in the active organization; an agent-call drill-down resolves to
 * its session and opens it; and the editor link opens the workflow in the
 * route's org. The viewer is pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

interface ViewerProps {
  runId: string;
  org?: string;
  nodesDraggable?: boolean;
  headerActions?: ReactNode;
  onNavigateToAgentRun: (agentRunId: string) => void;
  onNavigateToWorkflowEditor: (yaml: string, workflowSlug: string) => void;
}

const page = vi.hoisted(() => ({
  mounts: [] as string[],
  viewer: [] as ViewerProps[],
  access: [] as Array<Record<string, unknown>>,
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
}));

vi.mock("@stigmer/react", async () => {
  const { useState } = await import("react");
  return {
    WorkflowRunViewer: (props: ViewerProps) => {
      page.viewer.push(props);
      // A state initializer runs once per mount: the remount probe.
      useState(() => page.mounts.push(props.runId));
      return <>{props.headerActions}</>;
    },
    ManageAccessButton: (props: Record<string, unknown>) => {
      page.access.push(props);
      return null;
    },
    useActiveOrgId: () => "org_acme",
    // The person's organizations: org_acme reads "acme" in a URL.
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useResolveAgentRunSession: (id: string | null) => {
      page.resolving.push(id);
      return { sessionId: id ? page.sessionFor.get(id) : undefined, isLoading: false };
    },
  };
});

import WorkflowRunDetailPage from "../workflow/WorkflowRunDetailPage";

let goTo: (path: string) => void = () => undefined;

function Harness() {
  goTo = useNavigate();
  return <span data-testid="location">{`${useLocation().pathname}${useLocation().search}`}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<WorkflowRunDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Harness />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.mounts.length = 0;
  page.viewer.length = 0;
  page.access.length = 0;
  page.resolving.length = 0;
  page.sessionFor.clear();
});

describe("desktop WorkflowRunDetailPage", () => {
  it("shows the execution its route names, with that execution's access dialog", () => {
    renderAt("/runs/wfe_1?org=acme");

    expect(page.viewer.at(-1)).toMatchObject({ runId: "wfe_1", org: "acme", nodesDraggable: true });
    expect(page.access.at(-1)?.resource).toEqual({
      kind: ApiResourceKind.workflow_run,
      kindString: "workflow_run",
      id: "wfe_1",
      org: "org_acme",
    });
  });

  it("remounts the viewer when the route switches execution", () => {
    renderAt("/runs/wfe_1");

    act(() => goTo("/runs/wfe_2"));

    expect(page.mounts).toEqual(["wfe_1", "wfe_2"]);
  });

  it("opens the session behind an agent-call drill-down once it resolves", () => {
    page.sessionFor.set("aex_7", "ses_7");
    renderAt("/runs/wfe_1");

    act(() => page.viewer.at(-1)?.onNavigateToAgentRun("aex_7"));

    expect(page.resolving).toContain("aex_7");
    expect(screen.getByTestId("location").textContent).toBe("/sessions/ses_7");
  });

  it("opens the workflow editor in the route's org", () => {
    renderAt("/runs/wfe_1?org=acme");

    act(() => page.viewer.at(-1)?.onNavigateToWorkflowEditor("document: {}", "digest"));

    expect(screen.getByTestId("location").textContent).toBe("/library/workflows/acme/digest");
  });
});
