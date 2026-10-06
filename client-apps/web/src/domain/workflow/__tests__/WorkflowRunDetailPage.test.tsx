/**
 * Pins the web workflow-execution page's wiring: the viewer is keyed on the
 * run id, so switching runs remounts it and all per-execution
 * state resets; the header mounts the run's access dialog in the
 * active organization; the org falls back to the active one; an
 * agent-call drill-down resolves to its session and opens it; and "open in
 * editor" loads the workflow's library page under its org's slug. The
 * viewer is pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
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
  sessions: [] as string[],
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
    useResolveAgentRunSession: (id: string | null) => ({
      sessionId: id ? page.sessionFor.get(id) : undefined,
      isLoading: false,
    }),
  };
});

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({
    navigateToSession: (id: string) => page.sessions.push(id),
  }),
}));

import { WorkflowRunDetailPage } from "../WorkflowRunDetailPage";

beforeEach(() => {
  page.mounts.length = 0;
  page.viewer.length = 0;
  page.access.length = 0;
  page.sessions.length = 0;
  page.sessionFor.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web WorkflowRunDetailPage", () => {
  it("shows the execution in the active org, with that execution's access dialog", () => {
    render(<WorkflowRunDetailPage executionId="wfe_1" />);

    expect(page.viewer.at(-1)).toMatchObject({ runId: "wfe_1", org: "org_acme", nodesDraggable: true });
    expect(page.access.at(-1)?.resource).toEqual({
      kind: ApiResourceKind.workflow_run,
      kindString: "workflow_run",
      id: "wfe_1",
      org: "org_acme",
    });
  });

  it("prefers the org it is given over the active one", () => {
    render(<WorkflowRunDetailPage executionId="wfe_1" org="other" />);

    expect(page.viewer.at(-1)?.org).toBe("other");
  });

  it("remounts the viewer when the execution changes", () => {
    const view = render(<WorkflowRunDetailPage executionId="wfe_1" />);

    view.rerender(<WorkflowRunDetailPage executionId="wfe_2" />);

    expect(page.mounts).toEqual(["wfe_1", "wfe_2"]);
  });

  it("opens the session behind an agent-call drill-down once it resolves", () => {
    page.sessionFor.set("aex_7", "ses_7");
    render(<WorkflowRunDetailPage executionId="wfe_1" />);

    act(() => page.viewer.at(-1)?.onNavigateToAgentRun("aex_7"));

    expect(page.sessions).toEqual(["ses_7"]);
  });

  it("opens the workflow editor under the org's slug, not its id", () => {
    const location = { href: "" } as Location;
    vi.spyOn(window, "location", "get").mockReturnValue(location);
    render(<WorkflowRunDetailPage executionId="wfe_1" />);

    act(() => page.viewer.at(-1)?.onNavigateToWorkflowEditor("document: {}", "nightly"));

    expect(location.href).toBe("/library/workflows/acme/nightly");
  });
});
