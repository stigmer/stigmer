/**
 * Pins the web plugin page's seams around the SDK's PluginDetailView: an
 * eval try's run opens through run navigation, "Open agent" (after the
 * plugin was added to one) opens that agent as a library detail, and
 * "Start a chat" opens the launcher with the plugin on. Remove asks
 * first, deletes once confirmed and returns to the plugins list; a failed
 * delete stays on the page (the delete hook shows its own error), and a
 * declined one deletes nothing. The detail view itself is pinned in
 * @stigmer/react; here it is stubbed to capture its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { DetailAction } from "@stigmer/react";

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
  actions: DetailAction[];
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  openedRuns: [] as string[],
  openedDetails: [] as Array<[string, string, string]>,
  pushed: [] as string[],
  confirms: [] as Array<{ title: string; description: string }>,
  confirmAnswer: true,
  deletes: 0,
  deleteFails: false,
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
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return page.confirmAnswer;
      },
      handleConfirm: noop,
      handleCancel: noop,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => {
        page.deletes += 1;
        if (page.deleteFails) throw new Error("refused");
      },
      isDeleting: false,
    }),
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
  page.confirms.length = 0;
  page.confirmAnswer = true;
  page.deletes = 0;
  page.deleteFails = false;
});

async function removePlugin(): Promise<void> {
  const remove = view().actions.find((action) => action.id === "remove");
  expect(remove, "no Remove action").toBeDefined();
  await act(async () => {
    // onAction is typed void; the page's handler returns its promise.
    await Promise.resolve(remove!.onAction());
  });
}

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

describe("web PluginDetailPageInner Remove", () => {
  it("asks first, deletes once confirmed, and returns to the plugins list", async () => {
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    await removePlugin();

    expect(page.confirms[0]).toMatchObject({ title: "Remove Plugin?" });
    expect(page.confirms[0]!.description).toMatch(/^Removes the plugin and its versions\./);
    expect(page.deletes).toBe(1);
    expect(page.pushed).toEqual(["/library/plugins"]);
  });

  it("stays on the page when the delete fails", async () => {
    page.deleteFails = true;
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    await removePlugin();

    expect(page.deletes).toBe(1);
    expect(page.pushed).toEqual([]);
  });

  it("deletes nothing when the person declines", async () => {
    page.confirmAnswer = false;
    render(<PluginDetailPageInner org="acme" slug="thermos" />);

    await removePlugin();

    expect(page.deletes).toBe(0);
    expect(page.pushed).toEqual([]);
  });
});
