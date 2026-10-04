import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import LibraryLayout from "../LibraryLayout";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "../library-navigation";

// These tests pin the zone-overlay mount contract (oss#621):
//
// - LIST children stay mounted-but-hidden under a detail overlay — the
//   deliberate list-state preservation the zone's pushState routing exists
//   to provide.
// - DETAIL children yield to the overlay via
//   useRouteDetailYieldsToOverlay, so a cold deep-load of a detail URL
//   renders the page exactly once: no double data fetching, no second
//   live instance for document-global behavior. (The five route wrappers'
//   use of the hook is pinned end-to-end by
//   test/e2e/tests/interactive/duplicate-dom-ids.spec.ts.)

// The Next pathname is what the router last rendered; the zone's own
// pushState navigation deliberately does not go through it.
let mockPathname = "/library/agents";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// The real detail pages drag the full SDK; markers are enough to count
// mounted instances. The workflow marker additionally requests
// full-viewport through the REAL hook to pin the layout's behavior when
// the overlay drives that shared flag.
// How many times the agent detail view mounted: a remount refetches and
// drops any edit in progress.
let agentDetailMounts = 0;
vi.mock("@/domain/library/agents/AgentDetailPage", async () => {
  const { useEffect } = await import("react");
  return {
    AgentDetailPageInner: () => {
      useEffect(() => {
        agentDetailMounts += 1;
      }, []);
      return <div data-testid="agent-detail" />;
    },
  };
});
vi.mock("@/domain/library/skills/SkillDetailPage", () => ({
  SkillDetailPageInner: () => <div data-testid="skill-detail" />,
}));
vi.mock("@/domain/library/mcp-servers/McpServerDetailPage", () => ({
  McpServerDetailPageInner: () => <div data-testid="mcp-server-detail" />,
}));
vi.mock("@/domain/workflow/WorkflowDetailPage", async () => {
  const { useRequestFullViewport } = await import(
    "@/domain/library/full-viewport-layout"
  );
  return {
    WorkflowDetailPageInner: () => {
      useRequestFullViewport(true);
      return <div data-testid="workflow-detail" />;
    },
  };
});
vi.mock("@/domain/library/schedules/ScheduleDetailPage", () => ({
  ScheduleDetailPageInner: () => <div data-testid="schedule-detail" />,
}));

// The organizations the person belongs to, as the SDK's OrgProvider would
// answer for them: an id reads its slug in a URL, and a segment that is not
// a current slug (an id, or a slug the org was renamed away from) answers
// the slug to replace it with.
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const slugById = new Map([[ACME_ID, "acme"]]);
const canonicalBySegment = new Map([
  [ACME_ID, "acme"],
  ["acme-old", "acme"],
]);

// A slug the org was renamed away from is not in the person's list, so the
// real hook learns its current slug from an organization.get: after the
// first render. The mock answers it the same way; the others at once.
const answeredByLookup = new Set(["acme-old"]);

vi.mock("@stigmer/react", async (importOriginal) => {
  const { useEffect, useState } = await import("react");
  return {
    ...(await importOriginal<typeof import("@stigmer/react")>()),
    useOrgSlugForId: () => (id: string) => slugById.get(id) ?? id,
    useCanonicalOrgSlug: (segment: string | null) => {
      const looked = answeredByLookup.has(segment ?? "");
      const [answer, setAnswer] = useState<string | null>(null);
      useEffect(() => {
        if (!looked) return;
        const timer = setTimeout(() => setAnswer(canonicalBySegment.get(segment ?? "") ?? null), 0);
        return () => clearTimeout(timer);
      }, [looked, segment]);
      return looked ? answer : (canonicalBySegment.get(segment ?? "") ?? null);
    },
  };
});

vi.mock("@/domain/library/LibraryBreadcrumb", () => ({
  LibraryBreadcrumb: () => <nav data-testid="breadcrumb" />,
}));

/** Point both the Next router mock and the browser URL at `path`. */
function setRoute(path: string) {
  mockPathname = path;
  window.history.replaceState(null, "", path);
}

/**
 * Stand-in for a route-level detail wrapper: same yield contract as
 * AgentDetailPage and its four siblings.
 */
function YieldingDetailRouteChild() {
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  if (yieldsToOverlay) return null;
  return <div data-testid="route-detail-copy" />;
}

function NavigateToAgentButton({ org = "acme" }: { org?: string }) {
  const { navigateToDetail } = useLibraryNavigation();
  return (
    <button onClick={() => navigateToDetail("agents", org, "support-bot")}>
      open detail
    </button>
  );
}

beforeEach(() => {
  setRoute("/library/agents");
});

afterEach(cleanup);

describe("LibraryLayout route-children mounting", () => {
  it("renders list children normally when no detail is active", () => {
    render(
      <LibraryLayout>
        <div data-testid="route-child" />
      </LibraryLayout>,
    );

    const child = screen.getByTestId("route-child");
    expect(child.parentElement?.classList.contains("hidden")).toBe(false);
    expect(screen.queryByTestId("agent-detail")).toBeNull();
  });

  it("keeps list children mounted but hidden under a soft-navigated overlay", () => {
    render(
      <LibraryLayout>
        <div data-testid="route-child" />
        <NavigateToAgentButton />
      </LibraryLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "open detail" }));

    // The overlay renders the detail…
    expect(screen.getByTestId("agent-detail")).not.toBeNull();
    // …and the list children survive underneath, hidden from view and
    // from assistive tech — their state is the point of keeping them.
    const child = screen.getByTestId("route-child");
    expect(child.parentElement?.classList.contains("hidden")).toBe(true);
    expect(child.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(window.location.pathname).toBe(
      "/library/agents/acme/support-bot",
    );
  });

  it("renders a deep-loaded detail exactly once: the route copy yields to the overlay", () => {
    setRoute("/library/agents/acme/support-bot");

    render(
      <LibraryLayout>
        <YieldingDetailRouteChild />
      </LibraryLayout>,
    );

    // Exactly one copy of the page: the overlay. The route copy — the
    // same page — must render nothing (oss#621's double-mount).
    expect(screen.getAllByTestId("agent-detail")).toHaveLength(1);
    expect(screen.queryByTestId("route-detail-copy")).toBeNull();
  });

  it("holds a full-viewport request from the overlay while the route copy yields", () => {
    setRoute("/library/workflows/acme/deploy-flow");

    render(
      <LibraryLayout>
        <YieldingDetailRouteChild />
      </LibraryLayout>,
    );

    expect(screen.getAllByTestId("workflow-detail")).toHaveLength(1);
    expect(screen.queryByTestId("route-detail-copy")).toBeNull();
    // isFullViewport drives the breadcrumb away; the (yielding) route
    // copy must not disturb the overlay's request on the shared flag.
    expect(screen.queryByTestId("breadcrumb")).toBeNull();
  });
});

describe("LibraryLayout org segment", () => {
  it("puts the org's slug in the URL when navigating with its id", () => {
    render(
      <LibraryLayout>
        <NavigateToAgentButton org={ACME_ID} />
      </LibraryLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "open detail" }));

    expect(window.location.pathname).toBe("/library/agents/acme/support-bot");
  });

  it("replaces an id in a deep-loaded URL with the org's slug, adding no history entry", async () => {
    setRoute(`/library/agents/${ACME_ID}/support-bot?tab=channels`);
    const entries = window.history.length;

    render(
      <LibraryLayout>
        <YieldingDetailRouteChild />
      </LibraryLayout>,
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/library/agents/acme/support-bot"),
    );
    expect(window.location.search).toBe("?tab=channels");
    expect(window.history.length).toBe(entries);
    expect(screen.getAllByTestId("agent-detail")).toHaveLength(1);
  });

  it("replaces a slug the org was renamed away from, without remounting the detail it shows", async () => {
    setRoute("/library/agents/acme-old/support-bot");
    agentDetailMounts = 0;

    render(
      <LibraryLayout>
        <YieldingDetailRouteChild />
      </LibraryLayout>,
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/library/agents/acme/support-bot"),
    );
    expect(agentDetailMounts).toBe(1);
  });

  it("leaves a current slug alone", () => {
    setRoute("/library/agents/acme/support-bot");

    render(
      <LibraryLayout>
        <YieldingDetailRouteChild />
      </LibraryLayout>,
    );

    expect(window.location.pathname).toBe("/library/agents/acme/support-bot");
  });
});
