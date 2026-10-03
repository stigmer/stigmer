/**
 * Pins the web workflow-execution page's wiring: the viewer is keyed on the
 * execution id, so switching executions remounts it and all per-execution
 * state resets; the header mounts the execution's access dialog in the
 * active organization; the org falls back to the active one; and an
 * agent-call drill-down resolves to its session and opens it. The viewer is
 * pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

interface ViewerProps {
  executionId: string;
  org?: string;
  nodesDraggable?: boolean;
  headerActions?: ReactNode;
  onNavigateToAgentExecution: (agentExecutionId: string) => void;
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
    WorkflowExecutionViewer: (props: ViewerProps) => {
      page.viewer.push(props);
      // A state initializer runs once per mount: the remount probe.
      useState(() => page.mounts.push(props.executionId));
      return <>{props.headerActions}</>;
    },
    ManageAccessButton: (props: Record<string, unknown>) => {
      page.access.push(props);
      return null;
    },
    useActiveOrgSlug: () => "acme",
    useActiveOrgId: () => "org_acme",
    useResolveAgentExecutionSession: (id: string | null) => ({
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

import { WorkflowExecutionDetailPage } from "../WorkflowExecutionDetailPage";

beforeEach(() => {
  page.mounts.length = 0;
  page.viewer.length = 0;
  page.access.length = 0;
  page.sessions.length = 0;
  page.sessionFor.clear();
});

describe("web WorkflowExecutionDetailPage", () => {
  it("shows the execution in the active org, with that execution's access dialog", () => {
    render(<WorkflowExecutionDetailPage executionId="wfe_1" />);

    expect(page.viewer.at(-1)).toMatchObject({ executionId: "wfe_1", org: "acme", nodesDraggable: true });
    expect(page.access.at(-1)?.resource).toEqual({
      kind: ApiResourceKind.workflow_execution,
      kindString: "workflow_execution",
      id: "wfe_1",
      org: "org_acme",
    });
  });

  it("prefers the org it is given over the active one", () => {
    render(<WorkflowExecutionDetailPage executionId="wfe_1" org="other" />);

    expect(page.viewer.at(-1)?.org).toBe("other");
  });

  it("remounts the viewer when the execution changes", () => {
    const view = render(<WorkflowExecutionDetailPage executionId="wfe_1" />);

    view.rerender(<WorkflowExecutionDetailPage executionId="wfe_2" />);

    expect(page.mounts).toEqual(["wfe_1", "wfe_2"]);
  });

  it("opens the session behind an agent-call drill-down once it resolves", () => {
    page.sessionFor.set("aex_7", "ses_7");
    render(<WorkflowExecutionDetailPage executionId="wfe_1" />);

    act(() => page.viewer.at(-1)?.onNavigateToAgentExecution("aex_7"));

    expect(page.sessions).toEqual(["ses_7"]);
  });
});
