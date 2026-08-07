import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { StigmerContext } from "../../context";
import { OrgProvider } from "../../organization/OrgProvider";
import { WorkspaceSidebar } from "../WorkspaceSidebar";
import type { RecentActivityEntry } from "../../activity/types";
import type { RenderSidebarLink } from "../types";

// Tooltips and the org switcher menu portal their content; without a
// StigmerProvider the portal container is null — pin it to document.body
// like sibling tests.
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which Base UI positioners observe.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

/** Frozen reference instant — fixtures must never read the real clock. */
const NOW = new Date("2026-07-20T11:00:00Z");

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const ENTRIES: readonly RecentActivityEntry[] = [
  {
    id: "ses_today",
    type: "session",
    subject: "Draft email copy for the Q3 launch",
    updatedAt: hoursAgo(2),
  },
  {
    id: "wex_yesterday",
    type: "workflow_execution",
    subject: "Nightly refund sweep",
    updatedAt: hoursAgo(26),
    status: "failed",
  },
];

/**
 * The default consumer seam under test: an anchor per row, tagged with the
 * row id so assertions can address rows the way real consumers do.
 */
const renderAnchor: RenderSidebarLink = ({
  id,
  href,
  className,
  children,
  "aria-current": ariaCurrent,
}) => (
  <a href={href} data-row-id={id} aria-current={ariaCurrent} className={className}>
    {children}
  </a>
);

function renderSidebar(ui: ReactNode) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router) => {
      router.service(OrganizationQueryController, {
        findMyOrganizations: () =>
          create(OrganizationsSchema, {
            entries: [
              create(OrganizationSchema, {
                metadata: create(ApiResourceMetadataSchema, {
                  id: "org_acme",
                  slug: "acme",
                  name: "Acme Corp",
                }),
              }),
            ],
          }),
      });
    }),
  });
  return render(
    <StigmerContext.Provider value={client}>
      <OrgProvider>{ui}</OrgProvider>
    </StigmerContext.Provider>,
  );
}

function baseProps() {
  return {
    renderLink: renderAnchor,
    recentActivity: { entries: ENTRIES },
    footer: <span data-testid="footer-slot">footer</span>,
    now: NOW,
  };
}

describe("WorkspaceSidebar — primary navigation", () => {
  it("renders the four primary rows through renderLink with stable ids and hrefs", () => {
    const { container } = renderSidebar(<WorkspaceSidebar {...baseProps()} />);

    const row = (id: string) =>
      container.querySelector<HTMLAnchorElement>(`[data-row-id="${id}"]`);
    expect(row("new-session")?.getAttribute("href")).toBe("/");
    expect(row("dashboard")?.getAttribute("href")).toBe("/dashboard");
    expect(row("conversations")?.getAttribute("href")).toBe("/conversations");
    expect(row("library")?.getAttribute("href")).toBe("/library");
  });

  it("marks only the active row with aria-current and the accent classes", () => {
    const { container } = renderSidebar(
      <WorkspaceSidebar {...baseProps()} activeNav="library" />,
    );

    const library = container.querySelector('[data-row-id="library"]')!;
    expect(library.getAttribute("aria-current")).toBe("page");
    expect(library.className.split(" ")).toContain("bg-sidebar-accent");

    const dashboard = container.querySelector('[data-row-id="dashboard"]')!;
    expect(dashboard.getAttribute("aria-current")).toBeNull();
    // (hover:bg-sidebar-accent is fine — only the resting accent means active)
    expect(dashboard.className.split(" ")).not.toContain("bg-sidebar-accent");
  });
});

describe("WorkspaceSidebar — recents", () => {
  it("buckets entries against the frozen `now`, never the live clock", () => {
    renderSidebar(<WorkspaceSidebar {...baseProps()} />);

    // 2h ago is Today; 26h ago is Yesterday — only under the frozen NOW.
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("2h")).toBeTruthy();
  });

  it("passes the entry to renderLink and derives the viewer route from its type", () => {
    const seen: Record<string, string> = {};
    const spyLink: RenderSidebarLink = (props) => {
      if (props.entry) seen[props.entry.id] = props.href;
      return renderAnchor(props);
    };

    renderSidebar(<WorkspaceSidebar {...baseProps()} renderLink={spyLink} />);

    expect(seen).toEqual({
      ses_today: "/sessions/ses_today",
      wex_yesterday: "/executions/wex_yesterday",
    });
  });

  it("highlights the active session row and renders the status badge", () => {
    const { container } = renderSidebar(
      <WorkspaceSidebar {...baseProps()} activeSessionId="ses_today" />,
    );

    const active = container.querySelector('[data-row-id="ses_today"]')!;
    expect(active.className).toContain("bg-sidebar-accent");
    expect(active.getAttribute("aria-current")).toBe("page");
    // The failed execution row explains why it is in the list.
    const failed = container.querySelector('[data-row-id="wex_yesterday"]')!;
    expect(within(failed as HTMLElement).getByText("failed")).toBeTruthy();
  });

  it("renders the per-entry accessory inside its row", () => {
    const { container } = renderSidebar(
      <WorkspaceSidebar
        {...baseProps()}
        renderEntryAccessory={(entry) =>
          entry.id === "ses_today" ? <span data-testid="run-dot" /> : null
        }
      />,
    );

    const row = container.querySelector('[data-row-id="ses_today"]')!;
    expect(within(row as HTMLElement).getByTestId("run-dot")).toBeTruthy();
  });
});

describe("WorkspaceSidebar — fetch states", () => {
  it("shows skeletons while loading", () => {
    renderSidebar(
      <WorkspaceSidebar
        {...baseProps()}
        recentActivity={{ entries: [], isLoading: true }}
      />,
    );
    expect(screen.getByLabelText("Loading sessions")).toBeTruthy();
  });

  it("shows the error alert plus the empty state on failure", () => {
    renderSidebar(
      <WorkspaceSidebar
        {...baseProps()}
        recentActivity={{ entries: [], error: { message: "backend down" } }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("backend down");
    expect(screen.getByText("No recent activity")).toBeTruthy();
  });

  it("shows the empty state when there are no entries", () => {
    renderSidebar(
      <WorkspaceSidebar {...baseProps()} recentActivity={{ entries: [] }} />,
    );
    expect(screen.getByText("No recent activity")).toBeTruthy();
  });
});

describe("WorkspaceSidebar — chrome", () => {
  it("renders the footer slot and the collapse toggle with aria state", () => {
    renderSidebar(<WorkspaceSidebar {...baseProps()} isOpen={false} />);

    expect(screen.getByTestId("footer-slot")).toBeTruthy();
    const toggle = screen.getByLabelText("Collapse sidebar");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("sidebar");
  });

  it("resolves the org switcher from the mocked transport", async () => {
    renderSidebar(<WorkspaceSidebar {...baseProps()} />);
    expect(await screen.findByText("Acme Corp")).toBeTruthy();
  });
});
