/**
 * Pins the web plugin page's seams around the SDK's PluginDetailView: an
 * eval try's run opens through run navigation, a member the plugin
 * installed (a skill, an MCP server, an agent) opens as a library detail,
 * and "Start session" opens the launcher on the plugin's agent. The detail
 * view itself is pinned in @stigmer/react; here it is stubbed to capture
 * its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

interface Ref {
  org: string;
  slug: string;
}

interface ViewProps {
  org: string;
  slug: string;
  onNavigateToRun: (runId: string) => void;
  onSkillClick: (ref: Ref) => void;
  onMcpServerClick: (ref: Ref) => void;
  onAgentClick: (ref: Ref) => void;
  onStartSession: (ref: Ref) => void;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  openedRuns: [] as string[],
  openedDetails: [] as Array<[string, string, string]>,
  pushed: [] as string[],
}));

vi.mock("@stigmer/react", () => {
  const noop = () => undefined;
  return {
    PluginDetailView: (props: ViewProps) => {
      page.view.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
    useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    // The create-from-tools gate (its own suite pins both answers).
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => ({ allowed: true, isLoading: false }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: (type: string, org: string, slug: string) =>
      page.openedDetails.push([type, org, slug]),
  }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

import { PluginDetailPageInner } from "../PluginDetailPage";

function view(): ViewProps {
  const props = page.view.at(-1);
  expect(props, "PluginDetailView was never rendered").toBeDefined();
  return props!;
}

beforeEach(() => {
  page.view.length = 0;
  page.openedRuns.length = 0;
  page.openedDetails.length = 0;
  page.pushed.length = 0;
});

describe("web PluginDetailPageInner", () => {
  it("shows the plugin where it lives", () => {
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    expect(view()).toMatchObject({ org: "acme", slug: "thermos" });
  });

  it("opens an eval try's run through run navigation", () => {
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    act(() => view().onNavigateToRun("run_1"));

    expect(page.openedRuns).toEqual(["run_1"]);
    expect(page.pushed).toEqual([]);
  });

  it("opens each installed member as a library detail, and Start session on the launcher", () => {
    render(<PluginDetailPageInner org="acme" slug="thermos" />);
    const ref = { org: "shared", slug: "linked" };

    act(() => view().onSkillClick(ref));
    act(() => view().onMcpServerClick(ref));
    act(() => view().onAgentClick(ref));
    act(() => view().onStartSession({ org: "acme", slug: "thermos-agent" }));

    expect(page.openedDetails).toEqual([
      ["skills", "shared", "linked"],
      ["mcp-servers", "shared", "linked"],
      ["agents", "shared", "linked"],
    ]);
    expect(page.pushed).toEqual(["/?agent=acme%2Fthermos-agent"]);
  });
});
