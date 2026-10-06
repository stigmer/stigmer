/**
 * Pins the web schedule page's seams around the SDK's ScheduleDetailView: a
 * run picked on the schedule opens through run navigation, the agent it
 * targets opens as a library detail, a deleted schedule lands on the
 * schedules list, the loaded schedule names the breadcrumb, and a `?tab=`
 * deep link picks the first tab. The detail view itself is pinned in
 * @stigmer/react; here it is stubbed to capture its props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";

interface ViewProps {
  org: string;
  slug: string;
  activeTab: string;
  onResourceLoad: (schedule: Schedule) => void;
  onNavigateToAgent: (org: string, slug: string) => void;
  onNavigateToRun: (id: string) => void;
  onDeleted: () => void;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  labels: [] as Array<string | null>,
  openedRuns: [] as string[],
  openedDetails: [] as Array<[string, string, string]>,
  pushed: [] as string[],
}));

vi.mock("@stigmer/react", () => ({
  ScheduleDetailView: (props: ViewProps) => {
    page.view.push(props);
    return null;
  },
  useBreadcrumbOverride: () => ({ setLabel: (label: string | null) => page.labels.push(label) }),
}));

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

vi.mock("@/domain/workflow/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

import { ScheduleDetailPageInner } from "../ScheduleDetailPage";

function view(): ViewProps | undefined {
  return page.view.at(-1);
}

beforeEach(() => {
  page.view.length = 0;
  page.labels.length = 0;
  page.openedRuns.length = 0;
  page.openedDetails.length = 0;
  page.pushed.length = 0;
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("web ScheduleDetailPageInner", () => {
  it("shows the schedule where it lives, on the overview tab by default", () => {
    render(<ScheduleDetailPageInner org="acme" slug="nightly" />);

    expect(view()).toMatchObject({ org: "acme", slug: "nightly", activeTab: "overview" });
  });

  it("lands on the tab a ?tab= deep link names", () => {
    window.history.replaceState(null, "", "/library/schedules/acme/nightly?tab=runs");
    render(<ScheduleDetailPageInner org="acme" slug="nightly" />);

    expect(view()?.activeTab).toBe("runs");
  });

  it("opens a run picked on the schedule through run navigation", () => {
    render(<ScheduleDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onNavigateToRun("wfr_1"));

    expect(page.openedRuns).toEqual(["wfr_1"]);
  });

  it("opens the targeted agent as a library detail and lands on the list after a delete", () => {
    render(<ScheduleDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onNavigateToAgent("acme", "digest-bot"));
    act(() => view()?.onDeleted());

    expect(page.openedDetails).toEqual([["agents", "acme", "digest-bot"]]);
    expect(page.pushed).toEqual(["/library/schedules"]);
  });

  it("names the breadcrumb after the loaded schedule, falling back to its slug", () => {
    render(<ScheduleDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onResourceLoad({ metadata: { name: "Nightly digest" } } as Schedule));
    act(() => view()?.onResourceLoad({ metadata: { name: "", slug: "nightly" } } as Schedule));

    expect(page.labels.slice(-2)).toEqual(["Nightly digest", "nightly"]);
  });
});
