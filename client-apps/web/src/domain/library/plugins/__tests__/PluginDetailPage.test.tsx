/**
 * Pins the web plugin page's seams around the SDK's PluginDetailView: an
 * eval try's run opens through run navigation, "Open agent" (after the
 * plugin was added to one) opens that agent as a library detail, and
 * "Start a chat" opens the launcher with the plugin on. The detail
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
  onAgentClick: (ref: Ref) => void;
  onStartChat: (ref: Ref) => void;
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

  it("opens the agent the plugin was added to as a library detail, and Start a chat on the launcher with the plugin", () => {
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    act(() => view().onAgentClick({ org: "shared", slug: "linked" }));
    act(() => view().onStartChat({ org: "acme", slug: "thermos" }));

    expect(page.openedDetails).toEqual([["agents", "shared", "linked"]]);
    expect(page.pushed).toEqual(["/?plugin=acme%2Fthermos"]);
  });
});
