/**
 * Pins the web routine page's seams around the SDK's RoutineDetailView: a
 * run picked on the routine opens through run navigation, the agent it
 * targets opens as a library detail, a deleted routine lands on the
 * routines list, the loaded routine names the breadcrumb, and a `?tab=`
 * deep link picks the first tab. The detail view itself is pinned in
 * @stigmer/react-sdk; here it is stubbed to capture its props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";

interface ViewProps {
  org: string;
  slug: string;
  activeTab: string;
  onResourceLoad: (routine: Routine) => void;
  onNavigateToAgent: (org: string, slug: string) => void;
  onNavigateToRun: (id: string) => void;
  onDeleted: () => void;
  onRenamed?: (routine: Routine) => void;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  labels: [] as Array<string | null>,
  openedRuns: [] as string[],
  openedDetails: [] as Array<[string, string, string]>,
  pushed: [] as string[],
  canonical: [] as string[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  RoutineDetailView: (props: ViewProps) => {
    page.view.push(props);
    return null;
  },
  useBreadcrumbOverride: () => ({ setLabel: (label: string | null) => page.labels.push(label) }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
  // The static export prerenders one placeholder page; the address names the routine.
  useParams: () => ({ org: "__placeholder__", slug: "__placeholder__" }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: (type: string, org: string, slug: string) =>
      page.openedDetails.push([type, org, slug]),
    canonicalSlug: (slug: string) => page.canonical.push(slug),
  }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

import { RoutineDetailPage, RoutineDetailPageInner } from "../RoutineDetailPage";

function view(): ViewProps | undefined {
  return page.view.at(-1);
}

beforeEach(() => {
  page.view.length = 0;
  page.labels.length = 0;
  page.openedRuns.length = 0;
  page.openedDetails.length = 0;
  page.pushed.length = 0;
  page.canonical.length = 0;
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("web RoutineDetailPageInner", () => {
  it("shows the routine where it lives, on the overview tab by default", () => {
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    expect(view()).toMatchObject({ org: "acme", slug: "nightly", activeTab: "overview" });
  });

  it("lands on the tab a ?tab= deep link names", () => {
    window.history.replaceState(null, "", "/library/routines/acme/nightly?tab=history");
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    expect(view()?.activeTab).toBe("history");
  });

  it("opens a run picked on the routine through run navigation", () => {
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onNavigateToRun("run_1"));

    expect(page.openedRuns).toEqual(["run_1"]);
  });

  it("opens the targeted agent as a library detail and lands on the list after a delete", () => {
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onNavigateToAgent("acme", "digest-bot"));
    act(() => view()?.onDeleted());

    expect(page.openedDetails).toEqual([["agents", "acme", "digest-bot"]]);
    expect(page.pushed).toEqual(["/library/routines"]);
  });

  it("names the breadcrumb after the loaded routine, falling back to its slug", () => {
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onResourceLoad({ metadata: { name: "Nightly digest" } } as Routine));
    act(() => view()?.onResourceLoad({ metadata: { name: "", slug: "nightly" } } as Routine));

    expect(page.labels.slice(-2)).toEqual(["Nightly digest", "nightly"]);
  });

  it("moves the address to the slug the routine answers to now, and to the one a rename gave it", () => {
    render(<RoutineDetailPageInner org="acme" slug="nightly" />);

    act(() => view()?.onResourceLoad({ metadata: { name: "Nightly", slug: "nightly-digest" } } as Routine));
    act(() => view()?.onRenamed?.({ metadata: { name: "Nightly", slug: "digest" } } as Routine));

    expect(page.canonical).toEqual(["nightly-digest", "digest"]);
  });

  it("reads the routine from the address the static export serves", () => {
    window.history.replaceState(null, "", "/library/routines/acme/nightly");
    render(<RoutineDetailPage />);
    expect([view()?.org, view()?.slug]).toEqual(["acme", "nightly"]);
  });
});
